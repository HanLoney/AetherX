import { computed, readonly, ref } from "vue";
import type { Conversation, Memory, SyncChange, Todo } from "../lib/api";
import { SyncCoordinator } from "../lib/sync";
import { useSessionStore } from "./session";

const todos = ref<Todo[]>([]);
const memories = ref<Memory[]>([]);
const conversations = ref<Conversation[]>([]);
const profile = ref<Record<string, unknown>>({});
const assistant = ref<Record<string, unknown>>({});
const loading = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const conversationRevision = ref(0);
const syncState = ref<"idle" | "syncing" | "online" | "error">("idle");
let sync: SyncCoordinator | null = null;

async function refreshAll() {
  const api = useSessionStore().requireApi();
  loading.value = true;
  syncState.value = "syncing";
  try {
    const [todoResult, memoryResult, conversationResult, profileResult, assistantResult] = await Promise.all([
      api.listTodos(), api.listMemories(), api.listConversations(), api.profile(), api.assistantProfile()
    ]);
    todos.value = todoResult;
    memories.value = memoryResult;
    conversations.value = conversationResult;
    conversationRevision.value += 1;
    profile.value = profileResult;
    assistant.value = assistantResult;
    lastUpdatedAt.value = Date.now();
    syncState.value = "online";
  } catch (error) {
    syncState.value = "error";
    throw error;
  } finally {
    loading.value = false;
  }
}

async function refreshGroups(groups: Set<string>) {
  const api = useSessionStore().requireApi();
  const jobs: Promise<void>[] = [];
  if (groups.has("todos")) jobs.push(api.listTodos().then((value) => { todos.value = value; }));
  if (groups.has("memories")) jobs.push(api.listMemories().then((value) => { memories.value = value; }));
  if (groups.has("conversations")) jobs.push(api.listConversations().then((value) => {
    conversations.value = value;
    conversationRevision.value += 1;
  }));
  if (groups.has("profile")) jobs.push(api.profile().then((value) => { profile.value = value; }));
  if (groups.has("assistant")) jobs.push(api.assistantProfile().then((value) => { assistant.value = value; }));
  await Promise.all(jobs);
  lastUpdatedAt.value = Date.now();
  syncState.value = "online";
}

function changeGroups(changes: SyncChange[]) {
  const groups = new Set<string>();
  for (const change of changes) {
    const type = change.entityType;
    if (type === "todos") groups.add("todos");
    else if (["memories", "memory_evidence"].includes(type)) groups.add("memories");
    else if (["conversations", "messages"].includes(type)) groups.add("conversations");
    else if (type === "user_profiles") groups.add("profile");
    else if (["assistant_profiles", "assistant_personality_events", "shared_memories"].includes(type)) groups.add("assistant");
  }
  return groups;
}

async function startSync() {
  if (sync) return;
  const session = useSessionStore();
  const api = session.requireApi();
  const userId = session.user.value?.id;
  if (!userId) throw new Error("登录状态已经失效，请重新登录。");
  sync = new SyncCoordinator(api, async (changes) => {
    const groups = changeGroups(changes);
    if (groups.size) await refreshGroups(groups);
  }, `${api.serverUrl}|${userId}`);
  try {
    await sync.start();
    syncState.value = "online";
  } catch {
    syncState.value = "error";
  }
}

function stopSync() {
  sync?.stop();
  sync = null;
  todos.value = [];
  memories.value = [];
  conversations.value = [];
  profile.value = {};
  assistant.value = {};
  lastUpdatedAt.value = null;
  conversationRevision.value += 1;
  syncState.value = "idle";
}

window.addEventListener("aetherx:session-invalidated", stopSync);

async function toggleTodo(todo: Todo) {
  const updated = await useSessionStore().requireApi().updateTodo(todo.id, { completed: !todo.completed });
  todos.value = todos.value.map((item) => item.id === updated.id ? updated : item);
}

async function addTodo(input: { text: string; startAt: number; endAt: number }) {
  const created = await useSessionStore().requireApi().createTodo(input);
  todos.value = [...todos.value, created].sort((a, b) => a.startAt - b.startAt);
}

async function removeTodo(id: string) {
  await useSessionStore().requireApi().deleteTodo(id);
  todos.value = todos.value.filter((item) => item.id !== id);
}

async function confirmMemory(id: string) {
  const updated = await useSessionStore().requireApi().confirmMemory(id);
  memories.value = memories.value.map((item) => item.id === id ? updated : item);
}

async function removeMemory(id: string) {
  await useSessionStore().requireApi().deleteMemory(id);
  memories.value = memories.value.filter((item) => item.id !== id);
}

export function useDataStore() {
  return {
    todos: readonly(todos),
    memories: readonly(memories),
    conversations: readonly(conversations),
    profile: readonly(profile),
    assistant: readonly(assistant),
    loading: readonly(loading),
    lastUpdatedAt: readonly(lastUpdatedAt),
    conversationRevision: readonly(conversationRevision),
    syncState: readonly(syncState),
    activeTodos: computed(() => todos.value.filter((todo) => !todo.completed)),
    pendingMemories: computed(() => memories.value.filter((memory) => memory.status === "candidate")),
    refreshAll,
    startSync,
    stopSync,
    toggleTodo,
    addTodo,
    removeTodo,
    confirmMemory,
    removeMemory
  };
}
