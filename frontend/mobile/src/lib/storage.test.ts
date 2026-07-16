import { describe, expect, it } from "vitest";
import { syncCursorKey } from "./storage";

describe("syncCursorKey", () => {
  it("isolates cursors by server and user", () => {
    expect(syncCursorKey("https://one.example|user-a"))
      .not.toBe(syncCursorKey("https://one.example|user-b"));
    expect(syncCursorKey("https://one.example|user-a"))
      .not.toBe(syncCursorKey("https://two.example|user-a"));
  });

  it("is stable for equivalent casing", () => {
    expect(syncCursorKey("HTTPS://ONE.EXAMPLE|USER-A"))
      .toBe(syncCursorKey("https://one.example|user-a"));
  });
});
