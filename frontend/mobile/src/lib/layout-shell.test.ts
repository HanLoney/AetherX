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
    expect(chatSource).toContain("headerless");
    expect(chatSource).toContain('class="chat-floating-controls"');
    expect(chatSource).toContain("backdrop-filter:blur(26px) saturate(165%)");
    expect(chatSource).toContain('class="dock-scrim"');
    expect(chatSource).toContain("isolation:isolate");
    expect(chatSource).toContain('ref="composerInput"');
    expect(chatSource).toContain('<Transition name="emoji-reveal">');
    expect(chatSource).toContain("transform-origin: top center");
    expect(chatSource).toContain('class="composer-stack"');
    expect(chatSource).toContain("translate3d(0,calc(-1 * var(--emoji-tray-height) - 8px),0)");
    expect(chatSource).toContain('v-show="emojiOpen"');
    expect(chatSource).toContain("prepareCompactEmojiPicker");
    expect(chatSource).toContain(".search-row,");
    expect(chatSource).toContain(".favorites {");
    expect(chatSource).toContain(".tabpanel {");
    expect(chatSource).toContain("order: 3;");
    expect(chatSource).not.toContain("transition:height");
    expect(chatSource).toContain("background: linear-gradient(145deg,#fcfbfd,#f3f6fb)");
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
