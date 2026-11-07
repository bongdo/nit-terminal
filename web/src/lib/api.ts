export type SessionInfo = {
  name: string;
  dir: string;
  tmux: boolean;
  attached: number;
};

export async function fetchSessions(base: string): Promise<SessionInfo[]> {
  const response = await fetch(`${base}/api/sessions`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`sessions: ${response.status}`);
  const body = (await response.json()) as { sessions?: SessionInfo[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}
