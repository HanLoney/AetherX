import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("../components/AppShell.vue", import.meta.url), "utf8");
const primaryNavSource = readFileSync(new URL("../components/PrimaryNav.vue", import.meta.url), "utf8");
const primaryDeckSource = readFileSync(new URL("../components/PrimaryPageDeck.vue", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.vue", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../views/ChatView.vue", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../views/HomeView.vue", import.meta.url), "utf8");
const journalsSource = readFileSync(new URL("../views/JournalsView.vue", import.meta.url), "utf8");
const gallerySource = readFileSync(new URL("../views/GalleryView.vue", import.meta.url), "utf8");
const memoriesSource = readFileSync(new URL("../views/MemoriesView.vue", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../views/SettingsView.vue", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("../stores/session.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../stores/data.ts", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../views/LoginView.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router.ts", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

describe("adaptive mobile shell", () => {
  it("keeps chat as a secondary page outside the primary navigation", () => {
    expect(shellSource).toContain('layout?: "browse" | "focus"');
    expect(shellSource).toContain("v-if=\"$slots['bottom-dock']\"");
    expect(primaryNavSource).not.toContain('{ to: "/chat"');
    expect(routerSource).not.toMatch(/path: "\/chat"[^\n]+primaryNav/);
    expect(shellSource).toContain('aria-label="返回主页"');
    expect(shellSource).toContain(':to="props.backTo"');
  });

  it("uses a compact dock and hides browse navigation during input", () => {
    expect(tokens).toContain("--nav-height: 58px");
    expect(baseStyles).toContain(".floating-nav.is-hidden");
    expect(baseStyles).toContain(".layout-focus.keyboard-open .page-header");
    expect(primaryNavSource).toContain('{ to: "/settings", label: "我的"');
    expect(shellSource).toContain("setNavHidden(true)");
  });

  it("keeps primary navigation mounted and animates directional page changes", () => {
    expect(appSource).toContain("<PrimaryNav />");
    expect(appSource).toContain('<Transition :name="transitionName">');
    expect(primaryNavSource).toContain('class="nav-active-pill"');
    expect(primaryNavSource).toContain("--nav-index");
    expect(routerSource).toContain('primaryNav: true, navIndex: 0');
    expect(routerSource).toContain('primaryNav: true, navIndex: 3');
    expect(routerSource).toContain('"primary-forward" : "primary-backward"');
    expect(baseStyles).toContain("cubic-bezier(.34,1.56,.64,1)");
    expect(baseStyles).toContain(".primary-forward-enter-from");
    expect(baseStyles).toContain(".primary-backward-enter-from");
  });

  it("switches primary pages with guarded horizontal swipe gestures", () => {
    expect(appSource).toContain('<PrimaryPageDeck v-if="isPrimaryRoute"');
    expect(primaryDeckSource).toContain('@touchstart.passive="handleTouchStart"');
    expect(primaryDeckSource).toContain('@touchmove="handleTouchMove"');
    expect(primaryDeckSource).toContain("event.preventDefault()");
    expect(primaryDeckSource).toContain("dragX.value = (atStart || atEnd) ? deltaX * .24 : deltaX");
    expect(primaryDeckSource).toContain("window.innerWidth * .2");
    expect(primaryDeckSource).toContain("Math.abs(velocityX) >= .52");
    expect(primaryDeckSource).toContain("void router.push(target)");
    expect(primaryDeckSource).toContain("[role='slider']");
    expect(primaryDeckSource).toContain(":inert=\"index !== currentIndex\"");
    expect(baseStyles).toContain("touch-action: pan-y");
    expect(baseStyles).toContain(".primary-page-deck.is-dragging .primary-page-track { transition: none; }");
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
    expect(settingsSource).toContain('class="interface-settings-entry"');
    expect(settingsSource).toContain('class="interface-settings-sheet"');
    expect(settingsSource).toContain("全局字体大小");
    expect(settingsSource).toContain('min="85"');
    expect(settingsSource).toContain('max="125"');
    expect(settingsSource).toContain("interfaceSettings.applyFontScale");
    expect(settingsSource).toContain('class="settings-list"');
    expect(settingsSource).toContain('class="hub-connection-row"');
    expect(settingsSource).toContain('<Teleport to="body">');
    expect(settingsSource).toContain("重新连接 Hub");
    expect(settingsSource).toContain("session.reconnect(connectionUrl.value)");
    expect(settingsSource).toContain("session.pair(pairingCode.value)");
    expect(settingsSource).toContain("CapacitorBarcodeScanner.scanBarcode");
    expect(settingsSource).toContain("data.reconnectHub()");
    expect(settingsSource).toContain("正在后台恢复同步");
    expect(settingsSource).toContain("等待电脑确认…");
    expect(settingsSource).not.toContain("await data.reconnectHub()");
    expect(sessionSource).toContain("withConnectionTimeout");
    expect(sessionSource).toContain("timeoutMs = 12_000");
    expect(dataSource).toContain("void refreshAll().catch");
    expect(dataSource).toContain("void startSync().catch");
    expect(settingsSource).toContain("退出这个账号");
  });

  it("accepts a remote HTTPS Hub QR code during mobile sign in", () => {
    expect(loginSource).toContain("CapacitorBarcodeScanner.scanBarcode");
    expect(loginSource).toContain("/^https?:\\/\\//i.test(code)");
    expect(loginSource).toContain('mode.value = "login"');
    expect(loginSource).toContain("await inspectServer()");
  });

  it("moves chat into focus layout without stacking it above the main navigation", () => {
    expect(chatSource).toContain('layout="focus"');
    expect(chatSource).toContain('back-to="/home"');
    expect(chatSource).toContain("headerless");
    expect(chatSource).toContain('class="chat-floating-controls"');
    expect(chatSource).toContain("data.refreshConversationPage(true)");
    expect(chatSource).toContain("data.loadRemainingConversations()");
    expect(chatSource).toContain("正在继续加载更早的对话");
    expect(chatSource).not.toContain("data.refreshAll().catch");
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
    expect(gallerySource).toContain("data.galleryAlbumImages.value");
    expect(gallerySource).toContain("await data.preloadGallery()");
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
    expect(gallerySource).toContain('@load="warmOriginal(item)"');
    expect(gallerySource).toContain("originalLoader.load(source, priority)");
    expect(gallerySource).toContain("warmOriginal(image, true)");
    expect(gallerySource).toContain(':src="lightboxSource(selected)"');
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
