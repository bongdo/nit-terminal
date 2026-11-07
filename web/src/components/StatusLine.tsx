import type { ConnState, SessionHello } from "./TerminalView";
import { paletteLabels, type PaletteId, type Prefs } from "../lib/theme";

type Props = {
  hello: SessionHello | null;
  state: ConnState;
  cwd: string;
  prefs: Prefs;
  onFont: (delta: number) => void;
  onPalette: (palette: PaletteId) => void;
  onMode: () => void;
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

export default function StatusLine({ hello, state, cwd, prefs, onFont, onPalette, onMode, onReconnect }: Props) {
  const path = cwd || hello?.dir || "";
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-3 py-1.5 text-xs">
      <span className={`h-2 w-2 shrink-0 rounded-full ${stateColor[state]}`} aria-hidden />
      <span className="font-semibold tracking-wide">{hello?.session ?? "term"}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={path}>
        {path || "…"}
      </span>
      {hello?.tmux ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">tmux</span> : null}
      <span className="shrink-0 text-muted-foreground">{stateLabel[state]}</span>
      {state === "closed" ? (
        <button type="button" onClick={onReconnect} className="shrink-0 rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground">
          reconnect
        </button>
      ) : null}
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => onFont(-1)} aria-label="Decrease font size" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          A−
        </button>
        <span className="w-5 text-center tabular-nums text-muted-foreground">{prefs.fontSize}</span>
        <button type="button" onClick={() => onFont(1)} aria-label="Increase font size" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          A+
        </button>
      </span>
      <select
        value={prefs.palette}
        onChange={(event) => onPalette(event.target.value as PaletteId)}
        aria-label="Palette"
        className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
      >
        {Object.entries(paletteLabels).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <button type="button" onClick={onMode} aria-label="Toggle theme" className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        {prefs.mode === "dark" ? "☾" : "☀"}
      </button>
    </div>
  );
}
