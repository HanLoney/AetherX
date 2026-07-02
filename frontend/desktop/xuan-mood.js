(function exposeXuanMood(global) {
  class XuanMoodModule {
    constructor(options) {
      this.isEnabled = options.isEnabled;
      this.getHome = options.getHome;
      this.recordEvent = options.recordEvent;
      this.refreshMood = options.refreshMood;
      this.onChange = options.onChange || (() => {});
      this.running = false;
    }

    async syncHome({ force = false } = {}) {
      if (!this.isEnabled()) {
        this.onChange({ enabled: false, display: null });
        return null;
      }
      if (this.running && !force) return null;
      this.running = true;
      try {
        const snapshot = await this.getHome();
        this.onChange({ enabled: true, ...snapshot });
        return snapshot;
      } catch (error) {
        this.onChange({ enabled: true, error });
        return null;
      } finally {
        this.running = false;
      }
    }

    async refresh() {
      if (!this.isEnabled()) return null;
      try {
        const snapshot = await this.refreshMood();
        this.onChange({ enabled: true, ...snapshot });
        return snapshot;
      } catch (error) {
        this.onChange({ enabled: true, error });
        return null;
      }
    }

    async record(source) {
      if (!this.isEnabled()) return null;
      try {
        const snapshot = await this.recordEvent({
          ...source,
          sourceCreatedAt: source.sourceCreatedAt || Date.now()
        });
        this.onChange({ enabled: true, ...snapshot });
        return snapshot;
      } catch (error) {
        console.warn("Unable to update Xuan mood:", error.message);
        return null;
      }
    }
  }

  global.XuanMoodModule = XuanMoodModule;
})(window);
