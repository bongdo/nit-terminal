export function osc52Text(data: string): string | null {
  if (data.length > 200_000) return null;
  const parts = data.split(";");
  if (parts.length < 2) return null;
  const payload = parts.length >= 3 ? parts[2] : parts[1];
  if (!payload || payload === "?" || payload.length > 100_000) return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
