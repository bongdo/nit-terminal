export function chunkBytes(data: Uint8Array, size = 64 * 1024): Uint8Array[] {
  if (size < 1) return [data];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(data.length, offset + size)));
  }
  return chunks;
}
