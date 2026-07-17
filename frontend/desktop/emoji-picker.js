(function attachEmojiPicker(globalScope) {
  const EMOJI_GROUPS = Object.freeze([
    {
      id: "faces",
      label: "表情",
      icon: "😊",
      emojis: ["😂", "😊", "🥰", "😍", "😘", "😭", "🥺", "😎", "🤔", "🙃", "😴", "😤", "🤗", "🫡", "🤭", "🫠"]
    },
    {
      id: "gestures",
      label: "手势",
      icon: "👋",
      emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "👌", "✌️", "🤞", "🫶", "🫰", "👋", "🤟", "👉", "👈"]
    },
    {
      id: "hearts",
      label: "心意",
      icon: "💗",
      emojis: ["❤️", "🩷", "🧡", "💛", "💚", "🩵", "💙", "💜", "🤍", "🖤", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"]
    },
    {
      id: "cute",
      label: "可爱",
      icon: "🐱",
      emojis: ["🐱", "🐶", "🐰", "🐻", "🐼", "🦊", "🐹", "🐣", "🦄", "🐾", "🌸", "🌈", "⭐", "✨", "🌙", "☀️", "☁️", "🍀"]
    },
    {
      id: "food",
      label: "食物",
      icon: "🍓",
      emojis: ["🍓", "🍒", "🍎", "🍑", "🍉", "🍰", "🍪", "🍫", "🍬", "🍭", "☕", "🧋", "🍜", "🍙", "🍕", "🍔"]
    },
    {
      id: "activities",
      label: "活动",
      icon: "🎉",
      emojis: ["🎉", "🎊", "🎁", "🎈", "🎵", "🎶", "🎮", "🎨", "📚", "💡", "🔥", "💯", "✅", "❌", "⚡", "💤"]
    }
  ]);

  function clampSelection(value, position, fallback) {
    const parsed = Number(position);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.max(0, Math.min(parsed, value.length));
  }

  function insertEmojiAtSelection(value, emoji, selectionStart, selectionEnd) {
    const source = String(value ?? "");
    const symbol = String(emoji ?? "");
    const start = clampSelection(source, selectionStart, source.length);
    const end = Math.max(start, clampSelection(source, selectionEnd, start));
    const caret = start + symbol.length;
    return {
      value: `${source.slice(0, start)}${symbol}${source.slice(end)}`,
      selectionStart: caret,
      selectionEnd: caret
    };
  }

  class AetherEmojiPicker {
    constructor({ root, trigger, input, groups = EMOJI_GROUPS } = {}) {
      if (!root || !trigger || !input) {
        throw new TypeError("Emoji picker requires root, trigger and input elements.");
      }
      this.root = root;
      this.trigger = trigger;
      this.input = input;
      this.groups = groups;
      this.activeGroupId = groups[0]?.id || "";
      this.bound = false;
      this.handleTriggerClick = () => this.toggle();
      this.handleRootClick = (event) => this.onRootClick(event);
      this.handleOutsidePointer = (event) => this.onOutsidePointer(event);
      this.handleDocumentKeydown = (event) => {
        if (event.key === "Escape") this.close();
      };
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.render();
      this.trigger.addEventListener("click", this.handleTriggerClick);
      this.root.addEventListener("click", this.handleRootClick);
      document.addEventListener("pointerdown", this.handleOutsidePointer, true);
      document.addEventListener("keydown", this.handleDocumentKeydown);
    }

    destroy() {
      if (!this.bound) return;
      this.bound = false;
      this.trigger.removeEventListener("click", this.handleTriggerClick);
      this.root.removeEventListener("click", this.handleRootClick);
      document.removeEventListener("pointerdown", this.handleOutsidePointer, true);
      document.removeEventListener("keydown", this.handleDocumentKeydown);
    }

    isOpen() {
      return !this.root.hidden;
    }

    open() {
      this.root.hidden = false;
      this.trigger.classList.add("active");
      this.trigger.setAttribute("aria-expanded", "true");
    }

    close() {
      this.root.hidden = true;
      this.trigger.classList.remove("active");
      this.trigger.setAttribute("aria-expanded", "false");
    }

    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    }

    onOutsidePointer(event) {
      if (!this.isOpen()) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (
        path.includes(this.root) ||
        path.includes(this.trigger) ||
        this.root.contains(event.target) ||
        this.trigger.contains(event.target)
      ) {
        return;
      }
      this.close();
    }

    onRootClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const groupButton = target.closest("[data-emoji-group]");
      if (groupButton && this.root.contains(groupButton)) {
        this.activeGroupId = groupButton.dataset.emojiGroup;
        this.render();
        return;
      }
      const emojiButton = target.closest("[data-emoji]");
      if (!emojiButton || !this.root.contains(emojiButton)) return;
      this.insert(emojiButton.dataset.emoji);
    }

    insert(emoji) {
      const result = insertEmojiAtSelection(
        this.input.value,
        emoji,
        this.input.selectionStart,
        this.input.selectionEnd
      );
      this.input.value = result.value;
      this.input.setSelectionRange(result.selectionStart, result.selectionEnd);
      this.input.dispatchEvent(new Event("input", { bubbles: true }));
      this.input.focus();
    }

    render() {
      const activeGroup =
        this.groups.find((group) => group.id === this.activeGroupId) || this.groups[0];
      this.root.replaceChildren();

      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "选择表情";
      const hint = document.createElement("span");
      hint.textContent = activeGroup?.label || "";
      header.append(title, hint);

      const tabs = document.createElement("nav");
      tabs.className = "emoji-picker-tabs";
      tabs.setAttribute("aria-label", "表情分类");
      for (const group of this.groups) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.emojiGroup = group.id;
        button.className = group.id === activeGroup?.id ? "active" : "";
        button.setAttribute("aria-label", group.label);
        button.title = group.label;
        button.textContent = group.icon;
        tabs.append(button);
      }

      const grid = document.createElement("div");
      grid.className = "emoji-picker-grid";
      grid.setAttribute("role", "list");
      for (const emoji of activeGroup?.emojis || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.emoji = emoji;
        button.setAttribute("aria-label", `插入 ${emoji}`);
        button.setAttribute("role", "listitem");
        button.textContent = emoji;
        grid.append(button);
      }

      this.root.append(header, tabs, grid);
    }
  }

  globalScope.AetherEmojiPicker = AetherEmojiPicker;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { AetherEmojiPicker, EMOJI_GROUPS, insertEmojiAtSelection };
  }
})(typeof window !== "undefined" ? window : globalThis);
