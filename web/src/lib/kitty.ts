export type KittyImage = {
  src: string;
  cols?: number;
  rows?: number;
};

export type KittyPart = string | KittyImage;

export function parseKitty(payload: string): KittyImage | null {
  if (!payload.startsWith("G")) return null;
  const separator = payload.indexOf(";");
  const header = separator === -1 ? payload.slice(1) : payload.slice(1, separator);
  const data = separator === -1 ? "" : payload.slice(separator + 1).trim();
  const params = new Map<string, string>();
  for (const pair of header.split(",")) {
    const index = pair.indexOf("=");
    if (index > 0) params.set(pair.slice(0, index), pair.slice(index + 1));
  }
  if (params.get("m") === "1") return null;
  if (params.get("a") === "t") return null;
  if (params.get("f") !== "100") return null;
  if (data === "" || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  try {
    atob(data);
  } catch {
    return null;
  }
  return {
    src: `data:image/png;base64,${data}`,
    cols: positive(params.get("c")),
    rows: positive(params.get("r")),
  };
}

function positive(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export class KittyStream {
  private pending = "";

  push(chunk: string): { parts: KittyPart[] } {
    const input = this.pending + chunk;
    this.pending = "";
    const parts: KittyPart[] = [];
    let position = 0;
    while (position < input.length) {
      const start = input.indexOf("\x1b_G", position);
      if (start === -1) {
        const keep = input.endsWith("\x1b_") ? 2 : input.endsWith("\x1b") ? 1 : 0;
        const text = input.slice(position, input.length - keep);
        if (text !== "") parts.push(text);
        if (keep > 0) this.pending = input.slice(input.length - keep);
        return { parts };
      }
      const text = input.slice(position, start);
      if (text !== "") parts.push(text);
      const end = input.indexOf("\x1b\\", start + 3);
      if (end === -1) {
        this.pending = input.slice(start);
        if (this.pending.length > 4_000_000) this.pending = "";
        return { parts };
      }
      const image = parseKitty("G" + input.slice(start + 3, end));
      if (image) parts.push(image);
      position = end + 2;
    }
    return { parts };
  }
}
