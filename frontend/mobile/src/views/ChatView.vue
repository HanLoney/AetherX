<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowDown, ArrowLeft, Search, SendHorizontal, Smile, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import ChatActivity from "../components/ChatActivity.vue";
import EmptyState from "../components/EmptyState.vue";
import MarkdownMessage from "../components/MarkdownMessage.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { normalizeStoredDisplayMessages } from "../lib/chat-history";
import {
  dedupeConversationMessages,
  loadConversationCache,
  loadLatestConversationCache,
  mergeConversationTail,
  normalizeMessagePositions,
  peekConversationCache,
  peekLatestConversationCache,
  saveConversationCache
} from "../lib/conversation-cache";
import { MobileChat } from "../lib/hub-chat";
import { NATIVE_BACK_EVENT } from "../lib/native-back";
import type { ChatMessage, Conversation } from "../lib/api";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import "emoji-picker-element";

const data = useDataStore();
const session = useSessionStore();
const router = useRouter();
const current = ref<Conversation | null>(null);
const displayMessages = ref<ChatMessage[]>([]);
const draft = ref("");
const emojiOpen = ref(false);
const emojiPanel = ref<HTMLElement | null>(null);
const emojiPicker = ref<HTMLElement | null>(null);
const emojiButton = ref<HTMLButtonElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const sending = ref(false);
const error = ref("");
const messageList = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const searchOpen = ref(false);
const searchQuery = ref("");
const showLatestButton = ref(false);
const conversationLoading = ref(false);
let conversationRefreshPending = false;
let conversationLoadGeneration = 0;
const CHAT_RENDER_WINDOW = 120;
const renderStart = ref(0);
const renderEnd = ref(0);
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const messageTimestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function messageTimestamp(value?: number) {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: messageTimestampFormatter.format(date),
    iso: date.toISOString()
  };
}

function conversationCacheScope() {
  const api = session.requireApi();
  const identity = session.user.value?.id || session.user.value?.email || "";
  return `${session.spaceId.value || api.serverUrl}|${identity}`;
}

async function loadConversationIncrementally(conversation: Conversation) {
  const scope = conversationCacheScope();
  const cached = await loadConversationCache(scope, conversation.id);
  const cachedMessages = normalizeMessagePositions(cached?.messages || []);
  const overlapStart = cachedMessages.length
    ? Math.max(-1, Math.max(...cachedMessages.map((message) => Number(message.position) || 0)) - 30)
    : -1;
  const retained = cachedMessages.filter((message) => Number(message.position) <= overlapStart);
  const received: ChatMessage[] = [];
  let afterPosition = overlapStart;
  let hasMore = true;
  while (hasMore) {
    const page = await session.requireApi().conversationMessagePage(
      conversation.id,
      afterPosition,
      500
    );
    received.push(...page.items);
    hasMore = page.hasMore;
    if (hasMore && page.nextPosition <= afterPosition) {
      throw new Error("聊天增量游标没有继续前进。");
    }
    afterPosition = page.nextPosition;
  }
    const messages = mergeConversationTail(retained, received, overlapStart);
  return {
    conversation,
    messages,
    scope
  };
}
const assistantName = computed(() => String(data.assistant.value.name || "小玄"));
const assistantAvatar = computed(() => String(data.assistant.value.avatarDataUrl || ""));
const userName = computed(() => String(data.profile.value.preferredName || data.profile.value.displayName || session.user.value?.displayName || "你"));
const userAvatar = computed(() => String(data.profile.value.avatarDataUrl || ""));
const renderedMessages = computed(() => displayMessages.value
  .slice(renderStart.value, renderEnd.value)
  .map((message, index) => ({ message, index: renderStart.value + index })));
const hasEarlierMessages = computed(() => renderStart.value > 0);
const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return [];
  return displayMessages.value.flatMap((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const content = String(message.content || "").replace(/\s+/g, " ").trim();
    const matchIndex = content.toLocaleLowerCase().indexOf(query);
    if (matchIndex < 0) return [];
    const start = Math.max(0, matchIndex - 28);
    const end = Math.min(content.length, matchIndex + query.length + 46);
    return [{
      message,
      index,
      before: `${start > 0 ? "…" : ""}${content.slice(start, matchIndex)}`,
      match: content.slice(matchIndex, matchIndex + query.length),
      after: `${content.slice(matchIndex + query.length, end)}${end < content.length ? "…" : ""}`
    }];
  });
});
const searchDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

function searchResultDate(value?: number) {
  if (value === undefined) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : searchDateFormatter.format(date);
}

async function openSearch() {
  emojiOpen.value = false;
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}

function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = "";
}

async function jumpToSearchResult(index: number) {
  closeSearch();
  if (index < renderStart.value || index >= renderEnd.value) {
    renderStart.value = Math.max(0, index - Math.floor(CHAT_RENDER_WINDOW / 3));
    renderEnd.value = Math.min(displayMessages.value.length, renderStart.value + CHAT_RENDER_WINDOW);
  }
  await nextTick();
  const row = messageList.value?.querySelector<HTMLElement>(`[data-message-index="${index}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("search-jump");
  window.setTimeout(() => row.classList.remove("search-jump"), 1800);
  window.setTimeout(updateLatestButton, 350);
}

function updateLatestButton() {
  const list = messageList.value;
  if (!list || searchOpen.value || !displayMessages.value.length) {
    showLatestButton.value = false;
    return;
  }
  showLatestButton.value = renderEnd.value < displayMessages.value.length ||
    list.scrollHeight - list.scrollTop - list.clientHeight >= 96;
}

async function scrollToLatest() {
  showLatestMessageWindow();
  await nextTick();
  const list = messageList.value;
  if (!list) return;
  showLatestButton.value = false;
  list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
}

function showLatestMessageWindow() {
  renderEnd.value = displayMessages.value.length;
  renderStart.value = Math.max(0, renderEnd.value - CHAT_RENDER_WINDOW);
}

function replaceDisplayMessages(messages: ChatMessage[]) {
  displayMessages.value = dedupeConversationMessages(messages);
  showLatestMessageWindow();
}

async function loadEarlierMessages() {
  const list = messageList.value;
  if (!list || !hasEarlierMessages.value) return;
  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;
  renderStart.value = Math.max(0, renderStart.value - CHAT_RENDER_WINDOW);
  await nextTick();
  list.scrollTop = previousTop + list.scrollHeight - previousHeight;
}

function handleEmojiClick(event: Event) {
  const emojiEvent = event as CustomEvent<{ unicode: string }>;
  const emoji = emojiEvent.detail?.unicode;

  if (emoji) {
    draft.value += emoji;
  }
}

async function toggleEmojiPanel() {
  const opening = !emojiOpen.value;
  emojiOpen.value = opening;
  if (opening) {
    composerInput.value?.blur();
    return;
  }
  await nextTick();
  composerInput.value?.focus();
}

async function prepareCompactEmojiPicker() {
  await customElements.whenDefined("emoji-picker");
  await nextTick();
  const root = emojiPicker.value?.shadowRoot;
  if (!root || root.querySelector("#aetherx-compact-emoji-style")) return;
  const style = document.createElement("style");
  style.id = "aetherx-compact-emoji-style";
  style.textContent = `
    .pad-top,
    .search-row,
    .favorites {
      display: none !important;
    }
    .tabpanel {
      order: 1;
    }
    .indicator-wrapper {
      order: 2;
      border-top: 1px solid var(--border-color);
      border-bottom: 0;
      background: #f5f5fa;
    }
    .nav {
      order: 3;
      padding: .18rem .08rem .12rem;
      background: #f5f5fa;
    }
  `;
  root.append(style);
}

function closeEmojiOnOutsidePointer(event: PointerEvent) {
  if (!emojiOpen.value) return;
  const path = event.composedPath();
  if (emojiPanel.value && path.includes(emojiPanel.value)) return;
  if (emojiButton.value && path.includes(emojiButton.value)) return;
  emojiOpen.value = false;
}

function handleNativeBack(event: Event) {
  if (searchOpen.value) {
    closeSearch();
    event.preventDefault();
    return;
  }
  if (emojiOpen.value) {
    emojiOpen.value = false;
    event.preventDefault();
  }
}

const initialCachedConversation = peekLatestConversationCache(conversationCacheScope());
if (initialCachedConversation) {
  current.value = initialCachedConversation.conversation;
  replaceDisplayMessages(normalizeStoredDisplayMessages(initialCachedConversation.messages));
}

onMounted(async () => {
  document.addEventListener("pointerdown", closeEmojiOnOutsidePointer, true);
  window.addEventListener(NATIVE_BACK_EVENT, handleNativeBack);
  void prepareCompactEmojiPicker();
  try {
    const latestCached = initialCachedConversation ||
      await loadLatestConversationCache(conversationCacheScope());
    if (latestCached) {
      current.value = latestCached.conversation;
      replaceDisplayMessages(normalizeStoredDisplayMessages(latestCached.messages));
      conversationLoading.value = false;
      await scrollToBottom("auto");
    }

    await data.restoreCache();
    const cachedConversation = latestCached
      ? data.conversations.value.find((item) => item.id === latestCached.conversationId) ||
        latestCached.conversation
      : null;
    const localConversation = cachedConversation || data.conversations.value[0];
    if (localConversation) {
      void openConversation(localConversation).catch(() => undefined);
      void data.refreshConversationPage(true).catch(() => undefined);
    } else {
      conversationLoading.value = !displayMessages.value.length;
      await data.refreshConversationPage(true);
      if (data.conversations.value[0]) {
        void openConversation(data.conversations.value[0]).catch(() => undefined);
      } else {
        conversationLoading.value = false;
      }
    }
  } catch (cause) {
    conversationLoading.value = false;
    error.value = cause instanceof Error ? cause.message : "最新对话暂时没有打开。";
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeEmojiOnOutsidePointer, true);
  window.removeEventListener(NATIVE_BACK_EVENT, handleNativeBack);
});

async function openConversation(conversation: Conversation) {
  const generation = ++conversationLoadGeneration;
  const scope = conversationCacheScope();
  let cached = peekConversationCache(scope, conversation.id);
  if (cached) {
    current.value = cached.conversation || conversation;
    replaceDisplayMessages(normalizeStoredDisplayMessages(cached.messages));
    conversationLoading.value = false;
  }
  try {
    cached ||= await loadConversationCache(scope, conversation.id);
    if (generation !== conversationLoadGeneration) return;
    if (cached) {
      current.value = cached.conversation || conversation;
      replaceDisplayMessages(normalizeStoredDisplayMessages(cached.messages));
      // Cached history is the interactive source. Remote reconciliation continues
      // in the background and must not put the chat back into a loading state.
      conversationLoading.value = false;
      await scrollToBottom("auto");
    } else {
      conversationLoading.value = true;
    }
    const result = await loadConversationIncrementally(conversation);
    if (generation !== conversationLoadGeneration) return;
    current.value = result.conversation || conversation;
    replaceDisplayMessages(normalizeStoredDisplayMessages(result.messages));
    await saveConversationCache(result.scope, current.value, result.messages);
  } catch (cause) {
    if (generation !== conversationLoadGeneration) return;
    try {
      const result = await session.requireApi().conversation(conversation.id);
      if (generation !== conversationLoadGeneration) return;
      current.value = result.conversation;
      const messages = normalizeMessagePositions(result.displayMessages || []);
      replaceDisplayMessages(normalizeStoredDisplayMessages(messages));
      await saveConversationCache(conversationCacheScope(), current.value, messages).catch(() => undefined);
    } catch (fallbackCause) {
      error.value = fallbackCause instanceof Error ? fallbackCause.message :
        (cause instanceof Error ? cause.message : "最新对话暂时没有打开。");
    }
  } finally {
    if (generation === conversationLoadGeneration) {
      conversationLoading.value = false;
      await scrollToBottom("auto");
    }
  }
}

watch(() => data.conversationRevision.value, async () => {
  if (!current.value) return;
  if (sending.value) {
    conversationRefreshPending = true;
    return;
  }
  const latest = data.conversations.value.find((item) => item.id === current.value?.id);
  if (!latest) {
    // Archive restore and Hub refresh briefly reset the in-memory conversation
    // list. Keep the visible conversation during that gap and reopen the
    // newest one once the refreshed page arrives instead of erasing history.
    conversationLoading.value = data.loading.value ||
      data.conversationPageLoading.value || data.syncState.value === "syncing";
    const fallback = data.conversations.value[0];
    if (fallback) await openConversation(fallback).catch(() => undefined);
    return;
  }
  if ((latest.updatedAt || 0) <= (current.value.updatedAt || 0)) return;
  await openConversation(latest).catch(() => undefined);
});

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  emojiOpen.value = false;
  // A background cache reconciliation started while entering the page must
  // never overwrite the optimistic message or the result of this send.
  conversationLoadGeneration += 1;
  sending.value = true;
  error.value = "";
  draft.value = "";
  const optimistic: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
  displayMessages.value.push(optimistic);
  renderEnd.value = displayMessages.value.length;
  await scrollToBottom();
  try {
    const chat = new MobileChat(session.requireApi());
    const result = await chat.send({
      conversation: current.value,
      displayMessages: displayMessages.value.slice(0, -1),
      content,
      onActivity: updateActivity,
      requestApproval
    });
    current.value = result.conversation;
    replaceDisplayMessages(result.displayMessages);
    await saveConversationCache(conversationCacheScope(), current.value, result.displayMessages).catch(() => undefined);
    conversationRefreshPending = false;
    sending.value = false;
    void data.refreshConversationPage(true).catch(() => undefined);
    await scrollToBottom();
  } catch (cause) {
    resolveAllApprovals(false);
    displayMessages.value = displayMessages.value.filter((message) => message !== optimistic);
    showLatestMessageWindow();
    draft.value = content;
    error.value = cause instanceof Error ? cause.message : "消息没有发出去。";
  } finally {
    sending.value = false;
    if (conversationRefreshPending && current.value) {
      conversationRefreshPending = false;
      const latest = data.conversations.value.find((item) => item.id === current.value?.id);
      if (latest && (latest.updatedAt || 0) > (current.value.updatedAt || 0)) {
        await openConversation(latest).catch(() => undefined);
      }
    }
    await scrollToBottom();
  }
}

function updateActivity(activity: ChatMessage) {
  const index = displayMessages.value.findIndex((message) => message.id === activity.id);
  if (index >= 0) displayMessages.value.splice(index, 1, activity);
  else {
    displayMessages.value.push(activity);
    renderEnd.value = displayMessages.value.length;
  }
  void scrollToBottom();
}

function requestApproval(activity: ChatMessage) {
  updateActivity(activity);
  return new Promise<boolean>((resolve) => {
    if (activity.id) pendingApprovals.set(activity.id, resolve);
    else resolve(false);
  });
}

function decideTool(activity: ChatMessage, approved: boolean) {
  if (!activity.id) return;
  const resolve = pendingApprovals.get(activity.id);
  if (!resolve) return;
  pendingApprovals.delete(activity.id);
  activity.status = approved ? "running" : "denied";
  activity.statusText = approved ? "已允许 · 执行中" : "已拒绝";
  updateActivity({ ...activity });
  resolve(approved);
}

function resolveAllApprovals(approved: boolean) {
  for (const resolve of pendingApprovals.values()) resolve(approved);
  pendingApprovals.clear();
}

async function scrollToBottom(behavior: ScrollBehavior = "smooth") {
  await nextTick();
  showLatestButton.value = false;
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior });
}
</script>

<template>
  <AppShell :title="assistantName" layout="focus" back-to="/home" headerless quiet>
    <div class="liquid-orb liquid-orb-pink" aria-hidden="true" />
    <div class="liquid-orb liquid-orb-blue" aria-hidden="true" />

    <nav v-if="!searchOpen" class="chat-floating-controls" aria-label="聊天页面操作">
      <button class="liquid-control" type="button" aria-label="返回主页" @click="router.push('/home')">
        <ArrowLeft :size="20" />
      </button>
      <button class="liquid-control" type="button" aria-label="搜索聊天记录" @click="openSearch">
        <Search :size="19" />
      </button>
    </nav>

    <section v-if="searchOpen" class="chat-search-view" aria-label="搜索聊天记录">
      <header class="chat-search-head">
        <label class="chat-search-field">
          <Search :size="20" />
          <input ref="searchInput" v-model="searchQuery" type="text" inputmode="search" autocomplete="off" placeholder="搜索聊天记录" />
          <button v-if="searchQuery" type="button" aria-label="清空搜索" @click="searchQuery = ''"><X :size="17" /></button>
        </label>
        <button class="chat-search-cancel" type="button" @click="closeSearch">取消</button>
      </header>
      <nav class="chat-search-tabs" aria-label="搜索范围"><button class="active" type="button">全部</button></nav>
      <div class="chat-search-summary">
        <strong>聊天记录</strong>
        <span>{{ searchQuery.trim() ? `${searchResults.length} 条结果` : "输入关键词开始搜索" }}</span>
      </div>
      <div class="chat-search-results">
        <button
          v-for="result in searchResults"
          :key="result.message.id || result.index"
          class="chat-search-result"
          type="button"
          @click="jumpToSearchResult(result.index)"
        >
          <ProfileAvatar
            :name="result.message.role === 'assistant' ? assistantName : userName"
            :src="result.message.role === 'assistant' ? assistantAvatar : userAvatar"
            size="small"
          />
          <span class="chat-search-result-content">
            <strong>{{ result.message.role === "assistant" ? assistantName : userName }}</strong>
            <span class="chat-search-snippet">{{ result.before }}<mark>{{ result.match }}</mark>{{ result.after }}</span>
          </span>
          <time>{{ searchResultDate(result.message.createdAt) }}</time>
        </button>
        <div v-if="!searchResults.length" class="chat-search-empty">
          {{ searchQuery.trim() ? "换个关键词试试" : `可以搜索你和 ${assistantName} 说过的话` }}
        </div>
      </div>
    </section>

    <section v-show="!searchOpen" ref="messageList" class="message-list" @scroll.passive="updateLatestButton">
      <div v-if="conversationLoading && !displayMessages.length" class="chat-loading" role="status" aria-live="polite">
        <i /><span>正在加载聊天记录…</span>
      </div>
      <EmptyState v-if="!displayMessages.length" :title="`和 ${assistantName} 说点什么`" description="你们会一直在这一段对话里延续共同的上下文。" />
      <button v-if="hasEarlierMessages" class="chat-load-earlier" type="button" @click="loadEarlierMessages">查看更早消息</button>
      <template v-for="entry in renderedMessages" :key="entry.message.id || entry.index">
        <ChatActivity v-if="entry.message.role === 'tool' || entry.message.role === 'memory'" :message="entry.message" @decide="decideTool(entry.message, $event)" />
        <article v-else-if="entry.message.role === 'assistant' || entry.message.role === 'user'" class="message-row" :class="entry.message.role" :data-message-index="entry.index">
          <ProfileAvatar v-if="entry.message.role === 'assistant'" :name="assistantName" :src="assistantAvatar" size="small" />
          <div class="message-bubble">
            <MarkdownMessage v-if="entry.message.role === 'assistant'" :content="entry.message.content || ''" />
            <span v-else class="message-content">{{ entry.message.content }}</span>
            <time
              v-if="messageTimestamp(entry.message.createdAt)"
              class="message-timestamp"
              :datetime="messageTimestamp(entry.message.createdAt)?.iso"
            >{{ messageTimestamp(entry.message.createdAt)?.label }}</time>
          </div>
          <ProfileAvatar v-if="entry.message.role === 'user'" :name="userName" :src="userAvatar" size="small" />
        </article>
      </template>
      <article v-if="sending" class="message-row assistant">
        <ProfileAvatar :name="assistantName" :src="assistantAvatar" size="small" />
        <div class="message-bubble typing"><i /><i /><i /></div>
      </article>
    </section>

    <Transition name="latest-button">
      <button v-if="!searchOpen && showLatestButton" class="scroll-to-latest" type="button" aria-label="回到最新消息" @click="scrollToLatest">
        <ArrowDown :size="16" />
        <span>最新</span>
      </button>
    </Transition>

    <template #bottom-dock>
      <template v-if="!searchOpen">
        <div class="dock-scrim" aria-hidden="true" />
        <p v-if="error" class="chat-error">{{ error }}</p>
        <div class="composer-stack" :class="{ 'emoji-open': emojiOpen }">
        <form class="chat-composer" @submit.prevent="send">
          <button
            ref="emojiButton"
            type="button"
            class="emoji-button"
            aria-label="选择表情"
            :class="{ active: emojiOpen }"
            @click="toggleEmojiPanel"
          >
            <Smile :size="21" />
          </button>
          <textarea ref="composerInput" v-model="draft" rows="1" :placeholder="`给 ${assistantName} 发消息…`" @keydown.enter.exact.prevent="send" />
          <button class="send-button" type="submit" :disabled="!draft.trim() || sending" aria-label="发送"><SendHorizontal :size="20" /></button>
        </form>
        <Transition name="emoji-reveal">
          <section v-show="emojiOpen" ref="emojiPanel" class="emoji-panel">
            <emoji-picker
              ref="emojiPicker"
              locale="zh"
              @emoji-click="handleEmojiClick"
            />
          </section>
        </Transition>
        </div>
      </template>
    </template>

  </AppShell>
</template>

<style scoped>
.liquid-orb { position:fixed; z-index:-1; border-radius:50%; pointer-events:none; filter:blur(12px); opacity:.42; }
.liquid-orb-pink { width:230px; height:230px; top:-92px; left:-95px; background:radial-gradient(circle at 65% 65%,rgba(245,166,211,.78),rgba(245,166,211,0) 70%); }
.liquid-orb-blue { width:280px; height:280px; right:-135px; bottom:9%; background:radial-gradient(circle at 36% 42%,rgba(126,190,238,.7),rgba(126,190,238,0) 70%); }
.chat-floating-controls { position:fixed; z-index:38; top:max(12px,env(safe-area-inset-top)); left:14px; right:14px; display:flex; align-items:center; justify-content:space-between; pointer-events:none; }
.liquid-control { position:relative; width:44px; height:44px; display:grid; place-items:center; overflow:hidden; pointer-events:auto; border:1px solid rgba(255,255,255,.72); border-radius:50%; color:#6f687c; background:linear-gradient(145deg,rgba(255,255,255,.64),rgba(255,255,255,.28)); box-shadow:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(116,105,139,.08),0 10px 30px rgba(69,64,91,.12); backdrop-filter:blur(26px) saturate(180%); -webkit-backdrop-filter:blur(26px) saturate(180%); }
.liquid-control::before { content:""; position:absolute; inset:1px 6px 52% 6px; border-radius:99px; background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,0)); pointer-events:none; }
.liquid-control svg { position:relative; z-index:1; }
.chat-search-view { height:100%; min-height:0; display:flex; flex-direction:column; padding:calc(max(12px,env(safe-area-inset-top)) + 2px) 0 12px; }
.chat-search-head { display:flex; align-items:center; gap:10px; padding:0 2px; }
.chat-search-field { height:48px; min-width:0; flex:1; display:flex; align-items:center; gap:9px; padding:0 10px 0 14px; border:1px solid rgba(255,255,255,.82); border-radius:16px; color:#9a95a0; background:rgba(255,255,255,.84); box-shadow:0 10px 28px rgba(65,60,88,.09); backdrop-filter:blur(24px); }
.chat-search-field input { min-width:0; flex:1; border:0; outline:0; color:#4f4a58; background:transparent; font-size:calc(15px * var(--font-scale, 1)); }
.chat-search-field button { width:25px; height:25px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; color:#fff; background:#aaa8ad; }
.chat-search-cancel { flex:0 0 auto; padding:10px 2px; border:0; color:#6483aa; background:transparent; font-size:calc(14px * var(--font-scale, 1)); }
.chat-search-tabs { height:54px; display:flex; align-items:flex-end; margin-top:2px; border-bottom:1px solid rgba(108,102,120,.09); }
.chat-search-tabs button { position:relative; height:100%; padding:0 20px; border:0; color:#68636e; background:transparent; font-size:calc(14px * var(--font-scale, 1)); }
.chat-search-tabs button.active::after { content:""; position:absolute; left:13px; right:13px; bottom:-1px; height:3px; border-radius:3px; background:#4d4a51; }
.chat-search-summary { display:flex; align-items:center; justify-content:space-between; padding:17px 8px 8px; }
.chat-search-summary strong { color:#625d69; font-size:calc(13px * var(--font-scale, 1)); }
.chat-search-summary span { color:#aaa5ae; font-size:calc(10px * var(--font-scale, 1)); }
.chat-search-results { min-height:0; flex:1; overflow-y:auto; scrollbar-width:none; }
.chat-search-results::-webkit-scrollbar { display:none; }
.chat-search-result { width:100%; display:grid; grid-template-columns:46px minmax(0,1fr) auto; align-items:start; gap:11px; padding:15px 8px; border:0; border-bottom:1px solid rgba(108,102,120,.08); border-radius:0; background:transparent; text-align:left; }
.chat-search-result :deep(.avatar-small) { width:46px; height:46px; border-radius:13px; }
.chat-search-result-content { min-width:0; display:grid; gap:5px; padding-top:1px; }
.chat-search-result-content strong { color:#6b6571; font-size:calc(14px * var(--font-scale, 1)); font-weight:500; }
.chat-search-snippet { overflow:hidden; color:#4c4851; font-size:calc(14px * var(--font-scale, 1)); line-height:1.45; text-overflow:ellipsis; white-space:nowrap; }
.chat-search-snippet mark { padding:0; color:#42b875; background:transparent; }
.chat-search-result time { padding-top:2px; color:#b0abb3; font-size:calc(12px * var(--font-scale, 1)); white-space:nowrap; }
.chat-search-empty { min-height:230px; display:grid; place-items:center; color:#aaa5ae; font-size:calc(12px * var(--font-scale, 1)); }
.message-list { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding:calc(max(12px,env(safe-area-inset-top)) + 58px) 2px calc(var(--bottom-dock-height) + 34px); scrollbar-width: none; }
.message-list::-webkit-scrollbar { display: none; }
.chat-loading { display:flex; align-items:center; justify-content:center; gap:8px; margin:8px auto 18px; color:#9993a2; font-size:calc(11px * var(--font-scale, 1)); }
.chat-loading i { width:12px; height:12px; border:2px solid rgba(122,145,180,.22); border-top-color:#7895b8; border-radius:50%; animation:chat-loading-spin .8s linear infinite; }
@keyframes chat-loading-spin { to { transform:rotate(360deg); } }
.chat-load-earlier { display:block; margin:0 auto 18px; padding:8px 14px; border:1px solid rgba(255,255,255,.76); border-radius:999px; color:#777083; background:rgba(255,255,255,.62); font-size:calc(10px * var(--font-scale,1)); box-shadow:0 7px 20px rgba(80,72,104,.08); }
.message-row { display:flex; align-items:flex-end; gap:7px; margin:0 0 14px; }
.message-row.user { justify-content: flex-end; }
.message-row :deep(.avatar-small) { width:30px; height:30px; border-radius:50%; border-color:rgba(255,255,255,.82); box-shadow:0 7px 20px rgba(91,78,116,.16); }
.message-bubble { position:relative; max-width:min(82%,510px); overflow:hidden; padding:12px 14px 20px; border:1px solid rgba(255,255,255,.7); border-radius:22px 22px 22px 7px; color:#4e495e; background:linear-gradient(145deg,rgba(255,255,255,.58),rgba(255,255,255,.28)); box-shadow:inset 0 1px 0 rgba(255,255,255,.86),inset 0 -1px 0 rgba(107,96,129,.06),0 12px 32px rgba(73,69,96,.09); backdrop-filter:blur(26px) saturate(165%); -webkit-backdrop-filter:blur(26px) saturate(165%); font-size: calc(13px * var(--font-scale, 1)); line-height:1.72; white-space:pre-wrap; overflow-wrap:anywhere; }
.message-bubble::before { content:""; position:absolute; z-index:-1; left:8%; right:18%; top:0; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent); }
.assistant .message-bubble { white-space: normal; }
.user .message-bubble { padding:12px 14px; border-color:rgba(255,255,255,.36); border-radius:22px 22px 7px 22px; color:#fff; background:linear-gradient(135deg,rgba(204,126,171,.84),rgba(125,139,190,.82) 58%,rgba(91,159,211,.78)); box-shadow:inset 0 1px 0 rgba(255,255,255,.42),0 12px 30px rgba(115,96,151,.2); }
.message-timestamp { position:absolute; right:11px; bottom:6px; color:rgba(78,73,94,.52); font-size:calc(8px * var(--font-scale, 1)); font-variant-numeric:tabular-nums; line-height:1; white-space:nowrap; }
.user .message-timestamp { right:8px; bottom:5px; color:rgba(255,255,255,.72); font-size:calc(8px * var(--font-scale, 1)); }
.message-row.search-jump .message-bubble { animation:message-search-jump 1.8s ease; }
@keyframes message-search-jump { 0%,100%{box-shadow:inherit} 18%,68%{box-shadow:0 0 0 3px rgba(66,184,117,.25),0 12px 30px rgba(73,69,96,.12)} }
.scroll-to-latest { position:fixed; z-index:37; right:16px; bottom:calc(var(--bottom-dock-height) + max(18px,env(safe-area-inset-bottom)) + 18px); height:36px; display:flex; align-items:center; gap:4px; padding:0 12px 0 10px; border:1px solid rgba(255,255,255,.82); border-radius:20px; color:#6d6877; background:rgba(255,255,255,.9); box-shadow:0 10px 30px rgba(65,60,88,.15); backdrop-filter:blur(22px) saturate(160%); -webkit-backdrop-filter:blur(22px) saturate(160%); }
.scroll-to-latest span { font-size:calc(11px * var(--font-scale, 1)); font-weight:600; }
.latest-button-enter-active,.latest-button-leave-active { transition:opacity .16s ease,transform .2s ease; }
.latest-button-enter-from,.latest-button-leave-to { opacity:0; transform:translateY(8px) scale(.96); }
.typing { display:flex; gap:5px; padding:17px 18px; }.typing i{width:5px;height:5px;border-radius:50%;background:#aaa3b5;animation:pulse 1.2s infinite}.typing i:nth-child(2){animation-delay:.18s}.typing i:nth-child(3){animation-delay:.36s}@keyframes pulse{0%,70%,100%{opacity:.35;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
.dock-scrim { position:absolute; z-index:-1; inset:-42px -14px -14px; pointer-events:none; background:linear-gradient(180deg,rgba(248,248,252,0),rgba(248,248,252,.68) 44%,rgba(248,248,252,.92) 78%); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
.composer-stack { --emoji-tray-height:min(268px,calc(100dvh - 176px)); position:relative; width:100%; border:1px solid rgba(255,255,255,.82); border-radius:29px; background:linear-gradient(145deg,rgba(255,255,255,.92),rgba(244,246,252,.86)); box-shadow:inset 0 1px 0 rgba(255,255,255,.98),0 18px 46px rgba(65,60,88,.16); transition:transform .3s cubic-bezier(.2,.78,.2,1),border-radius .2s ease; will-change:transform; }
.composer-stack.emoji-open { transform:translate3d(0,calc(-1 * var(--emoji-tray-height) - 8px),0); }
.chat-composer { position:relative; isolation:isolate; width:100%; min-height:var(--bottom-dock-height); overflow:hidden; display:flex; align-items:center; gap:8px; padding:7px; border:0; border-radius:28px; background:linear-gradient(145deg,rgba(255,255,255,.34),rgba(213,231,246,.08)); box-shadow:none; }
.chat-composer::before { content:""; position:absolute; left:8%; right:24%; top:1px; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,.96),transparent); pointer-events:none; }
.chat-composer::after { content:""; position:absolute; z-index:0; inset:0; pointer-events:none; background:linear-gradient(120deg,rgba(255,255,255,.26),rgba(255,255,255,.04) 48%,rgba(213,231,246,.12)); }
.chat-composer > * { position:relative; z-index:1; }
.chat-composer textarea { min-width:0; max-height:100px; flex:1; resize:none; border:0; outline:0; color:var(--ink); background:transparent; font-size: calc(13px * var(--font-scale, 1)); line-height:1.55; }
.chat-error { width:calc(100% - 14px);margin:0 auto 7px;padding:9px 12px;border:1px solid rgba(255,255,255,.66);border-radius:16px;color:#b95770;background:rgba(255,235,243,.56);font-size: calc(10px * var(--font-scale, 1));text-align:center;box-shadow:0 8px 24px rgba(95,70,90,.1);backdrop-filter:blur(24px)}
.emoji-panel {
  position: absolute;
  z-index: 1;
  top: calc(100% + 8px);
  left: -1px;
  width: 100%;
  height: var(--emoji-tray-height);
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.88);
  border-radius: 28px;
  background: linear-gradient(145deg,#fcfbfd,#f3f6fb);
  box-shadow: inset 0 1px 0 #fff,0 18px 48px rgba(75,70,103,.15);
  transform-origin: top center;
}

emoji-picker {
  width: 100%;
  height: 100%;
  --border-size: 0;
  --border-radius: 28px;
  --background: #f8f8fc;
  --border-color: rgba(126,117,148,.1);
  --indicator-color: #aa87b7;
  --indicator-height: 2px;
  --button-active-background: rgba(196,139,177,.15);
  --button-hover-background: rgba(126,174,213,.12);
  --category-font-color: #777082;
  --emoji-size: 1.42rem;
  --emoji-padding: .45rem;
  --category-emoji-size: 1.18rem;
  --input-border-color: rgba(120,110,145,.14);
  --input-border-radius: 14px;
  --input-font-color: #5d5868;
  --input-placeholder-color: #aaa3b0;
  --input-padding: .42rem .65rem;
  --outline-color: rgba(202, 136, 172, 0.35);
}
.emoji-reveal-enter-active,.emoji-reveal-leave-active { transition:opacity .16s ease,transform .22s cubic-bezier(.2,.78,.2,1); will-change:opacity,transform; }
.emoji-reveal-enter-from,.emoji-reveal-leave-to { opacity:0; transform:translate3d(0,-8px,0) scale(.985); }

.chat-composer .emoji-button {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border: 1px solid rgba(255,255,255,.5);
  border-radius: 50%;
  color: #938ba0;
  background: rgba(255,255,255,.24);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
}

.chat-composer .emoji-button.active {
  color: #ffffff;
  background: linear-gradient(135deg, #cf8bad, #79a9d2);
}

.chat-composer .send-button {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 50%;
  color: #ffffff;
  background: linear-gradient(135deg, rgba(207,139,173,.9), rgba(121,169,210,.88));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.46),0 9px 22px rgba(133,111,160,.22);
}

.chat-composer .send-button:disabled {
  color:#9891a1;
  background:rgba(255,255,255,.26);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.62);
  opacity:.72;
}
:deep(.bottom-dock) { width:min(calc(100% - 18px),650px); bottom:max(7px,calc(env(safe-area-inset-bottom) + 5px)); }
:deep(.activity-card) { width:min(94%,570px); border-color:rgba(255,255,255,.62); border-radius:24px; background:linear-gradient(145deg,rgba(255,255,255,.5),rgba(255,255,255,.24)); box-shadow:inset 0 1px 0 rgba(255,255,255,.82),0 14px 36px rgba(69,64,91,.09); backdrop-filter:blur(28px) saturate(165%); -webkit-backdrop-filter:blur(28px) saturate(165%); }
:deep(.activity-card.memory),:deep(.activity-card.tool.success),:deep(.activity-card.tool.waiting),:deep(.activity-card.tool.error),:deep(.activity-card.tool.denied) { background:linear-gradient(145deg,rgba(255,255,255,.52),rgba(246,242,251,.25)); }
:deep(.activity-head) { min-height:56px; }
:deep(.activity-detail) { border-top-color:rgba(255,255,255,.48); }
</style>
