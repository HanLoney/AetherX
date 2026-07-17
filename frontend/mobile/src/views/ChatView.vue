<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { History, Menu, Plus, SendHorizontal, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import ChatActivity from "../components/ChatActivity.vue";
import EmptyState from "../components/EmptyState.vue";
import MarkdownMessage from "../components/MarkdownMessage.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { normalizeStoredDisplayMessages } from "../lib/chat-history";
import { MobileChat } from "../lib/hub-chat";
import type { ChatMessage, Conversation } from "../lib/api";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";

const data = useDataStore();
const session = useSessionStore();
const current = ref<Conversation | null>(null);
const displayMessages = ref<ChatMessage[]>([]);
const draft = ref("");
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

onMounted(async () => {
  if (!data.conversations.value.length) await data.refreshAll().catch(() => undefined);
  if (data.conversations.value[0]) await openConversation(data.conversations.value[0]);
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
    if (result.toolMutated) await data.refreshAll().catch(() => undefined);
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
      if (latest) await openConversation(latest).catch(() => undefined);
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
  <AppShell :title="assistantName" kicker="此刻，只聊你想聊的" quiet>
    <template #header>
      <button class="icon-button" aria-label="对话记录" @click="historyOpen = true"><History :size="19" /></button>
    </template>

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

    <p v-if="error" class="chat-error">{{ error }}</p>
    <form class="chat-composer" @submit.prevent="send">
      <textarea v-model="draft" rows="1" :placeholder="`给 ${assistantName} 发消息…`" @keydown.enter.exact.prevent="send" />
      <button type="submit" :disabled="!draft.trim() || sending" aria-label="发送"><SendHorizontal :size="20" /></button>
    </form>

    <Transition name="fade">
      <div v-if="historyOpen" class="history-backdrop" @click.self="historyOpen = false">
        <aside class="history-drawer">
          <header><div><span class="eyebrow">CONVERSATIONS</span><h2>对话记录</h2></div><button class="icon-button" @click="historyOpen = false"><X :size="18" /></button></header>
          <button class="new-chat" @click="newConversation"><Plus :size="18" /> 开始新对话</button>
          <div class="history-list">
            <button v-for="conversation in data.conversations.value" :key="conversation.id" :class="{ active: current?.id === conversation.id }" @click="openConversation(conversation)">
              <Menu :size="15" /><span>{{ conversation.title || '未命名对话' }}</span>
            </button>
          </div>
        </aside>
      </div>
    </Transition>
  </AppShell>
</template>

<style scoped>
:deep(.page-content) { height: calc(100dvh - 160px - env(safe-area-inset-top)); }
.message-list { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 14px 0 122px; scrollbar-width: none; }
.message-list::-webkit-scrollbar { display: none; }
.message-row { display: flex; align-items: flex-end; gap: 9px; margin: 0 0 18px; }
.message-row.user { justify-content: flex-end; }
.message-bubble { max-width: min(78%, 510px); padding: 13px 15px; border: 1px solid var(--line); border-radius: 8px 19px 19px 19px; color: #4e495e; background: rgba(255,255,255,.76); box-shadow: 0 10px 28px rgba(73,69,96,.07); font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant .message-bubble { white-space: normal; }
.user .message-bubble { border: 0; border-radius: 19px 8px 19px 19px; color: #fff; background: linear-gradient(135deg,#cf8bad,#8e95c3 58%,#77a9d1); box-shadow: 0 11px 28px rgba(130,111,160,.18); }
.typing { display:flex; gap:5px; padding:17px 18px; }.typing i{width:5px;height:5px;border-radius:50%;background:#aaa3b5;animation:pulse 1.2s infinite}.typing i:nth-child(2){animation-delay:.18s}.typing i:nth-child(3){animation-delay:.36s}@keyframes pulse{0%,70%,100%{opacity:.35;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
.chat-composer { position: fixed; z-index: 25; left: 50%; bottom: calc(var(--nav-height) + 26px + env(safe-area-inset-bottom)); width: min(calc(100% - 34px), 650px); min-height: 62px; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; padding: 8px 8px 8px 17px; border: 1px solid rgba(255,255,255,.85); border-radius: 22px; background: rgba(255,255,255,.82); box-shadow: 0 16px 42px rgba(75,70,103,.14); backdrop-filter: blur(24px); }
.chat-composer textarea { min-width:0; max-height:100px; flex:1; resize:none; border:0; outline:0; color:var(--ink); background:transparent; font-size:13px; line-height:1.55; }
.chat-composer button { width:46px;height:46px;display:grid;place-items:center;flex:0 0 auto;border:0;border-radius:16px;color:#fff;background:linear-gradient(135deg,#cf8bad,#79a9d2);box-shadow:0 9px 22px rgba(133,111,160,.22)}.chat-composer button:disabled{opacity:.4}
.chat-error { position:fixed;z-index:26;left:50%;bottom:calc(var(--nav-height) + 94px + env(safe-area-inset-bottom));width:min(calc(100% - 42px),620px);transform:translateX(-50%);padding:9px 12px;border-radius:12px;color:#b95770;background:rgba(255,241,246,.95);font-size:10px;text-align:center;box-shadow:0 8px 24px rgba(95,70,90,.1)}
.history-backdrop { position:fixed;z-index:50;inset:0;display:flex;justify-content:flex-end;background:rgba(42,39,59,.22);backdrop-filter:blur(5px) }
.history-drawer { width:min(88%,380px);height:100%;padding:max(30px,env(safe-area-inset-top)) 19px calc(20px + env(safe-area-inset-bottom));background:rgba(251,250,253,.96);box-shadow:-20px 0 60px rgba(62,57,88,.18) }
.history-drawer header{display:flex;align-items:center;justify-content:space-between}.history-drawer h2{margin:5px 0 0;font-size:25px;letter-spacing:-.05em}.new-chat{width:100%;height:48px;display:flex;align-items:center;justify-content:center;gap:8px;margin:25px 0 16px;border:0;border-radius:16px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size:12px;font-weight:700}.history-list{display:grid;gap:5px;max-height:calc(100dvh - 180px);overflow:auto}.history-list button{width:100%;min-height:48px;display:flex;align-items:center;gap:10px;padding:0 13px;border:0;border-radius:14px;color:#777183;background:transparent;text-align:left;font-size:11px}.history-list button.active{color:#5e7398;background:linear-gradient(135deg,rgba(235,160,191,.14),rgba(126,188,239,.18))}.history-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
