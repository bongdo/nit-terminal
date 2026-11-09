import { describe, expect, it } from "vitest";

import { coverDimensions } from "./fit";

describe("coverDimensions", () => {
  it("covers the full viewport, clipping the last cell instead of leaving a gap", () => {
    expect(coverDimensions(801, 601, 8, 20)).toEqual({ cols: 101, rows: 31 });
  });

  it("returns null before the cell size is measured", () => {
    expect(coverDimensions(800, 600, 0, 20)).toBeNull();
  });
});
