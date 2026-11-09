import { describe, expect, it } from "vitest";

import { chunkBytes } from "./input";

describe("chunkBytes", () => {
  it("splits a large paste into bounded frames", () => {
    const data = new Uint8Array(200);
    data.forEach((_value, index) => {
      data[index] = index % 256;
    });
    const chunks = chunkBytes(data, 64);
    expect(chunks.map((chunk) => chunk.length)).toEqual([64, 64, 64, 8]);
    expect(chunks[0][0]).toBe(0);
    expect(chunks[3][7]).toBe(199);
  });

  it("keeps a small paste in one frame", () => {
    const data = new Uint8Array(10);
    expect(chunkBytes(data, 64)).toHaveLength(1);
  });

  it("does not return an empty frame", () => {
    expect(chunkBytes(new Uint8Array(0), 64)).toEqual([]);
  });
});
