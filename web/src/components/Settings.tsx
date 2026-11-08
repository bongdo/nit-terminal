import { useEffect, useRef, useState } from "react";

import type { ConnState, SessionHello } from "./TerminalView";
import { themes, themeById, type Prefs, type ThemeId } from "../lib/theme";

type Props = {
  hello: SessionHello | null;
  state: ConnState;
  cwd: string;
  prefs: Prefs;
  onFont: (delta: number) => void;
  onTheme: (theme: ThemeId) => void;
  onReconnect: () => void;
};

const stateColor: Record<ConnState, string> = {
  connecting: "bg-amber-500",
  open: "bg-emerald-500",
  closed: "bg-red-500",
};

const stateLabel: Record<ConnState, string> = {
  connecting: "connecting",
  open: "connected",
  closed: "disconnected",
};

export default function Settings({ hello, state, cwd, prefs, onFont, onTheme, onReconnect }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTerminal = () => document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
  const close = () => {
    setOpen(false);
    focusTerminal();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        event.stopPropagation();
        if (open) close();
        else setOpen(true);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const path = cwd || hello?.dir || "";
  const theme = themeById(prefs.theme);

  return (
    <div ref={rootRef} className="fixed bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      {open ? (
        <div className="w-64 rounded-lg border border-border bg-card/95 p-3 text-xs shadow-xl backdrop-blur">
          <div className="mb-1 flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${stateColor[state]}`} aria-hidden />
            <span className="truncate font-semibold">{hello?.session ?? "term"}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{stateLabel[state]}</span>
          </div>
          <div className="mb-3 truncate font-mono text-[11px] text-muted-foreground" title={path}>
            {path || "…"}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Font</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onFont(-1)}
                aria-label="Decrease font size"
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                A−
              </button>
              <span className="w-5 text-center tabular-nums">{prefs.fontSize}</span>
              <button
                type="button"
                onClick={() => onFont(1)}
                aria-label="Increase font size"
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                A+
              </button>
            </span>
          </div>

          <label className="mt-2 block">
            <span className="text-muted-foreground">Theme</span>
            <select
              value={prefs.theme}
              onChange={(event) => onTheme(event.target.value as ThemeId)}
              className="mt-1 w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
            >
              {themes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {theme.dark ? "dark" : "light"} · Ctrl+V paste · Ctrl+,
            </span>
            {state === "closed" ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  onReconnect();
                }}
                className="shrink-0 rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
              >
                Reconnect
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Settings"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground shadow backdrop-blur transition-colors hover:bg-card hover:text-foreground"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2 4.5h12M2 8h12M2 11.5h12" />
          <circle cx="5.5" cy="4.5" r="1.6" fill="currentColor" />
          <circle cx="10.5" cy="8" r="1.6" fill="currentColor" />
          <circle cx="6.5" cy="11.5" r="1.6" fill="currentColor" />
        </svg>
        {state !== "open" ? <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${stateColor[state]}`} /> : null}
      </button>
    </div>
  );
}
