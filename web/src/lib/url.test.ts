import { describe, expect, test } from "vitest";

import { apiBase, parseTarget, queryFor } from "./url";

describe("parseTarget", () => {
  test("absolute dir", () => {
    expect(parseTarget("?dir=%2Fhome%2Fu%2Fp")).toEqual({ kind: "dir", dir: "/home/u/p" });
  });

  test("dir wins over session", () => {
    expect(parseTarget("?dir=%2Ftmp&session=demo")).toEqual({ kind: "dir", dir: "/tmp" });
  });

  test("session", () => {
    expect(parseTarget("?session=tg-abc")).toEqual({ kind: "session", session: "tg-abc" });
  });

  test("no query is home", () => {
    expect(parseTarget("")).toEqual({ kind: "home" });
    expect(parseTarget("?foo=1")).toEqual({ kind: "home" });
  });

  test("relative dir is passed to the server unchanged", () => {
    expect(parseTarget("?dir=..%2Fetc")).toEqual({ kind: "dir", dir: "../etc" });
  });
});

describe("queryFor", () => {
  test("round trips a dir", () => {
    const target = parseTarget("?dir=%2Ftmp");
    expect(queryFor(target)).toBe("?dir=%2Ftmp");
  });

  test("home has no query", () => {
    expect(queryFor({ kind: "home" })).toBe("");
  });
});

describe("apiBase", () => {
  test("keeps the base path", () => {
    expect(apiBase("/term/")).toBe("/term");
    expect(apiBase("/term")).toBe("/term");
    expect(apiBase("/term/index.html")).toBe("/term");
  });

  test("root stays empty", () => {
    expect(apiBase("/")).toBe("");
  });

  test("nested base", () => {
    expect(apiBase("/a/b/c/")).toBe("/a/b/c");
  });
});
