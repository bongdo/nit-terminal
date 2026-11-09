package session

import (
	"bytes"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPtyOracle(t *testing.T) {
	dir := t.TempDir()
	manager := New(dir, 2)
	manager.tmux = false
	manager.shell = func() []string { return []string{"/bin/sh", "-c", "printf hello"} }

	sess, err := manager.Attach("oracle", dir, 24, 80)
	if err != nil {
		t.Fatal(err)
	}
	client := sess.Subscribe()
	defer manager.Detach(sess, client)

	var out bytes.Buffer
	deadline := time.After(5 * time.Second)
	for !bytes.Contains(out.Bytes(), []byte("hello")) {
		select {
		case data := <-client.C:
			out.Write(data)
		case <-deadline:
			t.Fatalf("no output, got %q", out.String())
		}
	}
}

func TestSessionEnvScrubsSecrets(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "secret")
	t.Setenv("NIT_GUI_PASSWORD", "secret")
	t.Setenv("OPENCODE_TOKEN", "secret")
	t.Setenv("TERM_GUI_TEST_VALUE", "kept")
	env := strings.Join(sessionEnv(), "\n")
	for _, secret := range []string{"NIT_GATE_PASSWORD_HASH", "NIT_GUI_PASSWORD", "OPENCODE_TOKEN"} {
		if strings.Contains(env, secret) {
			t.Fatalf("%s leaked into PTY environment", secret)
		}
	}
	if !strings.Contains(env, "TERM_GUI_TEST_VALUE=kept") {
		t.Fatal("unrelated environment was removed")
	}
}

func TestExplicitSessionHomeMustStayInsideRoots(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	roots, err := ParseRoots(root)
	if err != nil {
		t.Fatal(err)
	}
	values, err := url.ParseQuery("session=demo")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := Target(values, roots, outside); !errors.Is(err, ErrOutside) {
		t.Fatalf("err = %v, want ErrOutside", err)
	}
	if _, _, err := Target(url.Values{}, roots, outside); !errors.Is(err, ErrOutside) {
		t.Fatalf("default err = %v, want ErrOutside", err)
	}
}

func TestPtyEnvScrubsSecrets(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "secret")
	t.Setenv("OPENCODE_TOKEN", "secret")
	dir := t.TempDir()
	manager := New(dir, 1)
	manager.tmux = false
	manager.shell = func() []string { return []string{"/bin/sh", "-c", "env"} }

	sess, err := manager.Attach("env", dir, 24, 80)
	if err != nil {
		t.Fatal(err)
	}
	client := sess.Subscribe()
	defer manager.Detach(sess, client)

	var out bytes.Buffer
	deadline := time.After(5 * time.Second)
	for {
		select {
		case data := <-client.C:
			out.Write(data)
		case <-sess.Done():
			if strings.Contains(out.String(), "NIT_GATE_PASSWORD_HASH") || strings.Contains(out.String(), "OPENCODE_TOKEN") {
				t.Fatalf("secret leaked into PTY: %q", out.String())
			}
			return
		case <-deadline:
			t.Fatalf("PTY did not finish: %q", out.String())
		}
	}
}
