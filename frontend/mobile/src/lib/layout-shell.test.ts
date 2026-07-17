import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("../components/AppShell.vue", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../views/ChatView.vue", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../views/HomeView.vue", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

describe("adaptive mobile shell", () => {
  it("keeps chat as a secondary page outside the primary navigation", () => {
    expect(shellSource).toContain('layout?: "browse" | "focus"');
    expect(shellSource).toContain("v-if=\"props.layout === 'browse'\"");
    expect(shellSource).toContain("v-if=\"$slots['bottom-dock']\"");
    expect(shellSource).not.toContain('{ to: "/chat"');
    expect(shellSource).toContain('aria-label="返回主页"');
    expect(shellSource).toContain(':to="props.backTo"');
  });

  it("uses a compact dock and hides browse navigation during input", () => {
    expect(tokens).toContain("--nav-height: 58px");
    expect(baseStyles).toContain(".nav-hidden .floating-nav");
    expect(baseStyles).toContain(".keyboard-open .floating-nav");
    expect(baseStyles).toContain(".layout-focus.keyboard-open .page-header");
  });

  it("moves chat into focus layout without stacking it above the main navigation", () => {
    expect(chatSource).toContain('layout="focus"');
    expect(chatSource).toContain('back-to="/home"');
    expect(chatSource).toContain("<template #bottom-dock>");
    expect(chatSource).not.toMatch(/bottom:\s*calc\(var\(--nav-height\)/);
    expect(chatSource).not.toMatch(/position:\s*fixed[^}]*chat-composer/);
  });

  it("uses the home hero as the single entry into chat", () => {
    expect(homeSource).toContain('class="chat-entry"');
    expect(homeSource).toContain("router.push('/chat')");
    expect(homeSource).toContain("继续你们的对话");
  });
});
