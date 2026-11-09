import { describe, expect, it } from "vitest";

import { osc52Text } from "./osc52";

describe("osc52Text", () => {
  it("decodes a selection field", () => {
    expect(osc52Text("c;aGk=")).toBe("hi");
  });

  it("decodes an empty selection field", () => {
    expect(osc52Text(";aGk=")).toBe("hi");
  });

  it("rejects clipboard read requests", () => {
    expect(osc52Text("c;?")).toBeNull();
  });

  it("rejects malformed base64", () => {
    expect(osc52Text("c;***")).toBeNull();
  });
});
