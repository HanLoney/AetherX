const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "home.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "home.css"), "utf8");
const javascript = fs.readFileSync(path.join(__dirname, "..", "home.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
const providers = fs.readFileSync(path.join(__dirname, "..", "ai-providers.js"), "utf8");

test("sidebar navigation is grouped into clear functional areas", () => {
  ["dailyNavLabel", "spaceNavGroup", "createNavGroup", "systemNavLabel"].forEach(
    (id) => assert.match(html, new RegExp(`id="${id}"`))
  );
  assert.match(javascript, /querySelector\("#spaceNavGroup"\)\.append/);
  assert.match(javascript, /querySelector\("#createNavGroup"\)\.append/);
});

test("sidebar uses compact navigation rows and a distinct active state", () => {
  assert.match(css, /\.nav-item\s*\{[^}]*height:\s*37px;/s);
  assert.match(css, /\.nav-item\.active\s*\{[^}]*linear-gradient/s);
  assert.match(css, /\.nav-group-label\s*\{/);
});

test("single conversation mode exposes no conversation selector", () => {
  assert.match(css, /\.nav-list\s*\{[^}]*flex:\s*0 1 auto;/s);
  assert.doesNotMatch(javascript, /conversationHistoryList|historyPanel|history-item/);
  assert.doesNotMatch(css, /\.history-panel|\.history-list|\.history-item/);
  assert.match(css, /\.provider-card\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test("desktop welcome follows the saved profile instead of a hard-coded user", () => {
  assert.match(html, /id="welcomeTitle"/);
  assert.doesNotMatch(html, /嗨，洛尼。今天想一起做什么？/);
  assert.match(javascript, /welcomeTitle\.textContent = `嗨，\$\{name\}。今天想一起做什么？`/);
  assert.match(javascript, /state\.userProfile\?\.displayName\s*\|\|\s*user\.displayName/);
  assert.match(javascript, /state\.assistantProfile = assistantProfile;\s*renderAccount\(\);/);
  assert.doesNotMatch(javascript, /\|\|\s*"洛尼"/);
});

test("desktop searches the primary conversation in a dedicated result view", () => {
  assert.match(html, /id="messageSearchBtn"/);
  assert.match(html, /id="messageSearchView"/);
  assert.match(html, /id="messageSearchResults"/);
  assert.match(javascript, /function messageSearchMatches\(\)/);
  assert.match(javascript, /\["user", "assistant"\]\.includes\(message\.role\)/);
  assert.match(javascript, /row\.dataset\.messageIndex = String\(index\)/);
  assert.match(javascript, /function jumpToSearchedMessage\(index\)/);
  assert.match(javascript, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(css, /\.conversation\.search-open > \.message-list/);
  assert.match(css, /\.message-search-snippet mark/);
  assert.match(html, /type="text" inputmode="search"/);
  assert.match(css, /\.message-search-result\s*\{[^}]*border:\s*0;[^}]*border-bottom:/s);
  assert.match(css, /\.message-search-tabs button\s*\{[^}]*border:\s*0;/s);
  assert.match(html, /id="scrollToLatestBtn"/);
  assert.match(javascript, /function updateScrollToLatestButton\(\)/);
  assert.match(javascript, /elements\.conversation\.addEventListener\("scroll", updateScrollToLatestButton/);
  assert.match(javascript, /function scrollConversationToLatest\(\)/);
  assert.match(css, /\.scroll-to-latest\s*\{/);
  assert.match(html, /<section class="composer-wrap">\s*<button id="scrollToLatestBtn"/);
  assert.match(css, /\.scroll-to-latest\s*\{[^}]*top:\s*-34px;[^}]*right:\s*8px;/s);
});

test("desktop keeps one primary conversation and appends proactive reminders to it", () => {
  assert.doesNotMatch(html, /id="clearChatBtn"/);
  assert.doesNotMatch(javascript, /newConversationBtn|startNewConversation/);
  assert.doesNotMatch(javascript, /当前对话|conversationHistoryList/);
  assert.match(javascript, /listConversations\(\)\)\.slice\(0, 1\)/);
  assert.match(javascript, /await waitForConversationWriteSlot\(\)/);
  assert.match(javascript, /createConversation\("和小玄的对话"\)/);
  assert.doesNotMatch(javascript, /createConversation\("主动提醒"\)/);
});

test("desktop message bubbles display their persisted creation timestamp", () => {
  assert.match(javascript, /createdAt: Date\.now\(\)/);
  assert.match(javascript, /messageTimestampFormatter/);
  assert.match(javascript, /time\.className = "message-timestamp"/);
  assert.match(javascript, /getMessageTimestamp\(message\.createdAt\)/);
  assert.match(javascript, /hour: "2-digit"/);
  assert.doesNotMatch(
    javascript,
    /const messageTimestampFormatter = new Intl\.DateTimeFormat\("zh-CN", \{[^}]*year:/
  );
  assert.match(css, /\.message-timestamp\s*\{/);
  assert.match(css, /\.message-timestamp\s*\{[^}]*position:\s*absolute;/s);
  assert.match(css, /\.user \.message-timestamp/);
  assert.match(css, /\.user \.message-bubble\s*\{[^}]*padding:\s*12px 14px;/s);
  assert.match(css, /\.user \.message-timestamp\s*\{[^}]*right:\s*8px;[^}]*bottom:\s*5px;/s);
  assert.doesNotMatch(css, /\.user \.message-content::after/);
});

test("functional navigation uses one consistent SVG icon system", () => {
  assert.match(html, /<svg viewBox="0 0 24 24">/);
  assert.match(javascript, /function navIcon\(paths\)/);
  assert.match(css, /\.nav-item i svg\s*\{[^}]*stroke-width:\s*1\.7;/s);
  assert.doesNotMatch(javascript, /<i>[◈◇☾▣]<\/i>/);
});

test("desktop exposes a polished global font size setting", () => {
  assert.match(html, /id="interfaceSettingsBtn"/);
  assert.match(html, /id="desktopFontScaleRange"[^>]*min="85"[^>]*max="125"/);
  assert.match(html, /全局字体大小/);
  assert.match(javascript, /applyDesktopFontScale/);
  assert.match(javascript, /aether:font-scale/);
  assert.match(css, /\.interface-settings-panel\s*\{/);
  assert.match(css, /--font-scale/);
});

test("desktop settings expose encrypted export and archive import", () => {
  assert.match(html, /id="archivePasswordInput"/);
  assert.match(html, /id="archiveProviderKeysInput"/);
  assert.match(javascript, /secretPolicy:[\s\S]*"password_encrypted"[\s\S]*"excluded"/);
  assert.match(html, /id="exportArchiveBtn"/);
  assert.match(html, /id="restoreArchiveBtn"/);
  assert.match(html, /导入存档/);
  assert.doesNotMatch(html, /合并导入/);
  assert.match(javascript, /window\.desktop\.exportArchive/);
  assert.match(javascript, /window\.desktop\.restoreArchive/);
  assert.match(css, /\.archive-setting\s*\{/);
});

test("desktop header shows the current active Hub separately from AI connectivity", () => {
  assert.match(html, /id="hubPill"/);
  assert.match(html, /id="statusPill"/);
  assert.match(javascript, /getHubStatus/);
  assert.match(javascript, /onHubRouted/);
  assert.match(javascript, /手机 Hub/);
  assert.match(javascript, /电脑 Hub/);
  assert.match(css, /\.hub-pill\s*\{/);
});

test("desktop refreshes account AI configuration after a remote device changes it", () => {
  assert.match(javascript, /entityTypes\.has\("ai_configs"\)/);
  assert.match(javascript, /jobs\.push\(refreshRemoteAiConfig\(\)\)/);
  assert.match(javascript, /async function refreshRemoteAiConfig\(\)/);
  assert.match(javascript, /state\.config = config/);
  assert.match(javascript, /已同步另一台设备保存的最新 AI 配置/);
});

test("desktop keeps one saved connection profile per AI provider", () => {
  assert.match(preload, /listAIProviders/);
  assert.match(preload, /testAIProvider/);
  assert.match(preload, /activateAIProvider/);
  assert.match(javascript, /providerProfiles/);
  assert.match(javascript, /已连接 · \$\{saved\.model\}/);
  assert.match(javascript, /window\.desktop\.testAIProvider\(draft\)/);
  assert.match(javascript, /window\.desktop\.activateAIProvider\(profile\.providerId\)/);
});

test("desktop AI provider selectors use bundled official brand icons", () => {
  ["openai.svg", "deepseek.svg", "qwen.svg", "zhipu.png", "siliconflow.ico", "volcengine.png"].forEach(
    (icon) => assert.match(providers, new RegExp(`provider-icons/${icon.replace(".", "\\.")}`))
  );
  assert.match(providers, /window\.providerIconElement/);
  assert.match(javascript, /providerIconElement\(provider\)/);
  assert.doesNotMatch(javascript, /logo\.textContent = provider\.shortName/);
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(packageMetadata.build.files.includes("provider-icons/**/*"));
});

test("desktop integrates the Hub connection matrix instead of relying on the launcher", () => {
  assert.match(html, /id="connectionCenterMask"/);
  assert.match(html, /id="computerHubNode"[\s\S]*id="hubPeerBridge"[\s\S]*id="mobileHubNode"/);
  assert.match(html, /id="desktopClientCard"/);
  assert.match(html, /id="anywhereCard"/);
  assert.match(html, /id="mobileClientCard"/);
  assert.ok(html.indexOf('src="connection-center.js"') < html.indexOf('src="home.js"'));
  assert.match(preload, /getConnectionStatus:\s*\(\) => ipcRenderer\.invoke\("connections:status"\)/);
  assert.match(main, /ipcMain\.handle\("connections:status", \(\) => \{/);
  assert.match(main, /return loadConnectionStatus\(\)/);
  assert.match(main, /localApi \? settleStatus\(localApi\.listMobileHubs\(\), \{ hubs: \[\] \}\)/);
  assert.match(javascript, /elements\.connectionCenterBtn\.addEventListener\("click"/);
  assert.match(javascript, /isHubRecoveryActionable\(state\.hubStatus\)/);
  assert.match(javascript, /connectionCenter\.open\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "connection-center.js"), "utf8"), /上次连接到 \$\{activeHubName\}/);
  assert.match(css, /\.hub-peer-topology\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 138px minmax\(0, 1fr\);/s);
  assert.match(css, /\.connection-route-grid\s*\{/);
});

test("desktop exposes a complete dual-Hub divergence recovery center", () => {
  assert.match(html, /id="hubRecoveryMask"/);
  assert.match(html, /id="hubRecoveryOperations"/);
  assert.match(html, /id="keepMobileHubBtn"/);
  assert.match(html, /id="keepDesktopHubBtn"/);
  assert.match(html, /id="hubRecoveryProgress"/);
  assert.match(html, /id="retryHubRecoveryBtn"/);
  assert.match(html, /导出签名证据包/);
  assert.match(javascript, /window\.desktop\.getHubDivergence/);
  assert.match(javascript, /window\.desktop\.recoverHubDivergence\(authority\)/);
  assert.match(javascript, /window\.desktop\.exportHubDivergenceEvidence/);
  assert.match(javascript, /function renderHubRecoveryOperation/);
  assert.match(javascript, /"recovering_divergence"/);
  assert.match(javascript, /startHubRecovery\("mobile"\)/);
  assert.match(javascript, /startHubRecovery\("desktop"\)/);
  assert.match(javascript, /retryHubRecoveryCommand/);
  assert.match(main, /localStatus\.forcedTakeover/);
  assert.match(css, /\.hub-recovery-panel\s*\{/);
  assert.match(css, /\.hub-recovery-operation\s*\{/);
  assert.match(css, /\.hub-recovery-choices\s*\{/);
});

test("background conversation refresh does not steal the active workspace", () => {
  assert.match(javascript, /loadConversation\(state\.conversationId, \{ force: true, fromSync: true \}\)/);
  assert.match(javascript, /if \(!options\.fromSync\) showChatWorkspace\(\)/);
});

test("primary conversation loading is immediate and stale requests cannot win", () => {
  assert.match(javascript, /const loadId = \+\+conversationLoadId;/);
  assert.match(
    javascript,
    /state\.conversationId = id;[\s\S]*?await window\.desktop\.getConversation\(id\)/
  );
  assert.match(
    javascript,
    /if \(loadId !== conversationLoadId \|\| state\.conversationId !== id\) return;/
  );
  assert.match(javascript, /let cachedMessages = conversationCache\.get\(id\);/);
  assert.match(javascript, /window\.AetherConversationCache\?\.load\(scope, id\)/);
  assert.match(javascript, /fetchConversationMessagePages\(id, cachedMessages \|\| \[\]\)/);
});

test("routing to another Hub refreshes profile avatars without stale responses winning", () => {
  assert.match(javascript, /const refreshId = \+\+profileRefreshId/);
  assert.match(javascript, /if \(refreshId !== profileRefreshId\) return/);
  assert.match(javascript, /onHubRouted\([\s\S]*refreshRoutedHubData\(\)/);
  assert.match(
    javascript,
    /refreshRoutedHubData[\s\S]*refreshCoreHubData\(\{ fromRouting: true \}\)/
  );
});
