package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const CookieName = "nit_gate"

type Gate struct {
	enabled    bool
	secret     []byte
	base       string
	loginURL   string
	trustProxy bool
	now        func() time.Time
}

func New(base, loginURL string, insecure, trustProxy bool) (*Gate, error) {
	hash := strings.TrimSpace(os.Getenv("NIT_GATE_PASSWORD_HASH"))
	if hash == "" {
		hash = strings.TrimSpace(os.Getenv("NIT_GUI_PASSWORD_HASH"))
	}
	loginURL = strings.TrimRight(strings.TrimSpace(loginURL), "/")
	if hash == "" && !insecure {
		return nil, errors.New("auth: NIT_GATE_PASSWORD_HASH is required; set TERM_GUI_INSECURE=1 only for loopback development")
	}
	if hash != "" && loginURL == "" {
		return nil, errors.New("auth: NIT_GATE_LOGIN_URL is required when the gate is enabled")
	}
	return &Gate{
		enabled:    hash != "",
		secret:     gateSecret(hash),
		base:       strings.TrimRight(strings.TrimSpace(base), "/"),
		loginURL:   loginURL,
		trustProxy: trustProxy,
		now:        time.Now,
	}, nil
}

func (a *Gate) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch a.trimBase(r.URL.Path) {
		case "/auth", "/auth/", "/auth/logout":
			http.NotFound(w, r)
			return
		}
		if !a.enabled || a.authenticated(r) {
			next.ServeHTTP(w, r)
			return
		}
		if p := a.trimBase(r.URL.Path); p == "/api" || strings.HasPrefix(p, "/api/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "authentication required"})
			return
		}
		http.Redirect(w, r, a.loginTarget(r), http.StatusSeeOther)
	})
}

func (a *Gate) loginTarget(r *http.Request) string {
	return a.loginURL + "?next=" + url.QueryEscape(a.absoluteURL(r))
}

func (a *Gate) absoluteURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || a.trustProxy {
		scheme = "https"
	}
	host := r.Host
	if a.trustProxy {
		if forwarded := forwardedValue(r.Header.Get("X-Forwarded-Host")); forwarded != "" {
			host = forwarded
		}
	}
	return scheme + "://" + host + a.externalPath(r.URL.RequestURI())
}

func (a *Gate) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(CookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	return validSessionToken(a.secret, cookie.Value, a.now())
}

func (a *Gate) trimBase(path string) string {
	if a.base == "" {
		return path
	}
	if path == a.base {
		return "/"
	}
	if strings.HasPrefix(path, a.base+"/") {
		return strings.TrimPrefix(path, a.base)
	}
	return path
}

func (a *Gate) externalPath(path string) string {
	if path == "" {
		return a.base + "/"
	}
	if a.base == "" || path == a.base || strings.HasPrefix(path, a.base+"/") {
		return path
	}
	return a.base + path
}

func forwardedValue(value string) string {
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[len(parts)-1])
}

func gateSecret(credential string) []byte {
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + credential))
	return sum[:]
}

func validSessionToken(secret []byte, value string, now time.Time) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	expires, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= expires {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	return hmac.Equal(signature, mac.Sum(nil))
}
