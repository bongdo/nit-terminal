package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func testAccess(hosts, origins []string, trustProxy bool) *access {
	a := &access{
		hosts:      map[string]struct{}{"127.0.0.1": {}, "localhost": {}, "::1": {}},
		origins:    map[string]struct{}{},
		trustProxy: trustProxy,
	}
	for _, host := range hosts {
		a.hosts[host] = struct{}{}
	}
	for _, origin := range origins {
		if key, ok := originKey(origin); ok {
			a.origins[key] = struct{}{}
		}
	}
	return a
}

func TestLoopbackAddr(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:7795", "localhost:7795", "[::1]:7795"} {
		if !loopbackAddr(addr) {
			t.Fatalf("%s is not loopback", addr)
		}
	}
	for _, addr := range []string{"0.0.0.0:7795", ":7795", "192.0.2.1:7795"} {
		if loopbackAddr(addr) {
			t.Fatalf("%s is loopback", addr)
		}
	}
}

func TestOriginAllowedExact(t *testing.T) {
	public := testAccess(
		[]string{"frankfurt.tailf358cb.ts.net"},
		[]string{"https://frankfurt.tailf358cb.ts.net:8443", "http://127.0.0.1:7795"},
		true,
	)

	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{"public", "https://frankfurt.tailf358cb.ts.net:8443", true},
		{"public no port", "https://frankfurt.tailf358cb.ts.net", false},
		{"wrong port", "https://frankfurt.tailf358cb.ts.net:443", false},
		{"http instead of https", "http://frankfurt.tailf358cb.ts.net:8443", false},
		{"local", "http://127.0.0.1:7795", true},
		{"foreign", "https://evil.example", false},
		{"null", "null", false},
		{"path", "https://frankfurt.tailf358cb.ts.net:8443/term/", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7795/term/", nil)
			req.Header.Set("Origin", tc.origin)
			if got := public.originAllowed(req); got != tc.want {
				t.Fatalf("originAllowed(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestHostsAllowedRejectsForwardedSpoof(t *testing.T) {
	a := testAccess([]string{"frankfurt.tailf358cb.ts.net"}, []string{"https://frankfurt.tailf358cb.ts.net:8443"}, true)
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7795/term/", nil)
	req.Host = "127.0.0.1:7795"
	req.Header.Set("X-Forwarded-Host", "frankfurt.tailf358cb.ts.net:8443")
	if !a.hostsAllowed(req) {
		t.Fatal("legitimate forwarded host rejected")
	}
	req.Header.Set("X-Forwarded-Host", "evil.example")
	if a.hostsAllowed(req) {
		t.Fatal("forwarded spoof accepted")
	}
	req.Host = "evil.example"
	req.Header.Del("X-Forwarded-Host")
	if a.hostsAllowed(req) {
		t.Fatal("bad Host accepted")
	}
}

func TestSecureAcceptsProxyOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	a := testAccess([]string{"frankfurt.tailf358cb.ts.net"}, []string{"https://frankfurt.tailf358cb.ts.net"}, true)
	handler := secure(next, a)

	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7795/term/auth", nil)
	req.Host = "127.0.0.1:7795"
	req.Header.Set("X-Forwarded-Host", "frankfurt.tailf358cb.ts.net")
	req.Header.Set("Origin", "https://frankfurt.tailf358cb.ts.net")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7795/term/auth", nil)
	req.Host = "127.0.0.1:7795"
	req.Header.Set("X-Forwarded-Host", "frankfurt.tailf358cb.ts.net")
	req.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin status = %d, want 403", rec.Code)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("403 lost security headers")
	}
}

func TestNewAccessRequiresExplicitOrigins(t *testing.T) {
	t.Setenv("TERM_GUI_ALLOWED_ORIGINS", "")
	t.Setenv("TERM_GUI_TRUST_PROXY", "")
	t.Setenv("TERM_GUI_ALLOW_NO_ORIGIN", "")
	if _, err := newAccess(nil, "0.0.0.0:7795"); err == nil {
		t.Fatal("non-loopback access started without origins")
	}
	a, err := newAccess(nil, "127.0.0.1:7795")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7795/term/", nil)
	req.Header.Set("Origin", "http://127.0.0.1:7795")
	if !a.originAllowed(req) {
		t.Fatal("loopback origin was not added")
	}
}
