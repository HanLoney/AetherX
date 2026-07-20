export interface JournalPagePosition {
  journalIndex: number;
  journalCount: number;
  leafIndex: number;
  leafCount: number;
}

export interface JournalTurnTarget {
  journalIndex: number;
  leafIndex: number | "last";
  crossedJournal: boolean;
  moved: boolean;
}

export function resolveJournalTurn(
  position: JournalPagePosition,
  direction: 1 | -1
): JournalTurnTarget {
  if (direction > 0) {
    if (position.leafIndex < position.leafCount - 1) {
      return {
        journalIndex: position.journalIndex,
        leafIndex: position.leafIndex + 1,
        crossedJournal: false,
        moved: true
      };
    }
    if (position.journalIndex < position.journalCount - 1) {
      return {
        journalIndex: position.journalIndex + 1,
        leafIndex: 0,
        crossedJournal: true,
        moved: true
      };
    }
  } else {
    if (position.leafIndex > 0) {
      return {
        journalIndex: position.journalIndex,
        leafIndex: position.leafIndex - 1,
        crossedJournal: false,
        moved: true
      };
    }
    if (position.journalIndex > 0) {
      return {
        journalIndex: position.journalIndex - 1,
        leafIndex: "last",
        crossedJournal: true,
        moved: true
      };
    }
  }

  return {
    journalIndex: position.journalIndex,
    leafIndex: position.leafIndex,
    crossedJournal: false,
    moved: false
  };
}
