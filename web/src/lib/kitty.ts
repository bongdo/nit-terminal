export type KittyImage = {
  kind: "image";
  src: string;
  cols?: number;
  rows?: number;
  id?: number;
};

export type KittyPixels = {
  kind: "pixels";
  bytes: Uint8Array;
  width: number;
  height: number;
  channels: 3 | 4;
  cols?: number;
  rows?: number;
  id?: number;
};

export type KittyDelete = { kind: "delete"; id?: number };

export type KittyPart = string | KittyImage | KittyPixels | KittyDelete;

export type KittyCommand = {
  action: string;
  format?: number;
  more: boolean;
  id?: number;
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  remove?: string;
  data: string;
};

const MAX_DATA = 32 * 1024 * 1024;
const MAX_STORED = 32;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_SIDE = 8192;

function findTerminator(input: string, from: number): number {
  let index = input.indexOf("\x1b\\", from);
  while (index !== -1) {
    let escapes = 0;
    for (let cursor = index; cursor >= from && input[cursor] === "\x1b"; cursor--) escapes++;
    if (escapes % 2 === 1) return index;
    index = input.indexOf("\x1b\\", index + 2);
  }
  return -1;
}

export function parseKitty(payload: string): KittyCommand | null {
  if (!payload.startsWith("G")) return null;
  const separator = payload.indexOf(";");
  const header = separator === -1 ? payload.slice(1) : payload.slice(1, separator);
  const data = separator === -1 ? "" : payload.slice(separator + 1).trim();
  const params = new Map<string, string>();
  for (const pair of header.split(",")) {
    const index = pair.indexOf("=");
    if (index > 0) params.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const format = number(params.get("f"));
  if (format !== undefined && format !== 24 && format !== 32 && format !== 100) return null;
  return {
    action: params.get("a") ?? "T",
    format,
    more: params.get("m") === "1",
    id: positive(params.get("i")),
    cols: positive(params.get("c")),
    rows: positive(params.get("r")),
    width: positive(params.get("s")),
    height: positive(params.get("v")),
    remove: params.get("d"),
    data,
  };
}

function number(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sizeAllowed(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_PIXELS;
}

function pngSize(data: string): { width: number; height: number } | null {
  if (data.length < 32) return null;
  let head: string;
  try {
    head = atob(data.slice(0, 32));
  } catch {
    return null;
  }
  if (head.length < 24 || head.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || head.slice(12, 16) !== "IHDR") return null;
  return { width: readUint32(head, 16), height: readUint32(head, 20) };
}

function readUint32(value: string, offset: number): number {
  return (
    ((value.charCodeAt(offset) << 24) |
      (value.charCodeAt(offset + 1) << 16) |
      (value.charCodeAt(offset + 2) << 8) |
      value.charCodeAt(offset + 3)) >>>
    0
  );
}

function positive(value: string | undefined): number | undefined {
  const parsed = number(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function merge(base: KittyCommand, next: KittyCommand): KittyCommand {
  return {
    action: base.action,
    format: base.format ?? next.format,
    more: false,
    id: base.id ?? next.id,
    cols: base.cols ?? next.cols,
    rows: base.rows ?? next.rows,
    width: base.width ?? next.width,
    height: base.height ?? next.height,
    remove: base.remove ?? next.remove,
    data: base.data + next.data,
  };
}

function placed(image: KittyImage | KittyPixels, command: KittyCommand): KittyImage | KittyPixels {
  return { ...image, cols: command.cols ?? image.cols, rows: command.rows ?? image.rows };
}

export class KittyStream {
  private pending = "";
  private chunk: KittyCommand | null = null;
  private skipMarks = false;
  private stored = new Map<number, KittyImage | KittyPixels>();

  push(chunk: string): { parts: KittyPart[] } {
    const input = this.pending + chunk;
    this.pending = "";
    const parts: KittyPart[] = [];
    let position = 0;
    while (position < input.length) {
      const apc = input.indexOf("\x1b_", position);
      const dcs = input.indexOf("\x1bP", position);
      const start = apc === -1 ? dcs : dcs === -1 ? apc : Math.min(apc, dcs);
      if (start === -1) {
        const keep = input.endsWith("\x1b") ? 1 : 0;
        const text = this.clean(input.slice(position, input.length - keep));
        if (text !== "") parts.push(text);
        if (keep > 0) this.pending = input.slice(input.length - keep);
        return { parts };
      }
      if (start > position) {
        const text = this.clean(input.slice(position, start));
        if (text !== "") parts.push(text);
      }
      const end = findTerminator(input, start + 2);
      if (end === -1) {
        this.pending = input.slice(start);
        if (this.pending.length > MAX_DATA) this.pending = "";
        return { parts };
      }
      const payload = input.slice(start + 2, end);
      position = end + 2;
      if (start === apc) {
        if (payload.startsWith("G")) parts.push(...this.command(payload));
      } else if (payload.startsWith("tmux;")) {
        parts.push(...this.tmux(payload.slice(5)));
      }
    }
    return { parts };
  }

  private clean(value: string): string {
    if (!this.skipMarks && !value.includes("\u{10eeee}")) return value;
    let result = "";
    for (const char of value) {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0x10eeee) {
        this.skipMarks = true;
        continue;
      }
      if (this.skipMarks && code >= 0x0300 && code <= 0x036f) continue;
      this.skipMarks = false;
      result += char;
    }
    return result;
  }

  private tmux(inner: string): KittyPart[] {
    const text = inner.replace(/\x1b\x1b/g, "\x1b");
    const parts: KittyPart[] = [];
    let position = 0;
    while (position < text.length) {
      const start = text.indexOf("\x1b_", position);
      if (start === -1) {
        const remaining = this.clean(text.slice(position));
        if (remaining !== "") parts.push(remaining);
        break;
      }
      if (start > position) {
        const leading = this.clean(text.slice(position, start));
        if (leading !== "") parts.push(leading);
      }
      const end = text.indexOf("\x1b\\", start + 2);
      if (end === -1) break;
      const payload = text.slice(start + 2, end);
      if (payload.startsWith("G")) parts.push(...this.command(payload));
      position = end + 2;
    }
    return parts;
  }

  private command(payload: string): KittyPart[] {
    const parsed = parseKitty(payload);
    if (!parsed) return [];
    if (parsed.more) {
      this.chunk = this.chunk ? { ...merge(this.chunk, parsed), more: true } : parsed;
      if (this.chunk.data.length > MAX_DATA) this.chunk = null;
      return [];
    }
    const command = this.chunk ? merge(this.chunk, parsed) : parsed;
    this.chunk = null;
    return this.render(command);
  }

  private render(command: KittyCommand): KittyPart[] {
    switch (command.action) {
      case "d": {
        const target = command.remove ?? "a";
        if (target === "a" || target === "A") return [{ kind: "delete" }];
        if (target === "i" && command.id !== undefined) return [{ kind: "delete", id: command.id }];
        return [];
      }
      case "q":
        return [];
      case "t": {
        const image = this.build(command);
        if (image) this.remember(command.id, image);
        return [];
      }
      case "p": {
        if (command.id === undefined) return [];
        const image = this.stored.get(command.id);
        return image ? [placed(image, command)] : [];
      }
      case "T": {
        const image = this.build(command);
        if (!image) return [];
        this.remember(command.id, image);
        return [image];
      }
      default:
        return [];
    }
  }

  private build(command: KittyCommand): KittyImage | KittyPixels | null {
    if (command.data === "" || !/^[A-Za-z0-9+/=]+$/.test(command.data)) return null;
    const format = command.format ?? 32;
    if (format === 100) {
      const size = pngSize(command.data);
      if (!size || !sizeAllowed(size.width, size.height)) return null;
      return { kind: "image", src: `data:image/png;base64,${command.data}`, cols: command.cols, rows: command.rows, id: command.id };
    }
    const width = command.width;
    const height = command.height;
    if (!width || !height || !sizeAllowed(width, height)) return null;
    const channels: 3 | 4 = format === 32 ? 4 : 3;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(command.data), (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
    if (bytes.length !== width * height * channels) return null;
    return { kind: "pixels", bytes, width, height, channels, cols: command.cols, rows: command.rows, id: command.id };
  }

  private remember(id: number | undefined, image: KittyImage | KittyPixels): void {
    if (id === undefined) return;
    this.stored.delete(id);
    this.stored.set(id, image);
    while (this.stored.size > MAX_STORED) {
      const first = this.stored.keys().next().value;
      if (first === undefined) break;
      this.stored.delete(first);
    }
  }
}
