package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"
)

const (
	testLoginURL = "https://frankfurt.tailf358cb.ts.net/nit/auth"
	testToken    = "v1.2000000000.baa6SCK3SkFG1E7DKlobpA735zGYAznmh2p_U3wOIaQ"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	t.Setenv("NIT_GATE_PASSWORD_HASH", "fixture")
	t.Setenv("NIT_GUI_PASSWORD_HASH", "")
	gate, err := New("/term", testLoginURL, false, true)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"ok":true}`)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "app")
	})
	server := httptest.NewServer(gate.Wrap(mux))
	t.Cleanup(server.Close)
	return server
}

func noRedirectClient() *http.Client {
	return &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
}

func signedToken(secret []byte, expires time.Time) string {
	payload := "v1." + strconv.FormatInt(expires.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestLocalAuthIsNotFound(t *testing.T) {
	server := testServer(t)
	client := noRedirectClient()
	for _, target := range []string{"/term/auth", "/term/auth/logout"} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			req, err := http.NewRequest(method, server.URL+target, nil)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("%s %s status = %d, want 404", method, target, resp.StatusCode)
			}
		}
	}
}

func TestUnauthenticatedRedirectsToCentralLogin(t *testing.T) {
	server := testServer(t)
	req, err := http.NewRequest(http.MethodGet, server.URL+"/term/?dir=/tmp", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "frankfurt.tailf358cb.ts.net:8443")
	resp, err := noRedirectClient().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", resp.StatusCode)
	}
	want := testLoginURL + "?next=" + url.QueryEscape("https://frankfurt.tailf358cb.ts.net:8443/term/?dir=/tmp")
	if location := resp.Header.Get("Location"); location != want {
		t.Fatalf("location = %q, want %q", location, want)
	}
}

func TestUnauthenticatedAPIIs401(t *testing.T) {
	server := testServer(t)
	resp, err := noRedirectClient().Get(server.URL + "/term/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestUnauthenticatedWebSocketIs401(t *testing.T) {
	server := testServer(t)
	req, err := http.NewRequest(http.MethodGet, server.URL+"/term/api/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	resp, err := noRedirectClient().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestExpiredAndTamperedCookiesAreRejected(t *testing.T) {
	server := testServer(t)
	secret := gateSecret("fixture")
	tokens := map[string]string{
		"expired":   signedToken(secret, time.Now().Add(-time.Minute)),
		"tampered":  testToken[:len(testToken)-1] + "A",
		"malformed": "v1.nope.x",
	}
	for name, token := range tokens {
		t.Run(name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, server.URL+"/term/", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.AddCookie(&http.Cookie{Name: CookieName, Value: token})
			resp, err := noRedirectClient().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusSeeOther {
				t.Fatalf("page status = %d, want 303", resp.StatusCode)
			}
			req, err = http.NewRequest(http.MethodGet, server.URL+"/term/api/health", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.AddCookie(&http.Cookie{Name: CookieName, Value: token})
			resp, err = noRedirectClient().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("api status = %d, want 401", resp.StatusCode)
			}
		})
	}
}

func TestSharedCookiePasses(t *testing.T) {
	server := testServer(t)
	req, err := http.NewRequest(http.MethodGet, server.URL+"/term/", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: CookieName, Value: testToken})
	resp, err := noRedirectClient().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestNoHashFailsClosed(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "")
	t.Setenv("NIT_GUI_PASSWORD_HASH", "")
	if _, err := New("/term", testLoginURL, false, false); err == nil {
		t.Fatal("gate started without a hash")
	}
	if _, err := New("/term", testLoginURL, true, false); err != nil {
		t.Fatalf("insecure gate: %v", err)
	}
}

func TestGateRequiresLoginURL(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "fixture")
	t.Setenv("NIT_GUI_PASSWORD_HASH", "")
	if _, err := New("/term", "", false, false); err == nil {
		t.Fatal("gate started without a login URL")
	}
}

func TestAuthDisabledStillHidesLocalAuth(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "")
	t.Setenv("NIT_GUI_PASSWORD_HASH", "")
	gate, err := New("/term", "", true, false)
	if err != nil {
		t.Fatal(err)
	}
	handler := gate.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/term/", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("open status = %d, want 200", resp.Code)
	}
	resp = httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/term/auth", nil))
	if resp.Code != http.StatusNotFound {
		t.Fatalf("local auth status = %d, want 404", resp.Code)
	}
}

func TestSessionTokenSharedWithNitAndPero(t *testing.T) {
	if !validSessionToken(gateSecret("fixture"), testToken, time.Unix(1900000000, 0)) {
		t.Fatal("shared session token rejected")
	}
}
