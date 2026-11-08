# term-gui

A web terminal in the same family as `pero-gui` and `nit-gui`: one Go binary
with an embedded React SPA, one shell per workspace, tmux underneath, and a URL
contract instead of a bridge service.

The terminal is not an AI client. Intelligence belongs to scripts and commands;
the terminal's job is speed, themes, selection, copying and image output.

## Non-goals

- No chat, no model calls, no prompt box. AI work stays in `nit-gui`.
- No message bus, shared database or HTTP API between the three apps.
- No `?cmd=` or any query parameter that executes a command.
- No deployment to Funnel from this repo; loopback by default.

## Product

- A PTY per session, streamed over a binary WebSocket, rendered with xterm.js.
- Sessions are tmux-backed: reload and reconnect keep the shell alive, several
  devices can watch the same session. Fall back to a plain shell when tmux is
  missing.
- One session per workspace directory, named deterministically from the
  absolute path. Explicit `?session=` selects another.
- Copy on select. Ctrl/Cmd+V paste. OSC 52 copy from remote programs.
  Middle-click paste.
- A flat list of terminal theme presets, plus font size, persisted in
  `localStorage`.
- Kitty graphics protocol: PNG (`f=100`) and raw RGB/RGBA (`f=24`, `f=32`),
  chunked transmission, transmit/place/delete, drawn at the cursor cell. No
  animation, no unicode placeholders, no z-index negotiation. Document the
  limits.
- Ctrl/Cmd+click on an absolute path or `file:line` in the output opens
  `<peroURL>?open=<path>&line=<n>` in a new tab. `peroURL` comes from
  `TERM_GUI_PERO_URL`, default `/pero/`. Resolve relative paths against the
  session's last OSC 7 cwd, then against the session directory.

## URL contract

| URL | Effect |
| --- | --- |
| `/term/?dir=/abs/path` | attach to the session for that directory, creating it if needed |
| `/term/?session=<name>` | attach to an explicit session |
| `/term/` | session for `$HOME` |

After handling, the SPA strips the query with `history.replaceState`, the same
way `pero-gui` does for `?open=`. Query parsing lives in one tested module.

Sessions are named `tg-<12 hex of sha256(dir)>`; explicit names must match
`^[A-Za-z0-9_-]{1,40}$`. `dir` must be an absolute path inside one of the
allowed roots (`TERM_GUI_ALLOWED_ROOTS`, default `$HOME`, path-list separated).
Anything else is a 400 before a PTY is spawned.

## Server

- `GET /api/health` — version, tmux availability.
- `GET /api/sessions` — running sessions with their directory.
- `GET /api/ws?session=<name>` — WebSocket. First frame from the client is a
  resize message with rows, cols, pixel width and height; client input follows
  as raw bytes. Server output is raw PTY bytes: no JSON per keystroke.
- Base path from `TERM_GUI_BASE_PATH` (for `/term/`), allowed hosts from
  `TERM_GUI_ALLOWED_HOSTS`, loopback always allowed.
- Optional password from `TERM_GUI_PASSWORD`: copy the login-page and session
  cookie pattern from `pero-gui/auth.go` (`pero_session`, 7 day TTL, per-IP
  rate limit, `next=` preserved). No new dependency for auth.
- Validate `Origin` on the WebSocket handshake, not only `Host`. A WS upgrade
  bypasses CORS and CSRF protections.
- Kill the PTY when the last client disconnects only if the session is not
  tmux-backed; tmux sessions keep running.
- Cap concurrent sessions (`TERM_GUI_MAX_SESSIONS`, default 8) and buffer size.

## Frontend

- Vite + React + TypeScript + Tailwind v4, same conventions as `pero-gui/web`.
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`,
  `@xterm/addon-unicode11`.
- Layout: the terminal fills the whole page. No permanent top or bottom bars;
  a floating settings button and Ctrl/Cmd+, open a popover with connection
  state, cwd, font size, theme and reconnect.
- Selection → `navigator.clipboard.writeText` on selection change, debounced;
  a one-line toast confirms. Do not steal Ctrl/Cmd+C. Ctrl/Cmd+V pastes.
- Kitty handler: parse APC sequences in the WebSocket-to-xterm write path,
  decode the payload, draw an `<img>` overlay at the cursor cell, scroll-lock
  the row so it does not stick to static content. Anything unsupported is
  ignored, never printed as garbage.
- Speed: binary frames, no per-key JSON, one `requestAnimationFrame` flush per
  tick, `fit` only on resize and font change.

## Checks

`bin/check` must run and pass: `gofmt -l`, `go vet ./...`, `go test ./...`,
`npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web
run build`, then `go build -o .cache/term-gui .`.

Tests that must exist:

- URL parsing: valid `dir`/`session`, rejection of relative paths, `..`, paths
  outside allowed roots, invalid session names.
- Session naming: stable for the same path, different for different paths.
- Auth: unauthenticated request redirects to the login page, wrong password is
  rate-limited, `next` survives login.
- PTY: spawn `/bin/sh -c 'printf hello'` and read `hello` through the same
  writer the WebSocket uses. This is the oracle that the terminal actually
  runs commands.
- WebSocket handshake with a foreign `Origin` is rejected.

`bin/run` builds the SPA when stale and starts the server on
`127.0.0.1:7795`. `bin/deploy` is out of scope for now.

## Style

- English identifiers and comments only where the code cannot say it. Machine
  directives (`//go:build`, `// SPDX-`) allowed.
- Standard library first. Acceptable dependencies: `creack/pty` (or
  `aymanbagabas/go-pty`), `coder/websocket` (or `gorilla/websocket`), the
  xterm.js packages above. Nothing else without a reason in the commit.
- One `shortcut:` comment is allowed for a known limit; keep it to one line.

## References

Read these before writing:

- `/home/ubuntu/Projects/pero-gui/main.go` — base path, host allowlist, CSP,
  embedded SPA, `spaHandler`.
- `/home/ubuntu/Projects/pero-gui/auth.go` — login page, cookie, rate limit.
- `/home/ubuntu/Projects/pero-gui/bin/check`, `bin/run` — the shape of the
  scripts.
- `/home/ubuntu/Projects/nit-gui/web/src/lib/diff.ts` — how nit builds
  `?open=` links, so the reverse direction matches.
