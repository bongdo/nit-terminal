package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func testServer(t *testing.T, password string) *httptest.Server {
	t.Helper()
	gate := New(password, "/term")
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

func TestUnauthenticatedRedirectsToLogin(t *testing.T) {
	server := testServer(t, "secret")
	resp, err := noRedirectClient().Get(server.URL + "/term/?dir=/tmp")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", resp.StatusCode)
	}
	location := resp.Header.Get("Location")
	if !strings.HasPrefix(location, "/term/auth?next=") {
		t.Fatalf("location = %q", location)
	}
	next, err := url.QueryUnescape(strings.TrimPrefix(location, "/term/auth?next="))
	if err != nil {
		t.Fatal(err)
	}
	if next != "/term/?dir=/tmp" {
		t.Fatalf("next = %q", next)
	}
}

func TestUnauthenticatedAPIIs401(t *testing.T) {
	server := testServer(t, "secret")
	resp, err := noRedirectClient().Get(server.URL + "/term/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestLoginPreservesNextAndSetsCookie(t *testing.T) {
	server := testServer(t, "secret")
	form := url.Values{"password": {"secret"}, "next": {"/term/?dir=/tmp"}}
	resp, err := noRedirectClient().PostForm(server.URL+"/term/auth", form)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", resp.StatusCode)
	}
	if location := resp.Header.Get("Location"); location != "/term/?dir=/tmp" {
		t.Fatalf("location = %q", location)
	}
	cookies := resp.Cookies()
	if len(cookies) == 0 || cookies[0].Name != CookieName || cookies[0].Value == "" {
		t.Fatalf("cookies = %v", cookies)
	}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/term/", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(cookies[0])
	authed, err := noRedirectClient().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer authed.Body.Close()
	if authed.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", authed.StatusCode)
	}
}

func TestWrongPasswordIsRateLimited(t *testing.T) {
	server := testServer(t, "secret")
	client := noRedirectClient()
	statuses := make([]int, 0, 5)
	for range 5 {
		resp, err := client.PostForm(server.URL+"/term/auth", url.Values{"password": {"nope"}})
		if err != nil {
			t.Fatal(err)
		}
		statuses = append(statuses, resp.StatusCode)
		resp.Body.Close()
	}
	if statuses[3] != http.StatusUnauthorized {
		t.Fatalf("statuses = %v", statuses)
	}
	if statuses[4] != http.StatusTooManyRequests {
		t.Fatalf("statuses = %v", statuses)
	}
	resp, err := client.PostForm(server.URL+"/term/auth", url.Values{"password": {"nope"}})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", resp.StatusCode)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
}

func TestUnsafeNextIsIgnored(t *testing.T) {
	server := testServer(t, "secret")
	resp, err := noRedirectClient().PostForm(server.URL+"/term/auth", url.Values{
		"password": {"secret"},
		"next":     {"https://evil.example/"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if location := resp.Header.Get("Location"); location != "/term/" {
		t.Fatalf("location = %q", location)
	}
}

func TestHealthWithoutPasswordIsOpen(t *testing.T) {
	server := testServer(t, "")
	resp, err := noRedirectClient().Get(server.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}
