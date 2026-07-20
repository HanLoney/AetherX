import { describe, expect, it } from "vitest";
import { resolveJournalTurn } from "./journal-pagination";

describe("journal page direction", () => {
  it("moves forward and backward inside one journal", () => {
    const position = { journalIndex: 1, journalCount: 3, leafIndex: 1, leafCount: 4 };
    expect(resolveJournalTurn(position, 1)).toMatchObject({
      journalIndex: 1,
      leafIndex: 2,
      crossedJournal: false,
      moved: true
    });
    expect(resolveJournalTurn(position, -1)).toMatchObject({
      journalIndex: 1,
      leafIndex: 0,
      crossedJournal: false,
      moved: true
    });
  });

  it("opens the next journal at its first leaf", () => {
    expect(resolveJournalTurn(
      { journalIndex: 1, journalCount: 3, leafIndex: 3, leafCount: 4 },
      1
    )).toEqual({
      journalIndex: 2,
      leafIndex: 0,
      crossedJournal: true,
      moved: true
    });
  });

  it("opens the previous journal at its last leaf", () => {
    expect(resolveJournalTurn(
      { journalIndex: 1, journalCount: 3, leafIndex: 0, leafCount: 2 },
      -1
    )).toEqual({
      journalIndex: 0,
      leafIndex: "last",
      crossedJournal: true,
      moved: true
    });
  });

  it("does not move beyond the book boundaries", () => {
    expect(resolveJournalTurn(
      { journalIndex: 0, journalCount: 2, leafIndex: 0, leafCount: 2 },
      -1
    ).moved).toBe(false);
    expect(resolveJournalTurn(
      { journalIndex: 1, journalCount: 2, leafIndex: 1, leafCount: 2 },
      1
    ).moved).toBe(false);
  });
});
