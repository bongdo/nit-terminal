import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { KittyStream, type KittyImage, type KittyPart } from "../lib/kitty";
import { findPaths, peroHref, resolvePath } from "../lib/links";
import { themeFor, type Prefs } from "../lib/theme";
import { wsURL, type Target } from "../lib/url";

export type ConnState = "connecting" | "open" | "closed";

export type SessionHello = {
  type: string;
  session: string;
  dir: string;
  home: string;
  tmux: boolean;
  peroURL: string;
};

type Props = {
  target: Target;
  prefs: Prefs;
  reconnectToken: number;
  onHello: (hello: SessionHello) => void;
  onState: (state: ConnState) => void;
  onCwd: (cwd: string) => void;
  onToast: (message: string) => void;
};

export default function TerminalView({ target, prefs, reconnectToken, onHello, onState, onCwd, onToast }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendResizeRef = useRef<() => void>(() => {});
  const metaRef = useRef<SessionHello | null>(null);
  const cwdRef = useRef("");
  const handlersRef = useRef({ onHello, onState, onCwd, onToast });
  handlersRef.current = { onHello, onState, onCwd, onToast };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: prefs.fontSize,
      theme: themeFor(prefs),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      void 0;
    }

    type Overlay = { el: HTMLImageElement; line: number; column: number; cols?: number; rows?: number };
    const overlays: Overlay[] = [];

    const position = () => {
      const screen = host.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const screenRect = screen.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const cellWidth = screenRect.width / term.cols;
      const cellHeight = screenRect.height / term.rows;
      const base = term.buffer.active.baseY;
      for (const overlay of overlays) {
        const row = overlay.line - base;
        const visible = row >= 0 && row < term.rows;
        overlay.el.style.display = visible ? "block" : "none";
        if (!visible) continue;
        overlay.el.style.left = `${screenRect.left - hostRect.left + overlay.column * cellWidth}px`;
        overlay.el.style.top = `${screenRect.top - hostRect.top + row * cellHeight}px`;
        if (overlay.cols !== undefined) overlay.el.style.width = `${overlay.cols * cellWidth}px`;
        if (overlay.rows !== undefined) overlay.el.style.height = `${overlay.rows * cellHeight}px`;
      }
    };

    const clearOverlays = () => {
      for (const overlay of overlays) overlay.el.remove();
      overlays.length = 0;
    };

    const draw = (image: KittyImage) => {
      const element = document.createElement("img");
      element.src = image.src;
      element.alt = "";
      element.style.position = "absolute";
      element.style.pointerEvents = "none";
      element.style.zIndex = "1";
      host.appendChild(element);
      overlays.push({
        el: element,
        line: term.buffer.active.baseY + term.buffer.active.cursorY,
        column: term.buffer.active.cursorX,
        cols: image.cols,
        rows: image.rows,
      });
      while (overlays.length > 32) overlays.shift()?.el.remove();
      position();
    };

    const writeParts = (parts: KittyPart[], index: number) => {
      if (index >= parts.length) return;
      const part = parts[index];
      if (typeof part === "string") {
        if (part === "") {
          writeParts(parts, index + 1);
          return;
        }
        term.write(part, () => writeParts(parts, index + 1));
        return;
      }
      draw(part);
      writeParts(parts, index + 1);
    };

    const scroll = term.onScroll(position);
    const resized = term.onResize(position);
    const reset = term.parser.registerEscHandler({ final: "c" }, () => {
      clearOverlays();
      return false;
    });
    const erase = term.parser.registerCsiHandler({ final: "J" }, (params) => {
      if (params[0] === 2 || params[0] === 3) clearOverlays();
      return false;
    });

    const copyText = (text: string, message: string) => {
      if (!navigator.clipboard) return;
      navigator.clipboard
        .writeText(text)
        .then(() => handlersRef.current.onToast(message))
        .catch(() => {});
    };

    let copyTimer = 0;
    const selection = term.onSelectionChange(() => {
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        const text = term.getSelection();
        if (!text) return;
        copyText(text, "Copied");
      }, 200);
    });

    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const parts = data.split(";");
      if (parts.length < 3 || parts[1] === "?") return true;
      try {
        const bytes = Uint8Array.from(atob(parts[2]), (char) => char.charCodeAt(0));
        copyText(new TextDecoder().decode(bytes), "Copied from terminal");
      } catch {
        void 0;
      }
      return true;
    });

    const osc7 = term.parser.registerOscHandler(7, (data) => {
      const value = data.replace(/^file:\/\//, "");
      const slash = value.indexOf("/");
      if (slash === -1) return true;
      const path = value.slice(slash);
      try {
        cwdRef.current = decodeURIComponent(path);
      } catch {
        cwdRef.current = path;
      }
      handlersRef.current.onCwd(cwdRef.current);
      return true;
    });

    const links = term.registerLinkProvider({
      provideLinks(y, callback) {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const items = findPaths(text).map((found) => ({
          range: { start: { x: found.start + 1, y }, end: { x: found.start + found.length, y } },
          text: text.slice(found.start, found.start + found.length),
          activate: (event: MouseEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            const meta = metaRef.current;
            const path = resolvePath(found.path, cwdRef.current, meta?.home ?? "");
            window.open(peroHref(meta?.peroURL || "/pero/", path, found.line), "_blank", "noopener,noreferrer");
          },
        }));
        callback(items.length > 0 ? items : undefined);
      },
    });

    let socket: WebSocket | null = null;
    let disposed = false;
    let retry = 0;
    let retryTimer = 0;
    let decoder = new TextDecoder();
    let kitty = new KittyStream();
    const encoder = new TextEncoder();

    const sendResize = () => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const rect = host.getBoundingClientRect();
      socket.send(
        JSON.stringify({
          type: "resize",
          rows: term.rows,
          cols: term.cols,
          pixelWidth: Math.round(rect.width),
          pixelHeight: Math.round(rect.height),
        }),
      );
    };
    sendResizeRef.current = sendResize;

    const send = (data: Uint8Array) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data.buffer as ArrayBuffer);
    };

    const paste = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      if (!navigator.clipboard) return;
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) send(encoder.encode(text));
        })
        .catch(() => {});
    };
    host.addEventListener("mousedown", paste);

    const connect = () => {
      handlersRef.current.onState("connecting");
      const ws = new WebSocket(wsURL(target, window.location));
      socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        retry = 0;
        handlersRef.current.onState("open");
        try {
          fit.fit();
        } catch {
          void 0;
        }
        sendResize();
        term.focus();
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }
          if (message.type === "hello") {
            const hello = message as SessionHello;
            metaRef.current = hello;
            handlersRef.current.onHello(hello);
            if (hello.dir) {
              cwdRef.current = hello.dir;
              handlersRef.current.onCwd(hello.dir);
            }
          } else if (message.type === "error" && typeof message.error === "string") {
            handlersRef.current.onToast(message.error);
          }
          return;
        }
        if (!(event.data instanceof ArrayBuffer)) return;
        const text = decoder.decode(new Uint8Array(event.data), { stream: true });
        const result = kitty.push(text);
        writeParts(result.parts, 0);
      };
      ws.onclose = (event) => {
        handlersRef.current.onState("closed");
        if (disposed) return;
        if (event.code === 1008) {
          handlersRef.current.onToast(event.reason || "session rejected");
          return;
        }
        const delay = Math.min(5000, 500 * 2 ** retry);
        retry += 1;
        retryTimer = window.setTimeout(() => {
          term.reset();
          decoder = new TextDecoder();
          kitty = new KittyStream();
          clearOverlays();
          connect();
        }, delay);
      };
    };
    connect();

    const input = term.onData((data) => send(encoder.encode(data)));

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          void 0;
        }
        sendResize();
        position();
      });
    });
    observer.observe(host);

    return () => {
      disposed = true;
      window.clearTimeout(copyTimer);
      window.clearTimeout(retryTimer);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      socket?.close();
      host.removeEventListener("mousedown", paste);
      selection.dispose();
      scroll.dispose();
      resized.dispose();
      reset.dispose();
      erase.dispose();
      osc52.dispose();
      osc7.dispose();
      links.dispose();
      input.dispose();
      clearOverlays();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sendResizeRef.current = () => {};
    };
  }, [target, reconnectToken]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themeFor(prefs);
    term.options.fontSize = prefs.fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      void 0;
    }
    sendResizeRef.current();
  }, [prefs]);

  return <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-md bg-background" />;
}
