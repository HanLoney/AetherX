import { describe, expect, it } from "vitest";
import { normalizeFontScale } from "./interface-settings";

describe("normalizeFontScale", () => {
  it("uses five-percent steps inside the supported range", () => {
    expect(normalizeFontScale(113)).toBe(115);
    expect(normalizeFontScale(82)).toBe(85);
    expect(normalizeFontScale(131)).toBe(125);
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeFontScale("not-a-number")).toBe(100);
    expect(normalizeFontScale(null)).toBe(100);
    expect(normalizeFontScale("")).toBe(100);
  });
});
