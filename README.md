# term-gui

A web terminal: one Go binary with an embedded React SPA, one tmux-backed shell
per workspace, and a URL contract instead of a bridge service.

## Run

```sh
bin/run                 # builds the SPA when stale, serves 127.0.0.1:7795
bin/check               # gofmt, vet, tests, typecheck, frontend tests, build
```

Open <http://127.0.0.1:7795/term/>. Health is `GET /term/api/health`.

## URL contract

| URL | Effect |
| --- | --- |
| `/term/?dir=/abs/path` | attach to the session for that directory, creating it if needed |
| `/term/?session=<name>` | attach to an explicit session |
| `/term/` | session for `$HOME` |

The SPA strips the query with `history.replaceState` after reading it.

Sessions are named `tg-<12 hex of sha256(dir)>`. Explicit names must match
`^[A-Za-z0-9_-]{1,40}$`. `dir` must be an absolute path inside
`TERM_GUI_ALLOWED_ROOTS`, and must exist; anything else is a 400 before a PTY is
spawned.

## Linking into the terminal

The same direction as nit/pero's `?open=` link, in reverse:

```ts
export function termHref(base: string, dir: string): string {
  const url = base.endsWith("/") ? base : `${base}/`;
  return `${url}?dir=${encodeURIComponent(dir)}`;
}

termHref("/term/", "/home/ubuntu/Projects/pero-gui");
// "/term/?dir=%2Fhome%2Fubuntu%2FProjects%2Fpero-gui"
```

From the terminal, Ctrl/Cmd+click on an absolute path or `file:line` opens
`${TERM_GUI_PERO_URL}?open=<path>&line=<n>` (`/pero/` by default) in a new tab.
Relative paths resolve against the last OSC 7 cwd, then the session directory.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `TERM_GUI_BASE_PATH` | `/term` | URL prefix. Set to empty to serve at `/`. |
| `TERM_GUI_ALLOWED_HOSTS` | — | comma-separated extra Host values; loopback always allowed |
| `TERM_GUI_ALLOWED_ROOTS` | `$HOME` | allowed `dir` roots, path-list separated |
| `TERM_GUI_PASSWORD` | — | when set, one password and a 7 day `term_session` cookie |
| `TERM_GUI_MAX_SESSIONS` | `8` | cap on concurrently attached PTYs |
| `TERM_GUI_PERO_URL` | `/pero/` | base of the editor link target |

Sessions run under a private tmux server: `tmux -L term-gui -f /dev/null`, so
they never touch the user's own tmux. Without tmux the app falls back to a plain
`$SHELL`, which dies when the last browser disconnects. tmux sessions survive
disconnects and reattach with a full redraw.

## API

- `GET /term/api/health` — `{ok, version, tmux, base}`
- `GET /term/api/sessions` — `{sessions: [{name, dir, tmux, attached}]}`
- `GET /term/api/ws?dir=...` or `?session=...` — binary WebSocket

WebSocket protocol: the first client text frame is
`{"type":"resize","rows":24,"cols":80,"pixelWidth":900,"pixelHeight":600}`;
later keystrokes and clipboard paste are binary frames; PTY output is binary
frames; `{"type":"hello",...}` is the only other text frame. Origin is checked
against Host on the handshake, not only at the HTTP layer.

## Kitty graphics subset

`ESC _ G ... ESC \` with `f=100` (base64 PNG) and a single chunk. The image is
drawn as an `<img>` overlay at the cursor cell, anchored to its buffer line and
moved on scroll. Unknown keys, chunked `m=1`, transmit-only `a=t`, and non-PNG
formats are consumed and ignored, never printed as text. No animation, no
Unicode placeholders, no z-index negotiation, at most 32 images per connection.

xterm.js 6 has no APC hook on `terminal.parser`, so the sequence is parsed in the
WebSocket-to-xterm write path (`web/src/lib/kitty.ts`) before xterm sees it.

## Known limits

- tmux 3.6 swallows raw APC sequences. Kitty images work through a plain PTY
  (tmux missing), and through tmux only when the emitting program wraps the
  sequence in tmux DCS passthrough
  (`ESC Ptmux; ESC ESC _ G ... ESC ESC \ ESC \`). `kitty icat` and similar raw
  emitters will not display images inside a tmux-backed session.
- The session cap counts attached PTYs; background tmux sessions are listed but
  are not counted and are never garbage collected. Kill them with
  `tmux -L term-gui kill-session -t <name>`.
- Auth state is in memory: a restart logs everyone out. The per-IP rate limit
  trusts `X-Forwarded-For` only from loopback.
- WebSocket Origin must equal Host. A proxy that rewrites Host breaks the
  handshake.
- Path links are not checked on disk; the editor decides whether a path exists.
- Kitty rendering, copy-on-select, OSC 52, middle-click paste, and link opening
  were not exercised in a real browser here; they are covered by unit tests and
  raw WebSocket traces only.
