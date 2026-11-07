export type FoundPath = {
  start: number;
  length: number;
  path: string;
  line?: number;
};

const LEADING = new Set(["\"", "'", "`", "(", "[", "{", "<"]);
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "\"", "'", "`"]);

export function findPaths(text: string): FoundPath[] {
  const found: FoundPath[] = [];
  const tokens = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text)) !== null) {
    let start = match.index;
    let end = start + match[0].length;
    while (start < end && LEADING.has(text[start])) start++;
    while (end > start && TRAILING.has(text[end - 1])) end--;
    if (end <= start) continue;
    const token = text.slice(start, end);
    if (token.includes("://")) continue;

    const withLine = /^(.+?):(\d+)(?::\d+)?$/.exec(token);
    if (withLine && likelyPath(withLine[1])) {
      found.push({ start, length: end - start, path: withLine[1], line: Number.parseInt(withLine[2], 10) });
      continue;
    }
    if (likelyPath(token)) {
      found.push({ start, length: end - start, path: token });
    }
  }
  return found;
}

function likelyPath(path: string): boolean {
  if (path.includes("://")) return false;
  if (path.startsWith("/")) return path.length > 1;
  if (path === "~" || path.startsWith("~/")) return true;
  if (path.startsWith("./") || path.startsWith("../")) return true;
  if (/^[\w.@%+-]+(\/[\w.@%+-]+)+$/.test(path)) return true;
  if (/^[\w.@-]+\.[A-Za-z0-9]{1,8}$/.test(path)) return true;
  return false;
}

export function resolvePath(path: string, cwd: string, home: string): string {
  let full: string;
  if (path === "~" || path.startsWith("~/")) {
    full = home + path.slice(1);
  } else if (path.startsWith("/")) {
    full = path;
  } else {
    full = `${(cwd || home).replace(/\/+$/, "")}/${path}`;
  }
  const parts: string[] = [];
  for (const segment of full.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return "/" + parts.join("/");
}

export function peroHref(base: string, path: string, line?: number): string {
  const url = base.endsWith("/") ? base : `${base}/`;
  const query = `?open=${encodeURIComponent(path)}`;
  return line === undefined ? url + query : `${url}${query}&line=${line}`;
}
