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
	"term-gui/internal/session"
	"term-gui/internal/ws"
)

const version = "0.1.0"

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

	var extraHosts []string
	for _, host := range strings.Split(os.Getenv("TERM_GUI_ALLOWED_HOSTS"), ",") {
		if host = strings.TrimSpace(host); host != "" {
			extraHosts = append(extraHosts, host)
		}
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
	mux.Handle("GET /api/ws", &ws.Handler{
		Roots:         roots,
		Manager:       manager,
		Home:          home,
		PeroURL:       peroURL,
		OriginAllowed: func(r *http.Request) bool { return originAllowed(r, extraHosts) },
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/", spaHandler())

	gate := auth.New(os.Getenv("TERM_GUI_PASSWORD"), basePath)
	server := &http.Server{
		Addr: *addrFlag,
		Handler: secure(
			gate.Wrap(withBasePath(basePath, mux)),
			extraHosts,
		),
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
	}()

	log.Printf("term-gui %s http://%s%s/ tmux=%v roots=%v", version, *addrFlag, basePath, manager.Tmux(), roots.Dirs())
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
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

func secure(next http.Handler, extraHosts []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowedHost(requestHost(r), extraHosts) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if !originAllowed(r, extraHosts) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; "+
				"font-src 'self' data:; "+
				"connect-src 'self'; "+
				"frame-src 'self' blob: data:; "+
				"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func allowedHost(hostport string, extra []string) bool {
	host := hostOnly(hostport)
	switch strings.ToLower(host) {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	for _, candidate := range extra {
		if strings.EqualFold(host, hostOnly(candidate)) {
			return true
		}
	}
	return false
}

func hostOnly(hostport string) string {
	host := hostport
	if parsed, _, err := net.SplitHostPort(hostport); err == nil {
		host = parsed
	}
	return strings.TrimSuffix(strings.Trim(host, "[]"), ".")
}

func requestHost(r *http.Request) string {
	if host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); host != "" {
		return host
	}
	return r.Host
}

func originAllowed(r *http.Request, extra []string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if !allowedHost(parsed.Host, extra) {
		return false
	}
	originHost := hostOnly(parsed.Host)
	if strings.EqualFold(originHost, hostOnly(requestHost(r))) {
		return true
	}
	for _, candidate := range extra {
		if strings.EqualFold(originHost, hostOnly(candidate)) {
			return true
		}
	}
	return false
}

func withBasePath(base string, next http.Handler) http.Handler {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == base {
			http.Redirect(w, r, base+"/", http.StatusTemporaryRedirect)
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
