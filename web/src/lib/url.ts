export type Target =
  | { kind: "dir"; dir: string }
  | { kind: "session"; session: string }
  | { kind: "home" };

export function parseTarget(search: string): Target {
  const params = new URLSearchParams(search);
  const dir = (params.get("dir") ?? "").trim();
  const session = (params.get("session") ?? "").trim();
  if (dir !== "") return { kind: "dir", dir };
  if (session !== "") return { kind: "session", session };
  return { kind: "home" };
}

export function queryFor(target: Target): string {
  switch (target.kind) {
    case "dir":
      return `?dir=${encodeURIComponent(target.dir)}`;
    case "session":
      return `?session=${encodeURIComponent(target.session)}`;
    default:
      return "";
  }
}

export function apiBase(pathname: string): string {
  let path = pathname;
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"index.html".length);
  }
  if (!path.endsWith("/")) {
    const last = path.slice(path.lastIndexOf("/") + 1);
    path = last.includes(".") ? path.slice(0, -last.length) : path + "/";
  }
  return path.replace(/\/$/, "");
}

export function wsURL(target: Target, location: Location): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${apiBase(location.pathname)}/api/ws${queryFor(target)}`;
}
