package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginAllowedBehindProxy(t *testing.T) {
	public := []string{"frankfurt.tailf358cb.ts.net"}

	cases := []struct {
		name      string
		host      string
		forwarded string
		origin    string
		want      bool
	}{
		{"public via forwarded host", "127.0.0.1:7795", "frankfurt.tailf358cb.ts.net", "https://frankfurt.tailf358cb.ts.net", true},
		{"public preserved host", "frankfurt.tailf358cb.ts.net", "", "https://frankfurt.tailf358cb.ts.net", true},
		{"local", "127.0.0.1:7795", "", "http://127.0.0.1:7795", true},
		{"no origin", "frankfurt.tailf358cb.ts.net", "", "", true},
		{"foreign origin", "frankfurt.tailf358cb.ts.net", "", "https://evil.example", false},
		{"local origin on remote host", "frankfurt.tailf358cb.ts.net", "", "http://127.0.0.1:7795", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "http://"+tc.host+"/term/auth", nil)
			req.Host = tc.host
			if tc.forwarded != "" {
				req.Header.Set("X-Forwarded-Host", tc.forwarded)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if got := originAllowed(req, public); got != tc.want {
				t.Fatalf("originAllowed = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSecureAcceptsProxyOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := secure(next, []string{"frankfurt.tailf358cb.ts.net"})

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
}
