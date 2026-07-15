(function exposeAlbumPager(global) {
  class AetherAlbumPager {
    constructor(items = []) {
      this.items = Array.isArray(items) ? items : [];
      this.index = 0;
    }

    setItems(items, options = {}) {
      const previousId = options.preserveCurrent
        ? this.snapshot().item?.id
        : null;
      this.items = Array.isArray(items) ? items : [];

      if (previousId) {
        const nextIndex = this.items.findIndex((item) => item.id === previousId);
        this.index = nextIndex >= 0 ? nextIndex : 0;
      } else {
        this.index = 0;
      }
      return this.snapshot();
    }

    move(offset) {
      const lastIndex = Math.max(0, this.items.length - 1);
      this.index = Math.max(
        0,
        Math.min(this.index + Number(offset || 0), lastIndex)
      );
      return this.snapshot();
    }

    snapshot() {
      const total = this.items.length;
      const index = total ? Math.min(this.index, total - 1) : 0;
      this.index = index;
      return {
        item: this.items[index] || null,
        index,
        total,
        hasPrevious: index > 0,
        hasNext: index < total - 1
      };
    }
  }

  global.AetherAlbumPager = AetherAlbumPager;
  if (typeof module !== "undefined") {
    module.exports = { AetherAlbumPager };
  }
})(typeof window === "undefined" ? globalThis : window);
