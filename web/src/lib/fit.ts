export function coverDimensions(width: number, height: number, cellWidth: number, cellHeight: number) {
  if (cellWidth <= 0 || cellHeight <= 0) return null;
  return {
    cols: Math.max(2, Math.ceil(width / cellWidth)),
    rows: Math.max(1, Math.ceil(height / cellHeight)),
  };
}
