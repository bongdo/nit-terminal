package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"

	"term-gui/internal/auth"
	"termcore/session"
	"termcore/ws"
)

const version = "0.1.1"

//go:embed all:web/dist
var webAssets embed.FS

func main() {
	addrFlag := flag.String("addr", "127.0.0.1:7795", "listen address")
	showVer := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVer {
		log.Println(version)
		return
	}

	insecure := envEnabled("TERM_GUI_INSECURE")
	if insecure && !loopbackAddr(*addrFlag) {
		log.Fatal("TERM_GUI_INSECURE requires a loopback --addr")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("home: %v", err)
	}
	roots, err := session.ParseRoots(os.Getenv("TERM_GUI_ALLOWED_ROOTS"))
	if err != nil {
		log.Fatalf("roots: %v", err)
	}
	manager := session.New(home, envInt("TERM_GUI_MAX_SESSIONS", 8))

	basePath := "/term"
	if value, ok := os.LookupEnv("TERM_GUI_BASE_PATH"); ok {
		basePath = strings.TrimRight(strings.TrimSpace(value), "/")
	}
	peroURL := strings.TrimSpace(os.Getenv("TERM_GUI_PERO_URL"))
	if peroURL == "" {
		peroURL = "/pero/"
	}
	dropURL := strings.TrimSpace(os.Getenv("TERM_GUI_DROP_URL"))

	var extraHosts []string
	for _, host := range strings.Split(os.Getenv("TERM_GUI_ALLOWED_HOSTS"), ",") {
		if host = strings.TrimSpace(host); host != "" {
			extraHosts = append(extraHosts, host)
		}
	}

	gate, err := auth.New(basePath, os.Getenv("NIT_GATE_LOGIN_URL"), insecure, envEnabled("TERM_GUI_TRUST_PROXY"))
	if err != nil {
		log.Fatal(err)
	}
	access, err := newAccess(extraHosts, *addrFlag)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := roots.Resolve(home); err != nil {
		log.Printf("home is outside TERM_GUI_ALLOWED_ROOTS; use ?dir=: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"version": version,
			"tmux":    manager.Tmux(),
			"base":    basePath,
		})
	})
	mux.HandleFunc("GET /api/sessions", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"sessions": manager.List()})
	})
	handler := &ws.Handler{
		Roots:         roots,
		Manager:       manager,
		Home:          home,
		PeroURL:       peroURL,
		DropURL:       dropURL,
		OriginAllowed: access.originAllowed,
		AllowNoOrigin: access.allowNoOrigin,
	}
	mux.Handle("GET /api/ws", handler)
	mux.HandleFunc("GET /api/check", handler.Check)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/", spaHandler())

	server := &http.Server{
		Addr: *addrFlag,
		Handler: logRequests(secure(
			gate.Wrap(withBasePath(basePath, mux)),
			access,
		)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
		manager.CloseAll()
	}()

	log.Printf("term-gui %s http://%s%s/ tmux=%v roots=%v insecure=%v", version, *addrFlag, basePath, manager.Tmux(), roots.Dirs(), insecure)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	manager.CloseAll()
}

func envEnabled(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func loopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func spaHandler() http.Handler {
	dist, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if info, err := fs.Stat(dist, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-store")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		r.URL.Path = "/"
		w.Header().Set("Cache-Control", "no-store")
		fileServer.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %q host=%q forwarded=%q proto=%q origin=%q", r.Method, r.URL.Path, r.Host,
			r.Header.Get("X-Forwarded-Host"), r.Header.Get("X-Forwarded-Proto"), r.Header.Get("Origin"))
		next.ServeHTTP(w, r)
	})
}

type access struct {
	hosts         map[string]struct{}
	origins       map[string]struct{}
	allowNoOrigin bool
}

func newAccess(extraHosts []string, addr string) (*access, error) {
	a := &access{
		hosts:         map[string]struct{}{"127.0.0.1": {}, "localhost": {}, "::1": {}},
		origins:       map[string]struct{}{},
		allowNoOrigin: envEnabled("TERM_GUI_ALLOW_NO_ORIGIN"),
	}
	for _, host := range extraHosts {
		if host = strings.ToLower(hostOnly(host)); host != "" {
			a.hosts[host] = struct{}{}
		}
	}
	for _, raw := range strings.Split(os.Getenv("TERM_GUI_ALLOWED_ORIGINS"), ",") {
		if raw = strings.TrimSpace(raw); raw == "" {
			continue
		}
		origin, ok := originKey(raw)
		if !ok {
			return nil, errors.New("TERM_GUI_ALLOWED_ORIGINS must contain http(s) origins: " + raw)
		}
		a.origins[origin] = struct{}{}
	}
	if loopbackAddr(addr) {
		_, port, err := net.SplitHostPort(addr)
		if err == nil {
			for _, host := range []string{"127.0.0.1", "localhost", "[::1]"} {
				a.origins["http://"+host+":"+port] = struct{}{}
			}
		}
	}
	if len(a.origins) == 0 {
		return nil, errors.New("TERM_GUI_ALLOWED_ORIGINS is required")
	}
	return a, nil
}

func originKey(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return "", false
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}

func (a *access) hostAllowed(hostport string) bool {
	host := strings.ToLower(hostOnly(hostport))
	if host == "" {
		return false
	}
	_, ok := a.hosts[host]
	return ok
}

func (a *access) hostsAllowed(r *http.Request) bool {
	if !a.hostAllowed(r.Host) {
		return false
	}
	if forwarded := forwardedValue(r.Header.Get("X-Forwarded-Host")); forwarded != "" && !a.hostAllowed(forwarded) {
		return false
	}
	return true
}

func (a *access) originAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	key, ok := originKey(origin)
	if !ok {
		return false
	}
	_, ok = a.origins[key]
	return ok
}

func hostOnly(hostport string) string {
	host := hostport
	if parsed, _, err := net.SplitHostPort(hostport); err == nil {
		host = parsed
	}
	return strings.TrimSuffix(strings.Trim(host, "[]"), ".")
}

func forwardedValue(value string) string {
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[len(parts)-1])
}

func secure(next http.Handler, access *access) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'sha256-aIBQFHIR4I9o+ih+HIBbGqhiZxjYP1Y8ulplpgHXQoo='; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; "+
				"font-src 'self' data:; "+
				"connect-src 'self'; "+
				"frame-src 'self' blob: data:; "+
				"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		if !access.hostsAllowed(r) {
			log.Printf("host rejected host=%q forwarded=%q", r.Host, r.Header.Get("X-Forwarded-Host"))
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if !access.originAllowed(r) {
			log.Printf("origin rejected host=%q forwarded=%q proto=%q origin=%q", r.Host,
				r.Header.Get("X-Forwarded-Host"), r.Header.Get("X-Forwarded-Proto"), r.Header.Get("Origin"))
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withBasePath(base string, next http.Handler) http.Handler {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == base {
			target := base + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusTemporaryRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, base+"/") {
			http.NotFound(w, r)
			return
		}
		r.URL.Path = strings.TrimPrefix(r.URL.Path, base)
		next.ServeHTTP(w, r)
	})
}
