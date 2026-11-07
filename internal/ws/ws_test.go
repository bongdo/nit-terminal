package ws

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"term-gui/internal/session"
)

func TestForeignOriginRejected(t *testing.T) {
	dir := t.TempDir()
	roots, err := session.ParseRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	handler := &Handler{
		Roots:   roots,
		Manager: session.New(dir, 4),
		Home:    dir,
		PeroURL: "/pero/",
	}

	target := "/api/ws?session=" + url.QueryEscape("demo")
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7795"+target, nil)
	req.Host = "127.0.0.1:7795"
	req.Header.Set("Origin", "http://evil.example")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
}

func TestInvalidTargetRejected(t *testing.T) {
	dir := t.TempDir()
	roots, err := session.ParseRoots(dir)
	if err != nil {
		t.Fatal(err)
	}
	handler := &Handler{
		Roots:   roots,
		Manager: session.New(dir, 4),
		Home:    dir,
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7795/api/ws?dir=relative", nil)
	req.Host = "127.0.0.1:7795"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}
