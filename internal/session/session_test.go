package session

import (
	"bytes"
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
