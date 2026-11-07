# term-gui

- `BRIEF.md` — what to build and the URL contract. Read it first.
- `bin/check` — typecheck, tests, build, `gofmt`, `go vet`, `go test`. Must be
  green before reporting.
- `bin/run` — local server on `127.0.0.1:7795`.
- `save "<what changed>"` after a green check.
- Do not deploy, do not run `tailscale funnel`, do not touch `pero-gui` or
  `nit-gui`.
