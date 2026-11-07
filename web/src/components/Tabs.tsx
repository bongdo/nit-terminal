import type { SessionInfo } from "../lib/api";

type Props = {
  sessions: SessionInfo[];
  active: string;
};

function label(dir: string): string {
  const trimmed = dir.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return base || "/";
}

export default function Tabs({ sessions, active }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
      <span className="mr-1 shrink-0 px-1 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">TERM</span>
      {sessions.map((session) => {
        const current = session.name === active;
        return (
          <button
            key={session.name}
            type="button"
            aria-current={current ? "page" : undefined}
            title={`${session.dir}${session.tmux ? " · tmux" : ""}`}
            onClick={() => {
              if (current) return;
              window.location.assign(`${window.location.pathname}?session=${encodeURIComponent(session.name)}`);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
              current
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${session.attached > 0 ? "bg-emerald-500" : "bg-border"}`} />
            <span className="max-w-48 truncate font-medium">{label(session.dir)}</span>
            {session.attached > 1 ? (
              <span className="rounded bg-background/60 px-1 text-[10px] tabular-nums">{session.attached}</span>
            ) : null}
          </button>
        );
      })}
      {sessions.length === 0 ? <span className="px-1 text-xs text-muted-foreground">no sessions</span> : null}
    </div>
  );
}
