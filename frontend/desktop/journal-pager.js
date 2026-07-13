(function exposeJournalPager(global) {
  class AetherJournalPager {
    constructor(items = []) {
      this.items = Array.isArray(items) ? items : [];
      this.filter = "all";
      this.index = 0;
    }

    setItems(items) {
      this.items = Array.isArray(items) ? items : [];
      this.index = Math.min(this.index, Math.max(0, this.filtered().length - 1));
      return this.snapshot();
    }

    setFilter(filter) {
      this.filter = ["all", "daily", "weekly"].includes(filter)
        ? filter
        : "all";
      this.index = 0;
      return this.snapshot();
    }

    filtered() {
      return this.items.filter(
        (item) => this.filter === "all" || item.type === this.filter
      );
    }

    move(offset) {
      const total = this.filtered().length;
      this.index = Math.max(0, Math.min(this.index + Number(offset || 0), total - 1));
      return this.snapshot();
    }

    snapshot() {
      const items = this.filtered();
      const total = items.length;
      const index = total ? Math.min(this.index, total - 1) : 0;
      this.index = index;
      return {
        item: items[index] || null,
        index,
        total,
        hasPrevious: index > 0,
        hasNext: index < total - 1
      };
    }
  }

  global.AetherJournalPager = AetherJournalPager;
  if (typeof module !== "undefined") {
    module.exports = { AetherJournalPager };
  }
})(typeof window === "undefined" ? globalThis : window);
