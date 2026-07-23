<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, History, Menu, Plus, SendHorizontal, Smile, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import ChatActivity from "../components/ChatActivity.vue";
import EmptyState from "../components/EmptyState.vue";
import MarkdownMessage from "../components/MarkdownMessage.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { normalizeStoredDisplayMessages } from "../lib/chat-history";
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
const historyOpen = ref(false);
const messageList = ref<HTMLElement | null>(null);
let conversationRefreshPending = false;
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const assistantName = computed(() => String(data.assistant.value.name || "小玄"));
const assistantAvatar = computed(() => String(data.assistant.value.avatarDataUrl || ""));
const userName = computed(() => String(data.profile.value.preferredName || data.profile.value.displayName || session.user.value?.displayName || "你"));
const userAvatar = computed(() => String(data.profile.value.avatarDataUrl || ""));

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
  if (historyOpen.value) {
    historyOpen.value = false;
    event.preventDefault();
    return;
  }
  if (emojiOpen.value) {
    emojiOpen.value = false;
    event.preventDefault();
  }
}

onMounted(async () => {
  document.addEventListener("pointerdown", closeEmojiOnOutsidePointer, true);
  window.addEventListener(NATIVE_BACK_EVENT, handleNativeBack);
  void prepareCompactEmojiPicker();
  await data.refreshConversationPage(true).catch(() => undefined);
  void data.loadRemainingConversations();
  if (data.conversations.value[0]) {
    await openConversation(data.conversations.value[0]).catch((cause) => {
      error.value = cause instanceof Error ? cause.message : "最新对话暂时没有打开。";
    });
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeEmojiOnOutsidePointer, true);
  window.removeEventListener(NATIVE_BACK_EVENT, handleNativeBack);
});

async function openConversation(conversation: Conversation) {
  const result = await session.requireApi().conversation(conversation.id);
  current.value = result.conversation;
  displayMessages.value = normalizeStoredDisplayMessages(result.displayMessages);
  historyOpen.value = false;
  await scrollToBottom();
}

watch(() => data.conversationRevision.value, async () => {
  if (!current.value) return;
  if (sending.value) {
    conversationRefreshPending = true;
    return;
  }
  const latest = data.conversations.value.find((item) => item.id === current.value?.id);
  if (!latest) {
    newConversation();
    return;
  }
  if ((latest.updatedAt || 0) <= (current.value.updatedAt || 0)) return;
  await openConversation(latest).catch(() => undefined);
});

function newConversation() {
  resolveAllApprovals(false);
  current.value = null;
  displayMessages.value = [];
  historyOpen.value = false;
}

async function send() {
  const content = draft.value.trim();
  if (!content || sending.value) return;
  emojiOpen.value = false;
  sending.value = true;
  error.value = "";
  draft.value = "";
  const optimistic: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
  displayMessages.value.push(optimistic);
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
    displayMessages.value = result.displayMessages;
    conversationRefreshPending = false;
    sending.value = false;
    await scrollToBottom();
  } catch (cause) {
    resolveAllApprovals(false);
    displayMessages.value = displayMessages.value.filter((message) => message !== optimistic);
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
  else displayMessages.value.push(activity);
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

async function scrollToBottom() {
  await nextTick();
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: "smooth" });
}
</script>

<template>
  <AppShell :title="assistantName" layout="focus" back-to="/home" headerless quiet>
    <div class="liquid-orb liquid-orb-pink" aria-hidden="true" />
    <div class="liquid-orb liquid-orb-blue" aria-hidden="true" />

    <nav class="chat-floating-controls" aria-label="聊天页面操作">
      <button class="liquid-control" type="button" aria-label="返回主页" @click="router.push('/home')">
        <ArrowLeft :size="20" />
      </button>
      <button class="liquid-control" type="button" aria-label="对话记录" @click="historyOpen = true">
        <History :size="20" />
      </button>
    </nav>

    <section ref="messageList" class="message-list">
      <EmptyState v-if="!displayMessages.length" :title="`和 ${assistantName} 说点什么`" description="新的对话会从第一句话开始，慢慢留下只属于你们的上下文。" />
      <template v-for="(message, index) in displayMessages" :key="message.id || index">
        <ChatActivity v-if="message.role === 'tool' || message.role === 'memory'" :message="message" @decide="decideTool(message, $event)" />
        <article v-else-if="message.role === 'assistant' || message.role === 'user'" class="message-row" :class="message.role">
          <ProfileAvatar v-if="message.role === 'assistant'" :name="assistantName" :src="assistantAvatar" size="small" />
          <div class="message-bubble">
            <MarkdownMessage v-if="message.role === 'assistant'" :content="message.content || ''" />
            <template v-else>{{ message.content }}</template>
          </div>
          <ProfileAvatar v-if="message.role === 'user'" :name="userName" :src="userAvatar" size="small" />
        </article>
      </template>
      <article v-if="sending" class="message-row assistant">
        <ProfileAvatar :name="assistantName" :src="assistantAvatar" size="small" />
        <div class="message-bubble typing"><i /><i /><i /></div>
      </article>
    </section>

    <template #bottom-dock>
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

    <Transition name="fade">
      <div v-if="historyOpen" class="history-backdrop" @click.self="historyOpen = false">
        <aside class="history-drawer">
          <header><div><span class="eyebrow">CONVERSATIONS</span><h2>对话记录</h2></div><button class="icon-button" @click="historyOpen = false"><X :size="18" /></button></header>
          <button class="new-chat" @click="newConversation"><Plus :size="18" /> 开始新对话</button>
          <div class="history-list">
            <button v-for="conversation in data.conversations.value" :key="conversation.id" :class="{ active: current?.id === conversation.id }" @click="openConversation(conversation)">
              <Menu :size="15" /><span>{{ conversation.title || '未命名对话' }}</span>
            </button>
            <p v-if="data.conversationPageLoading.value || data.conversationHasMore.value" class="history-loading">
              正在继续加载更早的对话…
            </p>
          </div>
        </aside>
      </div>
    </Transition>
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
.message-list { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding:calc(max(12px,env(safe-area-inset-top)) + 58px) 2px calc(var(--bottom-dock-height) + 34px); scrollbar-width: none; }
.message-list::-webkit-scrollbar { display: none; }
.message-row { display:flex; align-items:flex-end; gap:7px; margin:0 0 14px; }
.message-row.user { justify-content: flex-end; }
.message-row :deep(.avatar-small) { width:30px; height:30px; border-radius:50%; border-color:rgba(255,255,255,.82); box-shadow:0 7px 20px rgba(91,78,116,.16); }
.message-bubble { position:relative; max-width:min(82%,510px); overflow:hidden; padding:12px 14px; border:1px solid rgba(255,255,255,.7); border-radius:22px 22px 22px 7px; color:#4e495e; background:linear-gradient(145deg,rgba(255,255,255,.58),rgba(255,255,255,.28)); box-shadow:inset 0 1px 0 rgba(255,255,255,.86),inset 0 -1px 0 rgba(107,96,129,.06),0 12px 32px rgba(73,69,96,.09); backdrop-filter:blur(26px) saturate(165%); -webkit-backdrop-filter:blur(26px) saturate(165%); font-size: calc(13px * var(--font-scale, 1)); line-height:1.72; white-space:pre-wrap; overflow-wrap:anywhere; }
.message-bubble::before { content:""; position:absolute; z-index:-1; left:8%; right:18%; top:0; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent); }
.assistant .message-bubble { white-space: normal; }
.user .message-bubble { border-color:rgba(255,255,255,.36); border-radius:22px 22px 7px 22px; color:#fff; background:linear-gradient(135deg,rgba(204,126,171,.84),rgba(125,139,190,.82) 58%,rgba(91,159,211,.78)); box-shadow:inset 0 1px 0 rgba(255,255,255,.42),0 12px 30px rgba(115,96,151,.2); }
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
.history-backdrop { position:fixed;z-index:50;inset:0;display:flex;align-items:flex-end;background:rgba(42,39,59,.18);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px) }
.history-drawer { width:100%;height:min(76dvh,650px);padding:16px 19px calc(20px + env(safe-area-inset-bottom));border:1px solid rgba(255,255,255,.72);border-radius:32px 32px 0 0;background:linear-gradient(145deg,rgba(255,255,255,.83),rgba(247,247,253,.66));box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 -24px 70px rgba(62,57,88,.18);backdrop-filter:blur(34px) saturate(175%);-webkit-backdrop-filter:blur(34px) saturate(175%) }
.history-drawer::before { content:""; display:block; width:38px; height:4px; margin:0 auto 17px; border-radius:99px; background:rgba(100,92,119,.16); }
.history-drawer header{display:flex;align-items:center;justify-content:space-between}.history-drawer h2{margin:5px 0 0;font-size: calc(25px * var(--font-scale, 1));letter-spacing:-.05em}.new-chat{width:100%;height:48px;display:flex;align-items:center;justify-content:center;gap:8px;margin:25px 0 16px;border:0;border-radius:16px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size: calc(12px * var(--font-scale, 1));font-weight:700}.history-list{display:grid;gap:5px;max-height:calc(100dvh - 180px);overflow:auto}.history-list button{width:100%;min-height:48px;display:flex;align-items:center;gap:10px;padding:0 13px;border:0;border-radius:14px;color:#777183;background:transparent;text-align:left;font-size: calc(11px * var(--font-scale, 1))}.history-list button.active{color:#5e7398;background:linear-gradient(135deg,rgba(235,160,191,.14),rgba(126,188,239,.18))}.history-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-loading{margin:8px 0 2px;color:#9b95a5;font-size:calc(9px * var(--font-scale, 1));text-align:center}
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
