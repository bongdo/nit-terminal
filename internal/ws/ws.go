package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"

	"term-gui/internal/session"
)

const (
	writeTimeout = 15 * time.Second
	pingInterval = 30 * time.Second
	pingTimeout  = 10 * time.Second
)

type Handler struct {
	Roots         *session.Roots
	Manager       *session.Manager
	Home          string
	PeroURL       string
	OriginAllowed func(*http.Request) bool
	AllowNoOrigin bool
}

type hello struct {
	Type    string `json:"type"`
	Session string `json:"session"`
	Dir     string `json:"dir"`
	Home    string `json:"home"`
	Tmux    bool   `json:"tmux"`
	PeroURL string `json:"peroURL"`
}

type control struct {
	Type string `json:"type"`
	Rows int    `json:"rows"`
	Cols int    `json:"cols"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.originOK(r) {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	name, dir, err := session.Target(r.URL.Query(), h.Roots, h.Home)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.Manager.Capacity(name); err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sess, err := h.Manager.Attach(name, dir, 24, 80)
	if err != nil {
		status := websocket.StatusInternalError
		if errors.Is(err, session.ErrTooMany) {
			status = websocket.StatusPolicyViolation
		}
		payload, _ := json.Marshal(map[string]string{"type": "error", "error": err.Error()})
		_ = writeMessage(ctx, c, websocket.MessageText, payload)
		_ = c.Close(status, err.Error())
		return
	}

	client := sess.Subscribe()
	defer h.Manager.Detach(sess, client)

	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pingCtx, pingCancel := context.WithTimeout(ctx, pingTimeout)
				err := c.Ping(pingCtx)
				pingCancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	done := make(chan struct{}, 2)

	go func() {
		defer func() { done <- struct{}{} }()
		for {
			kind, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			switch kind {
			case websocket.MessageText:
				var msg control
				if json.Unmarshal(data, &msg) != nil || msg.Type != "resize" {
					continue
				}
				rows, cols := clamp(msg.Rows), clamp(msg.Cols)
				if rows > 0 && cols > 0 {
					_ = sess.Resize(uint16(rows), uint16(cols))
				}
			case websocket.MessageBinary:
				if len(data) == 0 {
					continue
				}
				if err := sess.Write(data); err != nil {
					return
				}
			}
		}
	}()

	go func() {
		defer func() { done <- struct{}{} }()
		banner, _ := json.Marshal(hello{
			Type:    "hello",
			Session: sess.Name,
			Dir:     sess.Dir,
			Home:    h.Home,
			Tmux:    sess.Tmux,
			PeroURL: h.PeroURL,
		})
		if err := writeMessage(ctx, c, websocket.MessageText, banner); err != nil {
			return
		}
		for {
			select {
			case data := <-client.C:
				if err := writeMessage(ctx, c, websocket.MessageBinary, data); err != nil {
					return
				}
			case <-client.Dead:
				return
			case <-sess.Done():
				_ = c.Close(websocket.StatusGoingAway, "session ended")
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	<-done
}

func writeMessage(ctx context.Context, c *websocket.Conn, kind websocket.MessageType, data []byte) error {
	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return c.Write(writeCtx, kind, data)
}

func (h *Handler) originOK(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return h.AllowNoOrigin
	}
	if h.OriginAllowed != nil {
		return h.OriginAllowed(r)
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

func clamp(value int) int {
	if value < 1 {
		return 0
	}
	if value > 1000 {
		return 1000
	}
	return value
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
