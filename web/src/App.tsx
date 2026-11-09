import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import Settings from "./components/Settings";
import TerminalView, { type ConnState, type SessionHello } from "./components/TerminalView";
import { loadPrefs, savePrefs, themeFor, themeIsDark, type Prefs, type ThemeId } from "./lib/theme";
import { parseTarget, type Target } from "./lib/url";

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
  const [reconnectToken, setReconnectToken] = useState(0);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", themeIsDark(prefs));
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

  const theme = themeFor(prefs);

  return (
    <div
      className="relative h-dvh overflow-hidden text-foreground"
      style={{ background: theme.background }}
    >
      <TerminalView
        target={target}
        prefs={prefs}
        reconnectToken={reconnectToken}
        onHello={setHello}
        onState={setState}
        onCwd={setCwd}
        onToast={showToast}
      />
      <div
        aria-hidden
        className="from-background via-background/80 pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b to-transparent pt-2 pb-5"
        style={{ "--background": theme.background } as React.CSSProperties}
      />
      {toast ? (
        <div
          key={toast.at}
          className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg"
          role="status"
        >
          {toast.text}
        </div>
      ) : null}
      <Settings
        hello={hello}
        state={state}
        cwd={cwd}
        prefs={prefs}
        onFont={changeFont}
        onTheme={(theme: ThemeId) => setPrefs((current) => ({ ...current, theme }))}
        onReconnect={() => setReconnectToken((value) => value + 1)}
      />
    </div>
  );
}
