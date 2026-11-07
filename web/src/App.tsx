import { useCallback, useEffect, useState } from "react";

import StatusLine from "./components/StatusLine";
import Tabs from "./components/Tabs";
import TerminalView, { type ConnState, type SessionHello } from "./components/TerminalView";
import { fetchSessions, type SessionInfo } from "./lib/api";
import { loadPrefs, savePrefs, type PaletteId, type Prefs } from "./lib/theme";
import { apiBase, parseTarget, type Target } from "./lib/url";

type Toast = { text: string; at: number };

export default function App() {
  const [target] = useState<Target>(() => {
    const parsed = parseTarget(window.location.search);
    window.history.replaceState(null, "", window.location.pathname);
    return parsed;
  });
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [state, setState] = useState<ConnState>("connecting");
  const [hello, setHello] = useState<SessionHello | null>(null);
  const [cwd, setCwd] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [reconnectToken, setReconnectToken] = useState(0);

  const base = apiBase(window.location.pathname);

  const refresh = useCallback(() => {
    fetchSessions(base)
      .then(setSessions)
      .catch(() => {});
  }, [base]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!hello) return;
    refresh();
  }, [hello, refresh]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.mode === "dark");
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((message: string) => {
    setToast({ text: message, at: Date.now() });
  }, []);

  const changeFont = (delta: number) => {
    setPrefs((current) => ({ ...current, fontSize: Math.min(28, Math.max(9, current.fontSize + delta)) }));
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Tabs sessions={sessions} active={hello?.session ?? ""} />
      <div className="relative min-h-0 flex-1 p-2">
        <TerminalView
          target={target}
          prefs={prefs}
          reconnectToken={reconnectToken}
          onHello={setHello}
          onState={setState}
          onCwd={setCwd}
          onToast={showToast}
        />
        {toast ? (
          <div
            key={toast.at}
            className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg"
            role="status"
          >
            {toast.text}
          </div>
        ) : null}
      </div>
      <StatusLine
        hello={hello}
        state={state}
        cwd={cwd}
        prefs={prefs}
        onFont={changeFont}
        onPalette={(palette: PaletteId) => setPrefs((current) => ({ ...current, palette }))}
        onMode={() => setPrefs((current) => ({ ...current, mode: current.mode === "dark" ? "light" : "dark" }))}
        onReconnect={() => setReconnectToken((value) => value + 1)}
      />
    </div>
  );
}
