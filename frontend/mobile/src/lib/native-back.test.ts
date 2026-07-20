import { describe, expect, it } from "vitest";
import { resolveNativeBackAction } from "./native-back";

describe("native back navigation", () => {
  it("returns to the previous page from chat when WebView history exists", () => {
    expect(resolveNativeBackAction("/chat", true)).toBe("back");
  });

  it("falls back to home when a secondary page has no WebView history", () => {
    expect(resolveNativeBackAction("/chat", false)).toBe("home");
    expect(resolveNativeBackAction("/settings", false)).toBe("home");
  });

  it("only exits from root screens", () => {
    expect(resolveNativeBackAction("/home", true)).toBe("exit");
    expect(resolveNativeBackAction("/login", false)).toBe("exit");
  });
});
