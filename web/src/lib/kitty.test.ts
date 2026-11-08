import { describe, expect, test } from "vitest";

import { KittyStream, parseKitty, type KittyImage, type KittyPart, type KittyPixels } from "./kitty";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const text = (parts: KittyPart[]) => parts.filter((part): part is string => typeof part === "string").join("");
const images = (parts: KittyPart[]) => parts.filter((part): part is KittyImage => typeof part !== "string" && part.kind === "image");
const pixels = (parts: KittyPart[]) => parts.filter((part): part is KittyPixels => typeof part !== "string" && part.kind === "pixels");

function wrap(sequence: string): string {
  return `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

function base64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("parseKitty", () => {
  test("reads a PNG transmit-and-display", () => {
    const command = parseKitty(`Gf=100,a=T,c=4,r=3;${PNG}`);
    expect(command?.action).toBe("T");
    expect(command?.format).toBe(100);
    expect(command?.cols).toBe(4);
    expect(command?.rows).toBe(3);
    expect(command?.data).toBe(PNG);
  });

  test("defaults the action to display", () => {
    expect(parseKitty(`Gf=100;${PNG}`)?.action).toBe("T");
  });

  test("keeps unknown keys out of the way", () => {
    expect(parseKitty(`Gf=100,a=T,z=-1,x=9,U=1;${PNG}`)?.action).toBe("T");
  });

  test("rejects unsupported formats and garbage", () => {
    expect(parseKitty(`Gf=3,a=T;AAAA`)).toBeNull();
    expect(parseKitty("hello")).toBeNull();
  });
});

describe("KittyStream", () => {
  test("strips the image command and keeps the text", () => {
    const stream = new KittyStream();
    const result = stream.push(`before\x1b_Gf=100,a=T;${PNG}\x1b\\after`);
    expect(text(result.parts)).toBe("beforeafter");
    expect(images(result.parts)).toHaveLength(1);
    expect(images(result.parts)[0].src).toBe(`data:image/png;base64,${PNG}`);
  });

  test("keeps the order of text and images", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\x1b_Gf=100,a=T;${PNG}\x1b\\b`);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toBe("a");
    expect(result.parts[2]).toBe("b");
  });

  test("joins chunked PNG data", () => {
    const stream = new KittyStream();
    const first = stream.push(`\x1b_Gf=100,a=T,m=1;${PNG.slice(0, 20)}\x1b\\`);
    expect(first.parts).toHaveLength(0);
    const second = stream.push(`\x1b_Gm=0;${PNG.slice(20)}\x1b\\done`);
    expect(images(second.parts)).toHaveLength(1);
    expect(images(second.parts)[0].src).toBe(`data:image/png;base64,${PNG}`);
    expect(text(second.parts)).toBe("done");
  });

  test("renders raw RGBA", () => {
    const stream = new KittyStream();
    const result = stream.push(`\x1b_Gf=32,a=T,s=1,v=1,c=2,r=1;${base64([255, 0, 0, 255])}\x1b\\`);
    expect(pixels(result.parts)).toHaveLength(1);
    expect(pixels(result.parts)[0]).toMatchObject({ width: 1, height: 1, channels: 4, cols: 2, rows: 1 });
    expect(Array.from(pixels(result.parts)[0].bytes)).toEqual([255, 0, 0, 255]);
  });

  test("renders raw RGB", () => {
    const stream = new KittyStream();
    const result = stream.push(`\x1b_Gf=24,a=T,s=1,v=1;${base64([1, 2, 3])}\x1b\\`);
    expect(pixels(result.parts)[0]).toMatchObject({ channels: 3, width: 1, height: 1 });
  });

  test("rejects raw data of the wrong size", () => {
    const stream = new KittyStream();
    const result = stream.push(`\x1b_Gf=32,a=T,s=2,v=2;${base64([255, 0, 0, 255])}\x1b\\`);
    expect(pixels(result.parts)).toHaveLength(0);
  });

  test("unwraps tmux passthrough", () => {
    const stream = new KittyStream();
    const result = stream.push(wrap(`\x1b_Gf=100,a=T;${PNG}\x1b\\`));
    expect(images(result.parts)).toHaveLength(1);
  });

  test("joins chunks that tmux wraps one by one", () => {
    const stream = new KittyStream();
    const first = wrap(`\x1b_Gf=100,a=T,m=1;${PNG.slice(0, 20)}\x1b\\`);
    const second = wrap(`\x1b_Gm=0;${PNG.slice(20)}\x1b\\`);
    const result = stream.push(first + second);
    expect(images(result.parts)).toHaveLength(1);
    expect(images(result.parts)[0].src).toBe(`data:image/png;base64,${PNG}`);
  });

  test("keeps text around a tmux passthrough image", () => {
    const stream = new KittyStream();
    const result = stream.push(`before${wrap(`\x1b_Gf=100;${PNG}\x1b\\`)}after`);
    expect(text(result.parts)).toBe("beforeafter");
    expect(images(result.parts)).toHaveLength(1);
  });

  test("ignores other DCS sequences", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\x1bP1$r\x1b\\b`);
    expect(text(result.parts)).toBe("ab");
  });

  test("transmits an image and places it later", () => {
    const stream = new KittyStream();
    expect(stream.push(`\x1b_Ga=t,i=7,f=100;${PNG}\x1b\\`).parts).toHaveLength(0);
    const placement = stream.push("\x1b_Ga=p,i=7,c=2,r=3\x1b\\");
    expect(images(placement.parts)).toHaveLength(1);
    expect(images(placement.parts)[0]).toMatchObject({ cols: 2, rows: 3, id: 7 });
  });

  test("deletes one image or all of them", () => {
    const stream = new KittyStream();
    expect(stream.push("\x1b_Ga=d,d=A\x1b\\").parts).toEqual([{ kind: "delete" }]);
    expect(stream.push("\x1b_Ga=d,d=i,i=3\x1b\\").parts).toEqual([{ kind: "delete", id: 3 }]);
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

  test("strips unicode image placeholders", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\n\u{10eeee}\u0305\u0305\nb`);
    expect(text(result.parts)).toBe("a\n\nb");
  });

  test("strips a placeholder split across chunks", () => {
    const stream = new KittyStream();
    expect(text(stream.push("a\n\u{10eeee}").parts)).toBe("a\n");
    expect(text(stream.push("\u0305\u0305\nb").parts)).toBe("\nb");
  });

  test("never emits an APC sequence as text", () => {
    const stream = new KittyStream();
    const result = stream.push(`a\x1b_Gi=31;AAAA\x1b\\b`);
    expect(text(result.parts)).toBe("ab");
    expect(images(result.parts)).toHaveLength(0);
  });
});
