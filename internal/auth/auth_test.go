package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	gate := New("/term", testLoginURL)
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

func TestAuthDisabledStillHidesLocalAuth(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "")
	t.Setenv("NIT_GUI_PASSWORD_HASH", "")
	gate := New("/term", testLoginURL)
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
