package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	CookieName    = "nit_gate"
	sessionTTL    = 7 * 24 * time.Hour
	maxFailures   = 5
	blockFor      = 15 * time.Minute
	attemptExpiry = 24 * time.Hour
)

type attempt struct {
	failures     int
	blockedUntil time.Time
	last         time.Time
}

type Gate struct {
	hash     string
	secret   []byte
	base     string
	mu       sync.Mutex
	attempts map[string]*attempt
	now      func() time.Time
}

type loginPage struct {
	Action  string
	Next    string
	Error   string
	Blocked bool
}

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23c65d3b'/%3E%3Cpath d='M10 11l6 5-6 5M18 21h6' stroke='%23fff9f4' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<title>term — sign in</title>
<style>
:root { color-scheme: light dark; --bg:#faf9f7; --panel:#ffffff; --line:#e4e0da; --text:#26241f; --muted:#726d64; --accent:#c65d3b; --danger:#b3362f; }
@media (prefers-color-scheme: dark) { :root { --bg:#141413; --panel:#1c1b19; --line:#302e2b; --text:#f1efe9; --muted:#a19c92; --accent:#e07a4f; --danger:#e07a6a; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
main { width:min(92vw, 360px); padding:28px; background:var(--panel); border:1px solid var(--line); border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.12); }
.brand { display:flex; align-items:center; gap:9px; margin-bottom:22px; color:var(--muted); font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
.brand b { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:7px; background:var(--accent); color:#fff9f4; font-size:14px; letter-spacing:0; }
h1 { margin:0 0 6px; font-size:22px; font-weight:600; letter-spacing:-.02em; }
p { margin:0 0 20px; color:var(--muted); font-size:14px; }
label { display:block; margin-bottom:8px; color:var(--muted); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
input { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:9px; background:var(--bg); color:var(--text); font:inherit; outline:none; }
input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(198,93,59,.15); }
button { width:100%; margin-top:14px; padding:11px 12px; border:0; border-radius:9px; background:var(--accent); color:#fff9f4; font:inherit; font-weight:650; cursor:pointer; }
button:hover { filter:brightness(1.06); }
button:disabled { cursor:not-allowed; opacity:.55; }
.error { margin:0 0 16px; padding:10px 12px; border:1px solid rgba(179,54,47,.35); border-radius:9px; background:rgba(179,54,47,.08); color:var(--danger); font-size:13px; }
.foot { margin:18px 0 0; color:var(--muted); font-size:12px; text-align:center; }
</style>
</head>
<body>
<main>
<div class="brand"><b>t</b> term</div>
<h1>Sign in</h1>
<p>This terminal is private. Enter the server password to continue.</p>
{{if .Error}}<div class="error" role="alert">{{.Error}}</div>{{end}}
<form method="post" action="{{.Action}}">
<input type="hidden" name="next" value="{{.Next}}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus {{if .Blocked}}disabled{{end}}>
<button type="submit" {{if .Blocked}}disabled{{end}}>Continue</button>
</form>
<p class="foot">One password. No accounts.</p>
</main>
</body>
</html>`))

func New(password, base string) *Gate {
	hash := strings.TrimSpace(os.Getenv("NIT_GATE_PASSWORD_HASH"))
	if hash == "" {
		hash = strings.TrimSpace(os.Getenv("TERM_GUI_PASSWORD_HASH"))
	}
	if hash == "" && password != "" {
		hash, _ = hashPassword(password)
	}
	return &Gate{
		hash:     hash,
		secret:   gateSecret(hash),
		base:     strings.TrimRight(strings.TrimSpace(base), "/"),
		attempts: map[string]*attempt{},
		now:      time.Now,
	}
}

func (a *Gate) Wrap(next http.Handler) http.Handler {
	if a.hash == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch a.trimBase(r.URL.Path) {
		case "/auth":
			a.handleLogin(w, r)
			return
		case "/auth/logout":
			a.handleLogout(w, r)
			return
		}
		if a.authenticated(r) {
			next.ServeHTTP(w, r)
			return
		}
		if p := a.trimBase(r.URL.Path); p == "/api" || strings.HasPrefix(p, "/api/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "authentication required"})
			return
		}
		target := a.authPath() + "?next=" + url.QueryEscape(a.externalPath(r.URL.RequestURI()))
		http.Redirect(w, r, target, http.StatusSeeOther)
	})
}

func (a *Gate) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	next := a.safeNext(r.URL.Query().Get("next"))
	if r.Method == http.MethodGet {
		if a.authenticated(r) {
			http.Redirect(w, r, next, http.StatusSeeOther)
			return
		}
		a.render(w, http.StatusOK, next, "", false)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		a.render(w, http.StatusBadRequest, next, "Invalid request.", false)
		return
	}
	next = a.safeNext(r.FormValue("next"))
	ip := clientIP(r)
	if allowed, retry := a.allow(ip); !allowed {
		setRetryAfter(w, retry)
		a.render(w, http.StatusTooManyRequests, next, blockMessage(retry), true)
		return
	}
	if verifyPassword(a.hash, r.FormValue("password")) {
		a.clear(ip)
		a.startSession(w, r)
		http.Redirect(w, r, next, http.StatusSeeOther)
		return
	}
	a.failed(ip)
	if allowed, retry := a.allow(ip); !allowed {
		setRetryAfter(w, retry)
		a.render(w, http.StatusTooManyRequests, next, blockMessage(retry), true)
		return
	}
	a.render(w, http.StatusUnauthorized, next, "Wrong password.", false)
}

func (a *Gate) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.setSessionCookie(w, r, "", -1)
	http.Redirect(w, r, a.authPath(), http.StatusSeeOther)
}

func (a *Gate) render(w http.ResponseWriter, status int, next, message string, blocked bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
	w.WriteHeader(status)
	_ = loginTemplate.Execute(w, loginPage{Action: a.authPath(), Next: next, Error: message, Blocked: blocked})
}

func (a *Gate) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(CookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	return validSessionToken(a.secret, cookie.Value, a.now())
}

func (a *Gate) startSession(w http.ResponseWriter, r *http.Request) {
	a.setSessionCookie(w, r, newSessionToken(a.secret, a.now()), int(sessionTTL.Seconds()))
}

func (a *Gate) setSessionCookie(w http.ResponseWriter, r *http.Request, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *Gate) allow(ip string) (bool, time.Duration) {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prune(now)
	item := a.attempts[ip]
	if item != nil && now.Before(item.blockedUntil) {
		return false, item.blockedUntil.Sub(now)
	}
	return true, 0
}

func (a *Gate) failed(ip string) {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	item := a.attempts[ip]
	if item == nil {
		item = &attempt{}
		a.attempts[ip] = item
	}
	item.failures++
	item.last = now
	if item.failures >= maxFailures {
		item.failures = 0
		item.blockedUntil = now.Add(blockFor)
	}
}

func (a *Gate) clear(ip string) {
	a.mu.Lock()
	delete(a.attempts, ip)
	a.mu.Unlock()
}

func (a *Gate) prune(now time.Time) {
	for ip, item := range a.attempts {
		if now.Sub(item.last) > attemptExpiry && now.After(item.blockedUntil) {
			delete(a.attempts, ip)
		}
	}
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

func (a *Gate) authPath() string {
	return a.base + "/auth"
}

func gateSecret(credential string) []byte {
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + credential))
	return sum[:]
}

func newSessionToken(secret []byte, now time.Time) string {
	payload := "v1." + strconv.FormatInt(now.Add(sessionTTL).Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
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

func (a *Gate) safeNext(raw string) string {
	if raw == "" || raw[0] != '/' || strings.HasPrefix(raw, "//") {
		return a.base + "/"
	}
	for _, char := range raw {
		if char < 0x20 || char == 0x7f || char == '\\' {
			return a.base + "/"
		}
	}
	if a.base != "" && raw != a.base && !strings.HasPrefix(raw, a.base+"/") {
		if raw == "/" {
			return a.base + "/"
		}
		return a.base + raw
	}
	return raw
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "127.0.0.1" || host == "::1" {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			for _, part := range strings.Split(forwarded, ",") {
				if ip := strings.TrimSpace(part); ip != "" {
					return ip
				}
			}
		}
	}
	return host
}

func setRetryAfter(w http.ResponseWriter, retry time.Duration) {
	seconds := int((retry + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
}

func blockMessage(retry time.Duration) string {
	minutes := int((retry + time.Minute - 1) / time.Minute)
	if minutes < 1 {
		minutes = 1
	}
	return "Too many attempts. Try again in " + strconv.Itoa(minutes) + " min."
}
