import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import Settings from "./components/Settings";
import TerminalView, { type ConnState, type SessionHello } from "./components/TerminalView";
import { loadPrefs, savePrefs, themeFor, themeIsDark, type Prefs, type ThemeId } from "./lib/theme";
import { parseTarget, type Target } from "./lib/url";

type Toast = { text: string; at: number };

export default function App() {
  const [target] = useState<Target>(() => {
    const parsed = parseTarget(window.location.search);
    if (!window.location.search) {
      const saved = (window.history.state as { target?: Target } | null)?.target;
      if (saved?.kind === "dir" && typeof saved.dir === "string") return saved;
      if (saved?.kind === "session" && typeof saved.session === "string") return saved;
      if (saved?.kind === "home") return saved;
    }
    window.history.replaceState({ target: parsed }, "", window.location.pathname);
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

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const next = `${Math.round(viewport.height)}px`;
      if (document.documentElement.style.getPropertyValue("--app-height") !== next) {
        document.documentElement.style.setProperty("--app-height", next);
      }
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast({ text: message, at: Date.now() });
  }, []);

  const changeFont = (delta: number) => {
    setPrefs((current) => ({ ...current, fontSize: Math.min(28, Math.max(9, current.fontSize + delta)) }));
  };

  const theme = themeFor(prefs);

  return (
    <div
      className="relative overflow-hidden text-foreground"
      style={{ height: "var(--app-height, 100dvh)", background: theme.background }}
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
      {prefs.fade ? (
        <div
          aria-hidden
          className="from-background via-background/80 pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b to-transparent pt-2 pb-5"
          style={{ "--background": theme.background } as React.CSSProperties}
        />
      ) : null}
      {toast ? (
        <div
          key={toast.at}
          className="toast-root pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg"
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
        onFade={(fade: boolean) => setPrefs((current) => ({ ...current, fade }))}
        onReconnect={() => setReconnectToken((value) => value + 1)}
      />
    </div>
  );
}
