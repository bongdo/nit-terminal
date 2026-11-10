import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { coverDimensions } from "../lib/fit";
import { chunkBytes } from "../lib/input";
import { KittyStream, type KittyImage, type KittyPart, type KittyPixels } from "../lib/kitty";
import { findPaths, peroHref, resolvePath } from "../lib/links";
import { osc52Text } from "../lib/osc52";
import { themeFor, type Prefs } from "../lib/theme";
import { checkURL, wsURL, type Target } from "../lib/url";

export type ConnState = "connecting" | "open" | "closed";

export type SessionHello = {
  type: string;
  session: string;
  dir: string;
  home: string;
  tmux: boolean;
  peroURL: string;
  dropURL?: string;
};

const HIGH_WATERMARK = 4 * 1024 * 1024;
const LOW_WATERMARK = 512 * 1024;
const MAX_QUEUE = 32 * 1024 * 1024;
const MAX_INPUT = 64 * 1024;

const MOBILE_KEYS = [
  { label: "Esc", data: "\x1b", aria: "Send Escape", scroll: 0 },
  { label: "Tab", data: "\t", aria: "Send Tab", scroll: 0 },
  { label: "←", data: "\x1b[D", aria: "Send Left", scroll: 0 },
  { label: "↑", data: "\x1b[A", aria: "Send Up", scroll: 0 },
  { label: "↓", data: "\x1b[B", aria: "Send Down", scroll: 0 },
  { label: "→", data: "\x1b[C", aria: "Send Right", scroll: 0 },
  { label: "⇞", data: "", aria: "Scroll up", scroll: -1 },
  { label: "⇟", data: "", aria: "Scroll down", scroll: 1 },
];

function partSize(part: KittyPart): number {
  if (typeof part === "string") return part.length;
  if (part.kind === "pixels") return part.bytes.length;
  if (part.kind === "image") return part.src.length;
  return 0;
}

type Props = {
  target: Target;
  prefs: Prefs;
  reconnectToken: number;
  onHello: (hello: SessionHello) => void;
  onState: (state: ConnState) => void;
  onCwd: (cwd: string) => void;
  onToast: (message: string) => void;
};

function pixelsToSrc(pixels: KittyPixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(pixels.width, pixels.height);
  if (pixels.channels === 4) {
    image.data.set(pixels.bytes);
  } else {
    for (let source = 0, target = 0; source + 2 < pixels.bytes.length; source += 3, target += 4) {
      image.data[target] = pixels.bytes[source];
      image.data[target + 1] = pixels.bytes[source + 1];
      image.data[target + 2] = pixels.bytes[source + 2];
      image.data[target + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export default function TerminalView({ target, prefs, reconnectToken, onHello, onState, onCwd, onToast }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitNowRef = useRef<() => void>(() => {});
  const sendResizeRef = useRef<() => void>(() => {});
  const sendKeyRef = useRef<(data: string) => void>(() => {});
  const metaRef = useRef<SessionHello | null>(null);
  const cwdRef = useRef("");
  const tmuxRef = useRef<boolean | null>(null);
  const ctrlArmedRef = useRef(false);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const handlersRef = useRef({ onHello, onState, onCwd, onToast });
  handlersRef.current = { onHello, onState, onCwd, onToast };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    tmuxRef.current = null;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: prefs.fontSize,
      theme: themeFor(prefs),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      linkHandler: {
        allowNonHttpProtocols: false,
        activate: (_event, text) => {
          if (text.length > 2000 || !/^https?:\/\//i.test(text)) return;
          if (!window.confirm(`Open ${text}?`)) return;
          window.open(text, "_blank", "noopener,noreferrer");
        },
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);
    termRef.current = term;

    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const screen = host.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const box = screen.getBoundingClientRect();
      const size = coverDimensions(host.clientWidth, host.clientHeight, box.width / term.cols, box.height / term.rows);
      if (size && (size.cols !== term.cols || size.rows !== term.rows)) term.resize(size.cols, size.rows);
    };
    fitNowRef.current = fitNow;
    fitNow();

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => handlersRef.current.onToast("Clipboard blocked; use Ctrl+Shift+V"));
        return false;
      }
      return true;
    });

    type Overlay = { el: HTMLImageElement; line: number; column: number; cols?: number; rows?: number; id?: number };
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

    const removeOverlays = (id?: number) => {
      for (let index = overlays.length - 1; index >= 0; index--) {
        if (id === undefined || overlays[index].id === id) {
          overlays[index].el.remove();
          overlays.splice(index, 1);
        }
      }
    };

    const clearOverlays = () => removeOverlays();

    const draw = (image: KittyImage | KittyPixels) => {
      const src = image.kind === "image" ? image.src : pixelsToSrc(image);
      if (!src) return;
      const element = document.createElement("img");
      element.src = src;
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
        id: image.id,
      });
      while (overlays.length > 32) overlays.shift()?.el.remove();
      position();
    };

    const queue: KittyPart[] = [];
    let queuedBytes = 0;
    let writing = false;
    let flowPaused = false;
    let dropped = false;
    let socket: WebSocket | null = null;

    const sendFlow = (paused: boolean) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "flow", paused }));
    };

    const updateFlow = () => {
      if (queuedBytes > HIGH_WATERMARK && !flowPaused) {
        flowPaused = true;
        sendFlow(true);
        handlersRef.current.onToast("Output paused: terminal is behind");
      } else if (queuedBytes < LOW_WATERMARK && flowPaused) {
        flowPaused = false;
        sendFlow(false);
        handlersRef.current.onToast("Output resumed");
      }
    };

    const pump = () => {
      if (writing) return;
      const part = queue.shift();
      if (part === undefined) return;
      const size = partSize(part);
      if (typeof part === "string") {
        if (part === "") {
          pump();
          return;
        }
        writing = true;
        term.write(part, () => {
          writing = false;
          queuedBytes = Math.max(0, queuedBytes - size);
          updateFlow();
          pump();
        });
        return;
      }
      if (part.kind === "delete") {
        removeOverlays(part.id);
      } else {
        draw(part);
      }
      queuedBytes = Math.max(0, queuedBytes - size);
      updateFlow();
      pump();
    };

    const enqueue = (parts: KittyPart[]) => {
      for (const part of parts) {
        const size = partSize(part);
        if (queuedBytes + size > MAX_QUEUE) {
          if (!dropped) {
            dropped = true;
            handlersRef.current.onToast("Output dropped: terminal is too slow");
          }
          continue;
        }
        if (typeof part === "string" && queue.length > 0) {
          const last = queue[queue.length - 1];
          if (typeof last === "string" && last.length + part.length <= 64 * 1024) {
            queue[queue.length - 1] = last + part;
            queuedBytes += part.length;
            continue;
          }
        }
        queue.push(part);
        queuedBytes += size;
      }
      updateFlow();
      pump();
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
      const text = osc52Text(data);
      if (text !== null) copyText(text, "Copied from terminal");
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

    let disposed = false;
    let fatal = false;
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
      if (socket?.readyState !== WebSocket.OPEN) return;
      for (const chunk of chunkBytes(data, MAX_INPUT)) socket.send(chunk.slice().buffer as ArrayBuffer);
    };
    sendKeyRef.current = (data: string) => send(encoder.encode(data));

    const paste = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      if (!navigator.clipboard) return;
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch(() => {});
    };
    host.addEventListener("mousedown", paste);

    const preflight = async () => {
      try {
        const response = await fetch(checkURL(target, window.location), {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.ok) return true;
        let message = `Request rejected (${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          void 0;
        }
        if (response.status === 401) message = "Session expired; reload to sign in";
        handlersRef.current.onToast(message);
        handlersRef.current.onState("closed");
        return false;
      } catch {
        return true;
      }
    };

    const connect = async () => {
      if (disposed) return;
      if (!(await preflight()) || disposed) return;
      fatal = false;
      handlersRef.current.onState("connecting");
      const ws = new WebSocket(wsURL(target, window.location));
      socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        retry = 0;
        handlersRef.current.onState("open");
        fitNow();
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
            tmuxRef.current = hello.tmux;
            handlersRef.current.onHello(hello);
            if (hello.dir) {
              cwdRef.current = hello.dir;
              handlersRef.current.onCwd(hello.dir);
            }
          } else if (message.type === "error" && typeof message.error === "string") {
            fatal = true;
            handlersRef.current.onToast(message.error);
          }
          return;
        }
        if (!(event.data instanceof ArrayBuffer)) return;
        const text = decoder.decode(new Uint8Array(event.data), { stream: true });
        enqueue(kitty.push(text).parts);
      };
      ws.onclose = (event) => {
        handlersRef.current.onState("closed");
        if (disposed) return;
        if (event.code === 1008) {
          if (!fatal) handlersRef.current.onToast(event.reason || "session rejected");
          return;
        }
        const delay = Math.min(5000, 500 * 2 ** retry);
        retry += 1;
        retryTimer = window.setTimeout(() => {
          term.reset();
          decoder = new TextDecoder();
          kitty = new KittyStream();
          queue.length = 0;
          queuedBytes = 0;
          flowPaused = false;
          dropped = false;
          clearOverlays();
          void connect();
        }, delay);
      };
    };
    void connect();

    const input = term.onData((data) => {
      let output = data;
      if (ctrlArmedRef.current && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) output = String.fromCharCode(code & 0x1f);
        ctrlArmedRef.current = false;
        setCtrlArmed(false);
      }
      send(encoder.encode(output));
    });

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        fitNow();
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
      queue.length = 0;
      clearOverlays();
      term.dispose();
      termRef.current = null;
      fitNowRef.current = () => {};
      sendResizeRef.current = () => {};
      sendKeyRef.current = () => {};
    };
  }, [target, reconnectToken]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themeFor(prefs);
    term.options.fontSize = prefs.fontSize;
    fitNowRef.current();
    sendResizeRef.current();
  }, [prefs]);

  const sendKey = (data: string) => {
    ctrlArmedRef.current = false;
    setCtrlArmed(false);
    sendKeyRef.current(data);
    termRef.current?.focus();
  };

  const scrollTerminal = (delta: number) => {
    ctrlArmedRef.current = false;
    setCtrlArmed(false);
    if (tmuxRef.current === false) {
      termRef.current?.scrollPages(delta);
    } else {
      sendKeyRef.current(delta < 0 ? "\x1b[23~" : "\x1b[24~");
    }
    termRef.current?.focus();
  };

  const toggleCtrl = () => {
    ctrlArmedRef.current = !ctrlArmedRef.current;
    setCtrlArmed(ctrlArmedRef.current);
    termRef.current?.focus();
  };

  const pasteClipboard = () => {
    ctrlArmedRef.current = false;
    setCtrlArmed(false);
    const term = termRef.current;
    if (!term || !navigator.clipboard) {
      onToast("Clipboard unavailable");
      return;
    }
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) term.paste(text);
        term.focus();
      })
      .catch(() => onToast("Clipboard blocked"));
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div ref={hostRef} className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-md bg-background" />
      <div className="mobile-keys shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-card/95 px-2 py-1 backdrop-blur" aria-label="Mobile terminal keys">
        <button
          type="button"
          onClick={toggleCtrl}
          onPointerDown={(event) => event.preventDefault()}
          aria-label="Sticky Ctrl"
          aria-pressed={ctrlArmed}
          title="Sticky Ctrl"
          className={`min-w-9 rounded border px-1.5 py-1 text-xs ${ctrlArmed ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
        >
          Ctrl
        </button>
        {MOBILE_KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            onClick={() => (key.scroll === 0 ? sendKey(key.data) : scrollTerminal(key.scroll))}
            onPointerDown={(event) => event.preventDefault()}
            aria-label={key.aria}
            title={key.aria}
            className="min-w-8 rounded border border-border px-1.5 py-1 text-xs text-muted-foreground"
          >
            {key.label}
          </button>
        ))}
        <button
          type="button"
          onClick={pasteClipboard}
          onPointerDown={(event) => event.preventDefault()}
          aria-label="Paste from clipboard"
          title="Paste from clipboard"
          className="ml-auto min-w-10 rounded border border-border px-1.5 py-1 text-xs text-muted-foreground"
        >
          Paste
        </button>
      </div>
    </div>
  );
}
