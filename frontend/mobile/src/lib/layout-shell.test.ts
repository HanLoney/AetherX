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
const localHubSource = readFileSync(new URL("./local-hub.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../stores/data.ts", import.meta.url), "utf8");
const modulesSource = readFileSync(new URL("../stores/modules.ts", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../views/LoginView.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router.ts", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const dataBootstrapSource = readFileSync(new URL("./mobile-data-bootstrap.ts", import.meta.url), "utf8");
const connectionPillSource = readFileSync(new URL("../components/ConnectionPill.vue", import.meta.url), "utf8");

describe("adaptive mobile shell", () => {
  it("uses bundled official brand icons in the AI provider editor", () => {
    expect(settingsSource).toContain('provider-icons/openai.svg');
    expect(settingsSource).toContain('provider-icons/deepseek.svg');
    expect(settingsSource).toContain('provider-icons/qwen.svg');
    expect(settingsSource).toContain('provider-icons/zhipu.png');
    expect(settingsSource).toContain('provider-icons/siliconflow.ico');
    expect(settingsSource).toContain(':src="provider.icon"');
    expect(settingsSource).not.toContain('{{ provider.shortName }}');
  });

  it("recovers the mobile client route from authenticated native LAN discovery", () => {
    expect(localHubSource).toContain('"peerEndpointDiscovered"');
    expect(localHubSource).toContain('new CustomEvent("aetherx:peer-endpoint-discovered"');
    expect(sessionSource).toContain('window.addEventListener("aetherx:peer-endpoint-discovered"');
    expect(sessionSource).toContain("recoverDiscoveredHub(detail.nodeId, detail.address)");
    expect(sessionSource).toContain("validateHubConnection(candidate, user.value)");
  });

  it("waits for stored Hub recovery before exposing the authenticated shell", () => {
    expect(sessionSource).toContain("await validateStoredSession(api, stored");
    expect(sessionSource).not.toContain("void validateStoredSession(api, stored");
  });

  it("shows cached data immediately and still refreshes it from the active Hub", () => {
    expect(dataBootstrapSource).toContain("await session.bootstrap()");
    expect(dataBootstrapSource).toContain("if (!session.authenticated.value) return;");
    expect(dataBootstrapSource).toContain("const restored = await data.restoreCache()");
    expect(dataBootstrapSource).toContain("if (restored)");
    expect(dataBootstrapSource).toContain("void data.refreshAll().catch");
    expect(dataBootstrapSource).toContain("await data.refreshAll().catch");
  });

  it("does not reload chat for unrelated Local Hub background changes", () => {
    const localChangeHandler = dataSource.match(
      /window\.addEventListener\("aetherx:local-data-changed"[\s\S]*?\n\}\);/
    )?.[0];

    expect(localChangeHandler).toContain("refreshGroups(groups)");
    expect(localChangeHandler).not.toContain("refreshConversationPage");
  });

  it("keeps the desktop control channel from rerouting the active mobile client", () => {
    expect(sessionSource).toContain('connectStoredHub(route, user.value, "", false)');
    expect(sessionSource).toContain("routeChanges = true");
    expect(sessionSource).toContain("createApi(url, route.token, false, routeChanges)");
    expect(sessionSource).toContain("if (api instanceof LocalHubClient) return");
    expect(sessionSource).toContain("connection.status.activeNodeId !== nodeId");
  });

  it("separates the client channel from native dual Hub replication health", () => {
    expect(connectionPillSource).toContain('online: "已连接"');
    expect(connectionPillSource).toContain('recovering: "通道重连中"');
    expect(connectionPillSource).toContain('replication.synchronization.state === "synced"');
    expect(connectionPillSource).not.toContain('online: "已同步"');
    expect(settingsSource).toContain('return "通道重连中"');
    expect(settingsSource).not.toContain('return "连接异常"');
  });

  it("keeps chat as a secondary page outside the primary navigation", () => {
    expect(shellSource).toContain('layout?: "browse" | "focus"');
    expect(shellSource).toContain("v-if=\"$slots['bottom-dock']\"");
    expect(primaryNavSource).not.toContain('{ to: "/chat"');
    expect(routerSource).not.toMatch(/path: "\/chat"[^\n]+primaryNav/);
    expect(shellSource).toContain('aria-label="返回主页"');
    expect(shellSource).toContain(':to="props.backTo"');
  });

  it("hydrates module switches from Hub and removes disabled mobile capabilities", () => {
    expect(modulesSource).toContain("listModules()");
    expect(modulesSource).toContain("updateModule(id, enabled)");
    expect(routerSource).toContain('meta: { primaryNav: true, navIndex: 1, module: "todo" }');
    expect(primaryNavSource).toContain("modules.isEnabled(item.module)");
    expect(primaryDeckSource).toContain("modules.isEnabled(page.module)");
    expect(dataSource).toContain('moduleStore.isEnabled("todo") ? api.listTodos()');
    expect(dataSource).toContain('moduleStore.isEnabled("memory") ? api.listMemories()');
    expect(settingsSource).toContain('class="module-control-list"');
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
    expect(settingsSource).toContain('class="current-hub-card"');
    expect(settingsSource).toContain("当前连接");
    expect(settingsSource).toContain("连接管理");
    expect(settingsSource).toContain("currentHubTitle");
    expect(settingsSource).toContain('class="hub-replication-status"');
    expect(settingsSource).toContain('role="progressbar"');
    expect(settingsSource).toContain("desktopHubSyncLabel");
    expect(settingsSource).toContain("phoneHubSyncLabel");
    expect(settingsSource).toContain('<Teleport to="body">');
    expect(settingsSource).toContain("重新连接 Hub");
    expect(settingsSource).toContain("session.reconnect(connectionUrl.value)");
    expect(settingsSource).toContain("session.pair(pairingCode.value)");
    expect(settingsSource).toContain("CapacitorBarcodeScanner.scanBarcode");
    expect(settingsSource).toContain("data.reconnectHub()");
    expect(settingsSource).toContain('class="archive-settings-entry"');
    expect(settingsSource).toContain('class="archive-settings-sheet"');
    expect(settingsSource).toContain('class="ai-settings-entry"');
    expect(settingsSource).toContain('class="ai-settings-sheet"');
    expect(settingsSource).toContain("编辑 AI 接入");
    expect(settingsSource).toContain("saveAiProviderProfile");
    expect(settingsSource).toContain("testAiProviderProfile");
    expect(settingsSource).toContain("activateAiProvider");
    expect(settingsSource).toContain("当前使用：");
    expect(settingsSource).toContain("连接已验证");
    expect(settingsSource).toContain("只有输入新值时才会替换原密钥");
    expect(settingsSource).toContain('class="ai-model-picker-sheet"');
    expect(settingsSource).toContain('class="ai-model-search"');
    expect(settingsSource).toContain('class="ai-model-kind-tabs"');
    expect(settingsSource).toContain("modelKindLabel(model.kind)");
    expect(settingsSource).toContain("model.selectableForChat === false");
    expect(settingsSource).toContain("请选择文字或多模态模型");
    expect(settingsSource).toContain("filteredAiModels");
    expect(settingsSource).toContain("selectAiModel(model)");
    expect(settingsSource).not.toContain('<select v-if="aiModels.length"');
    expect(dataSource).toContain('new CustomEvent("aether:ai-config-updated"');
    expect(settingsSource).toContain('window.addEventListener("aether:ai-config-updated"');
    expect(settingsSource).toContain("await refreshAiState()");
    expect(settingsSource).toContain("已同步另一台设备保存的最新 AI 配置");
    expect(settingsSource).toContain("导入存档");
    expect(settingsSource).not.toContain("合并导入");
    expect(settingsSource).toContain("api.createArchiveExport");
    expect(settingsSource).toContain("restoreArchive(archiveFile.value");
    expect(dataSource).toContain('change.entityType === "archive_restore"');
    expect(dataSource).toContain("clearMobileDataCache(scope)");
    expect(dataSource).toContain("saveSyncCursor(scope, resetCursor)");
    expect(settingsSource).toContain("正在后台恢复同步");
    expect(settingsSource).toContain("等待电脑确认…");
    expect(settingsSource).toContain("void data.reconnectHub().catch");
    expect(settingsSource).toContain("synchronizeLocalHub");
    expect(settingsSource).toContain("await localHub.synchronize()");
    expect(settingsSource).toContain("同步到电脑 Hub");
    expect(settingsSource).toContain("同步到手机 Hub");
    expect(sessionSource).toContain("withConnectionTimeout");
    expect(sessionSource).toContain("recovered.status.localNodeId");
    expect(sessionSource).toContain("recovered: true");
    expect(sessionSource).toContain("createDesktopControlConnection");
    expect(sessionSource).toContain("const localStatus = await discoverPeerEndpoints(localHub, route.nodeId)");
    expect(sessionSource).toContain("shouldAvoidInsecureAndroidRoute");
    expect(sessionSource).toContain("if (shouldAvoidInsecureAndroidRoute(address)) return;");
    expect(sessionSource).toContain("normalizeRouteUrl(api.serverUrl) === normalizeRouteUrl(address)");
    expect(sessionSource).toContain("allowInsecureLan !== true");
    expect(dataSource).toContain("startControlSync(session, userId)");
    expect(dataSource).toContain("{ controlOnly: true }");
    expect(dataSource).toContain('commandType === "cluster-change"');
    expect(dataSource).toContain('state !== "stable"');
    expect(dataSource).toContain("await session.activateLocalHub()");
    expect(dataSource).toContain("await session.activateDesktopHub()");
    expect(sessionSource).toContain('local?.role !== "active" || local.state !== "stable"');
    expect(sessionSource).toContain('local?.role === "standby" && local.state === "stable"');
    expect(dataSource).toContain("stopControlSyncTransport()");
    expect(dataSource).toContain("正在把手机端最新变更同步回电脑 Hub");
    expect(dataSource).toContain("await localHub.resume()");
    expect(sessionSource).toContain("timeoutMs = 12_000");
    expect(dataSource).toContain("void refreshAll().catch");
    expect(dataSource).toContain("void startSync().catch");
    expect(dataSource).toContain("let syncGeneration = 0");
    expect(dataSource).toContain("generation !== syncGeneration || sync !== coordinator");
    expect(dataSource).toContain("syncGeneration += 1");
    expect(dataSource).toContain("generation !== controlSyncGeneration || controlSync !== coordinator");
    expect(dataSource).toContain("const bootstrapReporter = new MobileHealthReporter");
    expect(dataSource.indexOf("bootstrapReporter.start()")).toBeLessThan(
      dataSource.indexOf("await coordinator.start()")
    );
    expect(dataSource).not.toContain('else if (status.state === "retrying") syncState.value = "error"');
    expect(settingsSource).toContain("退出这个账号");
  });

  it("accepts a remote HTTPS Hub QR code during mobile sign in", () => {
    expect(loginSource).toContain("CapacitorBarcodeScanner.scanBarcode");
    expect(loginSource).toContain("/^https?:\\/\\//i.test(code)");
    expect(loginSource).toContain('mode.value = "login"');
    expect(loginSource).toContain("await inspectServer()");
    expect(loginSource).toContain("lastCompletedPairingCode");
    expect(loginSource).toContain('await router.replace("/home")');
    expect(sessionSource).toContain('cause.code === "PAIRING_STATE_CONFLICT"');
    expect(sessionSource).toContain("normalizeRouteUrl(api.serverUrl) === normalizeRouteUrl(payload.serverUrl)");
    expect(loginSource).toContain("overflow-y: auto");
    expect(loginSource).toContain("-webkit-overflow-scrolling: touch");
    expect(loginSource).not.toContain("PRIVATE DIGITAL SPACE");
    expect(loginSource).not.toContain("WELCOME BACK");
    expect(loginSource).not.toContain("回到只属于");
  });

  it("moves chat into focus layout without stacking it above the main navigation", () => {
    expect(chatSource).toContain('layout="focus"');
    expect(chatSource).toContain('back-to="/home"');
    expect(chatSource).toContain("headerless");
    expect(chatSource).toContain('class="chat-floating-controls"');
    expect(chatSource).toContain('aria-label="搜索聊天记录"');
    expect(chatSource).toContain('class="chat-search-view"');
    expect(chatSource).toContain("const searchResults = computed");
    expect(chatSource).toContain("message.role !== \"user\" && message.role !== \"assistant\"");
    expect(chatSource).toContain(':data-message-index="entry.index"');
    expect(chatSource).toContain("jumpToSearchResult");
    expect(chatSource).toContain('class="chat-search-snippet"');
    expect(chatSource).toContain("<mark>{{ result.match }}</mark>");
    expect(chatSource).toContain('class="scroll-to-latest"');
    expect(chatSource).toContain('@scroll.passive="updateLatestButton"');
    expect(chatSource).toContain("async function scrollToLatest()");
    expect(chatSource).toContain('await scrollToBottom("auto")');
    expect(chatSource).toContain('scrollToBottom(behavior: ScrollBehavior = "smooth")');
    expect(chatSource).toContain("showLatestButton.value");
    expect(chatSource).toContain("CHAT_RENDER_WINDOW = 120");
    expect(chatSource).toContain("renderedMessages");
    expect(chatSource).toContain("loadEarlierMessages");
    expect(chatSource).toContain("查看更早消息");
    expect(chatSource).toContain('type="text" inputmode="search"');
    expect(chatSource).toContain("border:0; border-bottom:1px solid");
    expect(chatSource).toContain("data.refreshConversationPage(true)");
    expect(chatSource).not.toContain("data.loadRemainingConversations()");
    expect(chatSource).not.toContain("开始新对话");
    expect(chatSource).not.toContain("对话记录");
    expect(chatSource).not.toContain("history-drawer");
    expect(chatSource).not.toContain("history-list");
    expect(chatSource).toContain("一直在这一段对话里延续共同的上下文");
    expect(chatSource).not.toContain("data.refreshAll().catch");
    expect(chatSource).toContain("backdrop-filter:blur(26px) saturate(165%)");
    expect(chatSource).toContain("border-radius:22px 22px 22px 7px");
    expect(chatSource).toContain("border-radius:22px 22px 7px 22px");
    expect(chatSource).toContain("messageTimestampFormatter");
    expect(chatSource).toContain('class="message-timestamp"');
    expect(chatSource).toContain("message.createdAt");
    expect(chatSource).toContain("position:absolute; right:11px; bottom:6px");
    expect(chatSource).toContain("right:8px; bottom:5px");
    expect(chatSource).not.toContain("message-content::after");
    expect(chatSource).not.toContain('year: "numeric"');
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
