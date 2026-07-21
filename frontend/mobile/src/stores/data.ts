import { computed, readonly, ref } from "vue";
import type { Conversation, GalleryImage, Journal, Memory, SyncChange, Todo } from "../lib/api";
import { SyncCoordinator } from "../lib/sync";
import { useSessionStore } from "./session";

const todos = ref<Todo[]>([]);
const memories = ref<Memory[]>([]);
const conversations = ref<Conversation[]>([]);
const profile = ref<Record<string, unknown>>({});
const assistant = ref<Record<string, unknown>>({});
const galleryImages = ref<GalleryImage[]>([]);
const galleryTotal = ref(0);
const journals = ref<Journal[]>([]);
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
    const [todoResult, memoryResult, conversationResult, profileResult, assistantResult, galleryResult, journalResult] = await Promise.all([
      api.listTodos(),
      api.listMemories(),
      api.listConversations(),
      api.profile(),
      api.assistantProfile(),
      api.gallerySummary(3).catch(() => ({ total: 0, items: [] })),
      api.listJournals(50).catch(() => [])
    ]);
    todos.value = todoResult;
    memories.value = memoryResult;
    conversations.value = conversationResult;
    conversationRevision.value += 1;
    profile.value = profileResult;
    assistant.value = assistantResult;
    galleryImages.value = galleryResult.items;
    galleryTotal.value = galleryResult.total;
    journals.value = journalResult;
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
  if (groups.has("gallery")) jobs.push(api.gallerySummary(3).then((value) => {
    galleryImages.value = value.items;
    galleryTotal.value = value.total;
  }));
  if (groups.has("journals")) jobs.push(api.listJournals(50).then((value) => {
    journals.value = value;
  }));
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
    else if (type === "conversations") groups.add("conversations");
    else if (type === "messages") {
      groups.add("conversations");
      groups.add("gallery");
    }
    else if (type === "user_profiles") groups.add("profile");
    else if (["assistant_profiles", "assistant_personality_events", "shared_memories"].includes(type)) groups.add("assistant");
    else if (["assistant_journals", "assistant_journals_v2"].includes(type)) {
      groups.add("gallery");
      groups.add("journals");
    }
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
  galleryImages.value = [];
  galleryTotal.value = 0;
  journals.value = [];
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

async function updateProfile(input: Record<string, unknown>) {
  profile.value = await useSessionStore().requireApi().updateProfile(input);
  lastUpdatedAt.value = Date.now();
}

async function updateAssistantProfile(input: Record<string, unknown>) {
  assistant.value = await useSessionStore().requireApi().updateAssistantProfile(input);
  lastUpdatedAt.value = Date.now();
}

export function useDataStore() {
  return {
    todos: readonly(todos),
    memories: readonly(memories),
    conversations: readonly(conversations),
    profile: readonly(profile),
    assistant: readonly(assistant),
    galleryImages: readonly(galleryImages),
    galleryTotal: readonly(galleryTotal),
    journals: readonly(journals),
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
    removeMemory,
    updateProfile,
    updateAssistantProfile
  };
}
