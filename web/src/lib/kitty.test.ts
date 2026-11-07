import { describe, expect, test } from "vitest";

import { KittyStream, parseKitty, type KittyImage, type KittyPart } from "./kitty";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("parseKitty", () => {
  test("accepts a PNG transmit-and-display", () => {
    const image = parseKitty(`Gf=100,a=T,c=4,r=3;${PNG}`);
    expect(image).not.toBeNull();
    expect(image?.src).toBe(`data:image/png;base64,${PNG}`);
    expect(image?.cols).toBe(4);
    expect(image?.rows).toBe(3);
  });

  test("accepts a missing action", () => {
    expect(parseKitty(`Gf=100;${PNG}`)).not.toBeNull();
  });

  test("ignores unknown keys but keeps the image", () => {
    expect(parseKitty(`Gf=100,a=T,z=-1,x=9;${PNG}`)).not.toBeNull();
  });

  test("ignores chunked images", () => {
    expect(parseKitty(`Gf=100,a=T,m=1;${PNG}`)).toBeNull();
  });

  test("ignores transmit-only images", () => {
    expect(parseKitty(`Gf=100,a=t;${PNG}`)).toBeNull();
  });

  test("ignores non-PNG formats", () => {
    expect(parseKitty(`Gf=32,a=T;AAAA`)).toBeNull();
  });

  test("ignores garbage", () => {
    expect(parseKitty("Gf=100;not base64!!")).toBeNull();
    expect(parseKitty("hello")).toBeNull();
    expect(parseKitty("Gf=100;")).toBeNull();
  });
});

describe("KittyStream", () => {
  const text = (parts: KittyPart[]) => parts.filter((part): part is string => typeof part === "string").join("");
  const images = (parts: KittyPart[]) => parts.filter((part): part is KittyImage => typeof part !== "string");

  test("strips the image command and keeps the text", () => {
    const stream = new KittyStream();
    const result = stream.push(`before\x1b_Gf=100,a=T;${PNG}\x1b\\after`);
    expect(text(result.parts)).toBe("beforeafter");
    expect(images(result.parts)).toHaveLength(1);
  });

  test("keeps the order of text and images", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\x1b_Gf=100,a=T;${PNG}\x1b\\b`);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toBe("a");
    expect(result.parts[2]).toBe("b");
  });

  test("handles a command split across chunks", () => {
    const stream = new KittyStream();
    const first = stream.push(`\x1b_Gf=100,a=T;${PNG.slice(0, 10)}`);
    expect(text(first.parts)).toBe("");
    expect(images(first.parts)).toHaveLength(0);
    const second = stream.push(`${PNG.slice(10)}\x1b\\done`);
    expect(text(second.parts)).toBe("done");
    expect(images(second.parts)).toHaveLength(1);
  });

  test("holds a split escape prefix", () => {
    const stream = new KittyStream();
    expect(text(stream.push("abc\x1b").parts)).toBe("abc");
    const rest = stream.push(`_Gf=100,a=T;${PNG}\x1b\\!`);
    expect(text(rest.parts)).toBe("!");
    expect(images(rest.parts)).toHaveLength(1);
  });

  test("never emits an APC sequence as text", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\x1b_Gi=31;AAAA\x1b\\b`);
    expect(text(result.parts)).toBe("ab");
    expect(images(result.parts)).toHaveLength(0);
  });
});
