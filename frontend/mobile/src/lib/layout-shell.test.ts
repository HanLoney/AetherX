import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("../components/AppShell.vue", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../views/ChatView.vue", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../views/HomeView.vue", import.meta.url), "utf8");
const journalsSource = readFileSync(new URL("../views/JournalsView.vue", import.meta.url), "utf8");
const gallerySource = readFileSync(new URL("../views/GalleryView.vue", import.meta.url), "utf8");
const memoriesSource = readFileSync(new URL("../views/MemoriesView.vue", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../views/SettingsView.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router.ts", import.meta.url), "utf8");
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
    expect(shellSource).toContain('{ to: "/settings", label: "我的"');
  });

  it("merges the personal profile with mobile settings", () => {
    expect(settingsSource).toContain('class="profile-hero"');
    expect(settingsSource).not.toContain('class="space-overview"');
    expect(settingsSource).toContain("border-radius:26px");
    expect(settingsSource).toContain("编辑个人资料");
    expect(settingsSource).toContain("data.updateProfile");
    expect(settingsSource).toContain('ref="avatarInput"');
    expect(settingsSource).toContain('class="avatar-cropper"');
    expect(settingsSource).toContain('@pointermove="moveCrop"');
    expect(settingsSource).toContain('type="range"');
    expect(settingsSource).toContain("avatarDataUrl");
    expect(settingsSource).toContain('class="settings-list"');
    expect(settingsSource).toContain("退出这个账号");
  });

  it("moves chat into focus layout without stacking it above the main navigation", () => {
    expect(chatSource).toContain('layout="focus"');
    expect(chatSource).toContain('back-to="/home"');
    expect(chatSource).toContain("headerless");
    expect(chatSource).toContain('class="chat-floating-controls"');
    expect(chatSource).toContain("backdrop-filter:blur(26px) saturate(165%)");
    expect(chatSource).toContain("border-radius:22px 22px 22px 7px");
    expect(chatSource).toContain("border-radius:22px 22px 7px 22px");
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
    expect(homeSource).toContain(".avatar-orbit :deep(.avatar-large)");
    expect(homeSource).toContain("border-radius: 26px");
    expect(homeSource).toContain("data.updateAssistantProfile({ avatarDataUrl })");
    expect(homeSource).toContain("<AvatarCropper");
    expect(homeSource).toContain("assistantCropper?.choose()");
    expect(homeSource).not.toContain(".avatar-orbit > i");
    expect(homeSource).not.toContain(".avatar-orbit::before");
    expect(homeSource).toContain("router.push('/chat')");
    expect(homeSource).toContain("开始聊天");
    expect(homeSource).toContain("headerless");
    expect(homeSource).not.toContain('class="space-index"');
    expect(homeSource).toContain('class="journal-sheet"');
    expect(homeSource).toContain('class="gallery-stack"');
    expect(homeSource).toContain('class="gallery-photos"');
    expect(homeSource).toContain("router.push('/journals')");
    expect(homeSource).toContain("router.push('/gallery')");
    expect(homeSource).toContain("router.push('/memories')");
    expect(homeSource).toContain('class="home-portals"');
    expect(homeSource).not.toContain("最近收集");
    expect(homeSource).not.toContain('class="memory-window"');
    expect(homeSource).toContain("--home-module-gap: 16px");
    expect(homeSource).not.toContain("YOUR DIGITAL COMPANION");
  });

  it("opens the complete companion gallery from home", () => {
    expect(routerSource).toContain('path: "/gallery"');
    expect(gallerySource).toContain("galleryPage(images.value.length, 24)");
    expect(gallerySource).toContain("while (hasMore.value)");
    expect(gallerySource).toContain('class="gallery-grid"');
    expect(gallerySource).toContain('class="album-shell"');
    expect(gallerySource).toContain('class="gallery-month"');
    expect(gallerySource).toContain('class="gallery-tabs"');
    expect(gallerySource).toContain("const pageSize = 4");
    expect(gallerySource).toContain("pageIndex.value * pageSize");
    expect(gallerySource).toContain('@touchstart.passive="handleTouchStart"');
    expect(gallerySource).toContain('@touchend.passive="handleTouchEnd"');
    expect(gallerySource).toContain("bottom:18px");
    expect(gallerySource).toContain('<AppShell title="" headerless>');
    expect(gallerySource).toContain("height:550px");
    expect(gallerySource).not.toContain("@media (min-width:560px)");
    expect(gallerySource).toContain('class="gallery-lightbox"');
  });

  it("opens all journals as a page-turning notebook", () => {
    expect(routerSource).toContain('path: "/journals"');
    expect(journalsSource).toContain('class="journal-page"');
    expect(journalsSource).toContain('class="page-flow"');
    expect(journalsSource).toContain('class="journal-filters"');
    expect(journalsSource).toContain("@touchend.passive=\"handleTouchEnd\"");
    expect(journalsSource).toContain('v-html="renderedJournal"');
    expect(journalsSource).toContain("column-fill: auto");
    expect(journalsSource).toContain("leafIndex.value < leafCount.value - 1");
    expect(journalsSource).toContain('"leaving-forward"');
    expect(journalsSource).toContain('"entering-forward"');
    expect(journalsSource).toContain('"leaving-backward"');
    expect(journalsSource).toContain('"entering-backward"');
    expect(journalsSource).toContain("journalTurnInProgress.value");
    expect(journalsSource).not.toContain("overflow-y: auto");
    expect(journalsSource).toContain("左右滑动翻页");
  });

  it("presents memories as a searchable mobile review flow", () => {
    expect(memoriesSource).toContain('<AppShell title="" headerless>');
    expect(memoriesSource).toContain('class="memory-overview"');
    expect(memoriesSource).toContain('class="memory-search"');
    expect(memoriesSource).toContain('class="memory-tabs"');
    expect(memoriesSource).toContain('class="memory-stream"');
    expect(memoriesSource).toContain("确认珍藏");
    expect(memoriesSource).toContain("当时的原话");
    expect(memoriesSource).toContain("记忆可靠度");
    expect(memoriesSource).toContain("data.confirmMemory(memory.id)");
    expect(memoriesSource).toContain("data.removeMemory(memory.id)");
  });
});
