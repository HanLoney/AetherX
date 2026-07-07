(function exposeMarkdownRenderer(global) {
  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map((cell) => cell.trim());
  }

  function tableAlignment(cell) {
    const value = cell.trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    return "left";
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return (
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
    );
  }

  function startsBlock(lines, index) {
    const line = lines[index] || "";
    const next = lines[index + 1] || "";
    return (
      !line.trim() ||
      /^#{1,6}\s+/.test(line) ||
      /^\s*```/.test(line) ||
      /^\s{0,3}(?:([-*_])\s*){3,}$/.test(line) ||
      /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line) ||
      /^>\s?/.test(line) ||
      (line.includes("|") && isTableSeparator(next))
    );
  }

  function parseMarkdown(source) {
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s*```([\w-]*)\s*$/);
      if (fence) {
        const content = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          content.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({
          type: "code",
          language: fence[1] || "",
          content: content.join("\n")
        });
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        blocks.push({
          type: "heading",
          level: heading[1].length,
          content: heading[2].replace(/\s+#+\s*$/, "")
        });
        index += 1;
        continue;
      }

      if (/^\s{0,3}(?:([-*_])\s*){3,}$/.test(line)) {
        blocks.push({ type: "divider" });
        index += 1;
        continue;
      }

      if (line.includes("|") && isTableSeparator(lines[index + 1] || "")) {
        const headers = splitTableRow(line);
        const alignments = splitTableRow(lines[index + 1]).map(tableAlignment);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          rows.push(splitTableRow(lines[index]));
          index += 1;
        }
        blocks.push({ type: "table", headers, alignments, rows });
        continue;
      }

      const listMatch = line.match(/^([-*+]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = /^\d/.test(listMatch[1]);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^([-*+]|\d+[.)])\s+(.+)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          items.push(item[2]);
          index += 1;
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }

      if (/^>\s?/.test(line)) {
        const content = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          content.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push({ type: "quote", content: content.join("\n") });
        continue;
      }

      const content = [line];
      index += 1;
      while (index < lines.length && !startsBlock(lines, index)) {
        content.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "paragraph", content: content.join("\n") });
    }
    return blocks;
  }

  function appendInline(parent, source, depth = 0) {
    const text = String(source || "");
    if (!text || depth > 8) {
      parent.append(document.createTextNode(text));
      return;
    }

    const patterns = [
      { type: "code", regex: /`([^`\n]+)`/ },
      {
        type: "image",
        regex: /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^)\s]+)\)/
      },
      { type: "strong", regex: /\*\*(.+?)\*\*/ },
      { type: "strong", regex: /__(.+?)__/ },
      { type: "strike", regex: /~~(.+?)~~/ },
      { type: "link", regex: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/ },
      { type: "emphasis", regex: /(?<!\*)\*([^*\n]+)\*(?!\*)/ }
    ];
    let selected = null;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(text);
      if (
        match &&
        (!selected ||
          match.index < selected.match.index ||
          (match.index === selected.match.index &&
            match[0].length > selected.match[0].length))
      ) {
        selected = { ...pattern, match };
      }
    }

    if (!selected) {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index) parent.append(document.createElement("br"));
        parent.append(document.createTextNode(part));
      });
      return;
    }

    const { match, type } = selected;
    appendInline(parent, text.slice(0, match.index), depth + 1);
    if (type === "code") {
      const code = document.createElement("code");
      code.textContent = match[1];
      parent.append(code);
    } else if (type === "image") {
      const image = document.createElement("img");
      image.className = "markdown-image";
      image.src = match[2];
      image.alt = match[1] || "";
      image.loading = "lazy";
      parent.append(image);
    } else {
      const tag =
        type === "strong"
          ? "strong"
          : type === "emphasis"
            ? "em"
            : type === "strike"
              ? "s"
              : "span";
      const element = document.createElement(tag);
      if (type === "link") {
        element.className = "markdown-link";
        element.title = `链接：${match[2]}`;
      }
      appendInline(element, match[1], depth + 1);
      parent.append(element);
    }
    appendInline(parent, text.slice(match.index + match[0].length), depth + 1);
  }

  function renderMarkdown(container, source) {
    container.replaceChildren();
    container.classList.add("markdown-body");
    const blocks = parseMarkdown(source);

    blocks.forEach((block) => {
      if (block.type === "divider") {
        container.append(document.createElement("hr"));
        return;
      }
      if (block.type === "code") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = block.content;
        if (block.language) code.dataset.language = block.language;
        pre.append(code);
        container.append(pre);
        return;
      }
      if (block.type === "table") {
        const wrapper = document.createElement("div");
        wrapper.className = "markdown-table-wrap";
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        block.headers.forEach((cell, index) => {
          const element = document.createElement("th");
          element.style.textAlign = block.alignments[index] || "left";
          appendInline(element, cell);
          headRow.append(element);
        });
        head.append(headRow);
        const body = document.createElement("tbody");
        block.rows.forEach((row) => {
          const tableRow = document.createElement("tr");
          block.headers.forEach((_, index) => {
            const element = document.createElement("td");
            element.style.textAlign = block.alignments[index] || "left";
            appendInline(element, row[index] || "");
            tableRow.append(element);
          });
          body.append(tableRow);
        });
        table.append(head, body);
        wrapper.append(table);
        container.append(wrapper);
        return;
      }
      if (block.type === "list") {
        const list = document.createElement(block.ordered ? "ol" : "ul");
        block.items.forEach((item) => {
          const element = document.createElement("li");
          appendInline(element, item);
          list.append(element);
        });
        container.append(list);
        return;
      }
      const element = document.createElement(
        block.type === "heading"
          ? `h${block.level}`
          : block.type === "quote"
            ? "blockquote"
            : "p"
      );
      appendInline(element, block.content);
      container.append(element);
    });
  }

  global.XuanMarkdown = Object.freeze({
    parse: parseMarkdown,
    render: renderMarkdown
  });
})(typeof window === "undefined" ? globalThis : window);
