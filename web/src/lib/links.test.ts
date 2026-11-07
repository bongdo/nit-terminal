import { describe, expect, test } from "vitest";

import { findPaths, peroHref, resolvePath } from "./links";

describe("findPaths", () => {
  test("absolute path with a line and column", () => {
    const [first] = findPaths("error at /home/u/main.go:12:3: boom");
    expect(first?.path).toBe("/home/u/main.go");
    expect(first?.line).toBe(12);
  });

  test("relative path with a trailing dot", () => {
    const [first] = findPaths("see src/lib/a.ts:5.");
    expect(first?.path).toBe("src/lib/a.ts");
    expect(first?.line).toBe(5);
  });

  test("bare file name", () => {
    const [first] = findPaths("open README.md now");
    expect(first?.path).toBe("README.md");
    expect(first?.line).toBeUndefined();
  });

  test("home path", () => {
    expect(findPaths("cat ~/notes.md")[0]?.path).toBe("~/notes.md");
  });

  test("dot path", () => {
    expect(findPaths("run ./bin/check")[0]?.path).toBe("./bin/check");
  });

  test("urls are not paths", () => {
    expect(findPaths("https://example.com/a/b")).toEqual([]);
  });

  test("plain words are not paths", () => {
    expect(findPaths("nothing to see here")).toEqual([]);
  });

  test("positions point at the token", () => {
    const text = "at (/tmp/x.go:9)";
    const [first] = findPaths(text);
    expect(first?.start).toBe(4);
    expect(first?.length).toBe("/tmp/x.go:9".length);
  });
});

describe("resolvePath", () => {
  test("absolute stays absolute", () => {
    expect(resolvePath("/a/b/../c", "/cwd", "/home/u")).toBe("/a/c");
  });

  test("relative resolves against cwd", () => {
    expect(resolvePath("src/a.ts", "/work/dir", "/home/u")).toBe("/work/dir/src/a.ts");
  });

  test("relative falls back to home", () => {
    expect(resolvePath("a.ts", "", "/home/u")).toBe("/home/u/a.ts");
  });

  test("home expands", () => {
    expect(resolvePath("~/x", "/work", "/home/u")).toBe("/home/u/x");
  });
});

describe("peroHref", () => {
  test("matches the nit ?open= contract", () => {
    expect(peroHref("/pero/", "/tmp/a.go", 12)).toBe("/pero/?open=%2Ftmp%2Fa.go&line=12");
    expect(peroHref("/pero", "/tmp/a.go")).toBe("/pero/?open=%2Ftmp%2Fa.go");
  });
});
