package session

import (
	"errors"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"

	"term-gui/internal/pty"
)

var ErrTooMany = errors.New("too many sessions")

type Client struct {
	C    chan []byte
	Dead chan struct{}
	once sync.Once
}

func (c *Client) kill() {
	c.once.Do(func() { close(c.Dead) })
}

type Info struct {
	Name     string `json:"name"`
	Dir      string `json:"dir"`
	Tmux     bool   `json:"tmux"`
	Attached int    `json:"attached"`
}

type Manager struct {
	mu       sync.Mutex
	home     string
	max      int
	tmux     bool
	shell    func() []string
	sessions map[string]*Session
}

func New(home string, max int) *Manager {
	if max < 1 {
		max = 1
	}
	_, err := exec.LookPath("tmux")
	return &Manager{
		home:     home,
		max:      max,
		tmux:     err == nil,
		shell:    defaultShell,
		sessions: map[string]*Session{},
	}
}

func defaultShell() []string {
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" {
		shell = "/bin/sh"
	}
	return []string{shell}
}

func (m *Manager) Home() string { return m.home }

func (m *Manager) Tmux() bool { return m.tmux }

func (m *Manager) Capacity(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[name]; ok {
		return nil
	}
	if len(m.sessions) >= m.max {
		return ErrTooMany
	}
	return nil
}

func (m *Manager) Attach(name, dir string, rows, cols uint16) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[name]; ok {
		return s, nil
	}
	if len(m.sessions) >= m.max {
		return nil, ErrTooMany
	}
	s, err := start(name, dir, m.tmux, m.shell, rows, cols)
	if err != nil {
		return nil, err
	}
	m.sessions[name] = s
	go s.pump(func() { m.forget(s) })
	return s, nil
}

func (m *Manager) Detach(s *Session, c *Client) {
	if !s.unsubscribe(c) {
		return
	}
	m.mu.Lock()
	if m.sessions[s.Name] == s {
		delete(m.sessions, s.Name)
	}
	m.mu.Unlock()
	s.Close()
}

func (m *Manager) forget(s *Session) {
	m.mu.Lock()
	if m.sessions[s.Name] == s {
		delete(m.sessions, s.Name)
	}
	m.mu.Unlock()
}

func (m *Manager) List() []Info {
	m.mu.Lock()
	infos := make([]Info, 0, len(m.sessions))
	seen := make(map[string]bool, len(m.sessions))
	for name, s := range m.sessions {
		infos = append(infos, Info{Name: name, Dir: s.Dir, Tmux: s.Tmux, Attached: s.clientCount()})
		seen[name] = true
	}
	tmux := m.tmux
	m.mu.Unlock()
	if tmux {
		for _, info := range tmuxSessions() {
			if !seen[info.Name] {
				infos = append(infos, info)
			}
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Name < infos[j].Name })
	return infos
}

func tmuxCommand(args ...string) *exec.Cmd {
	cmd := exec.Command("tmux", append([]string{"-L", "term-gui", "-f", "/dev/null"}, args...)...)
	cmd.Env = envWithout("TMUX")
	return cmd
}

func tmuxSessions() []Info {
	out, err := tmuxCommand("list-sessions", "-F", "#{session_name}\t#{session_path}").Output()
	if err != nil {
		return nil
	}
	var infos []Info
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 || parts[0] == "" {
			continue
		}
		infos = append(infos, Info{Name: parts[0], Dir: parts[1], Tmux: true})
	}
	return infos
}

func start(name, dir string, tmux bool, shell func() []string, rows, cols uint16) (*Session, error) {
	argv := shell()
	if tmux {
		_ = tmuxCommand("set-option", "-g", "destroy-unattached", "on").Run()
		_ = tmuxCommand("new-session", "-d", "-s", name, "-c", dir).Run()
		_ = tmuxCommand("set-option", "-g", "allow-passthrough", "on", ";", "set-option", "-g", "status", "off").Run()
		argv = []string{"tmux", "-L", "term-gui", "-f", "/dev/null", "attach-session", "-t", name}
	}
	env := envWithout("TMUX")
	env = setEnv(env, "TERM", "xterm-256color")
	env = setEnv(env, "COLORTERM", "truecolor")
	proc, err := pty.Spawn(dir, argv, env, rows, cols)
	if err != nil {
		return nil, err
	}
	return &Session{
		Name:    name,
		Dir:     dir,
		Tmux:    tmux,
		proc:    proc,
		clients: map[*Client]struct{}{},
		done:    make(chan struct{}),
	}, nil
}

type Session struct {
	Name string
	Dir  string
	Tmux bool

	proc *pty.Proc

	mu      sync.Mutex
	clients map[*Client]struct{}
	closed  bool

	done chan struct{}
}

func (s *Session) Done() <-chan struct{} { return s.done }

func (s *Session) Subscribe() *Client {
	c := &Client{C: make(chan []byte, 64), Dead: make(chan struct{})}
	s.mu.Lock()
	s.clients[c] = struct{}{}
	s.mu.Unlock()
	return c
}

func (s *Session) unsubscribe(c *Client) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, c)
	return len(s.clients) == 0
}

func (s *Session) clientCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}

func (s *Session) Write(p []byte) error {
	_, err := s.proc.Write(p)
	return err
}

func (s *Session) Resize(rows, cols uint16) error {
	return s.proc.Resize(rows, cols)
}

func (s *Session) Close() {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	s.proc.Kill()
}

func (s *Session) pump(done func()) {
	buf := make([]byte, 16*1024)
	for {
		n, err := s.proc.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			s.broadcast(data)
		}
		if err != nil {
			break
		}
	}
	s.proc.Kill()
	_ = s.proc.Wait()
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	close(s.done)
	done()
}

func (s *Session) broadcast(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	for c := range s.clients {
		select {
		case c.C <- data:
		default:
			delete(s.clients, c)
			c.kill()
		}
	}
}

func envWithout(key string) []string {
	var out []string
	for _, item := range os.Environ() {
		if strings.HasPrefix(item, key+"=") {
			continue
		}
		out = append(out, item)
	}
	return out
}

func setEnv(env []string, key, value string) []string {
	out := make([]string, 0, len(env)+1)
	for _, item := range env {
		if strings.HasPrefix(item, key+"=") {
			continue
		}
		out = append(out, item)
	}
	return append(out, key+"="+value)
}
