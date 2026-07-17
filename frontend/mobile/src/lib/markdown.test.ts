import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders common Markdown structures", () => {
    const html = renderMarkdown("## 小标题\n\n**重点**\n\n| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<h2>小标题</h2>");
    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<table>");
  });

  it("does not execute raw HTML or unsafe links", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> [危险](javascript:alert(1))');
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;img");
  });
});
