const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  showNotification: (notification) =>
    ipcRenderer.invoke("notification:show", notification),
  getAIConfig: () => ipcRenderer.invoke("ai:config:get"),
  saveAIConfig: (config) => ipcRenderer.invoke("ai:config:save", config),
  requestAI: (payload) => ipcRenderer.invoke("ai:chat", payload),
  listTodos: (filters) => ipcRenderer.invoke("todos:list", filters),
  getTodo: (id) => ipcRenderer.invoke("todos:get", id),
  createTodo: (todo) => ipcRenderer.invoke("todos:create", todo),
  updateTodo: (id, changes) => ipcRenderer.invoke("todos:update", id, changes),
  deleteTodo: (id) => ipcRenderer.invoke("todos:delete", id),
  clearCompletedTodos: () => ipcRenderer.invoke("todos:clear-completed"),
  getProfile: () => ipcRenderer.invoke("profile:get"),
  saveProfile: (profile) => ipcRenderer.invoke("profile:save", profile),
  updateProfile: (changes) => ipcRenderer.invoke("profile:update", changes),
  getAssistantProfile: () => ipcRenderer.invoke("assistant-profile:get"),
  updateAssistantProfile: (changes) =>
    ipcRenderer.invoke("assistant-profile:update", changes),
  listJournals: (filters) => ipcRenderer.invoke("journals:list", filters),
  getJournal: (type, periodKey) =>
    ipcRenderer.invoke("journals:get", type, periodKey),
  getJournalMaterial: (from, to) =>
    ipcRenderer.invoke("journals:material", from, to),
  saveJournal: (journal) => ipcRenderer.invoke("journals:save", journal),
  deleteJournal: (id) => ipcRenderer.invoke("journals:delete", id),
  listPersonalityEvents: (filters) =>
    ipcRenderer.invoke("personality-events:list", filters),
  createPersonalityEvent: (input) =>
    ipcRenderer.invoke("personality-events:create", input),
  deletePersonalityEvent: (id) =>
    ipcRenderer.invoke("personality-events:delete", id),
  confirmPersonalityEvent: (id) =>
    ipcRenderer.invoke("personality-events:confirm", id),
  listSharedMemories: (filters) =>
    ipcRenderer.invoke("shared-memories:list", filters),
  createSharedMemory: (input) =>
    ipcRenderer.invoke("shared-memories:create", input),
  deleteSharedMemory: (id) =>
    ipcRenderer.invoke("shared-memories:delete", id),
  confirmSharedMemory: (id) =>
    ipcRenderer.invoke("shared-memories:confirm", id),
  listPreferences: (filters) => ipcRenderer.invoke("preferences:list", filters),
  savePreference: (preference) =>
    ipcRenderer.invoke("preferences:save", preference),
  deletePreference: (id) => ipcRenderer.invoke("preferences:delete", id),
  listMemories: (filters) => ipcRenderer.invoke("memories:list", filters),
  createMemory: (memory) => ipcRenderer.invoke("memories:create", memory),
  updateMemory: (id, changes) =>
    ipcRenderer.invoke("memories:update", id, changes),
  confirmMemory: (id) => ipcRenderer.invoke("memories:confirm", id),
  deleteMemory: (id) => ipcRenderer.invoke("memories:delete", id),
  recallMemories: (query) => ipcRenderer.invoke("memories:recall", query),
  extractMemories: (payload) => ipcRenderer.invoke("memories:extract", payload),
  consolidateMemories: () => ipcRenderer.invoke("memories:consolidate"),
  getMemorySettings: () => ipcRenderer.invoke("memories:settings:get"),
  saveMemorySettings: (settings) =>
    ipcRenderer.invoke("memories:settings:save", settings),
  getPromptSettings: () => ipcRenderer.invoke("prompt-settings:get"),
  savePromptSettings: (settings) =>
    ipcRenderer.invoke("prompt-settings:save", settings),
  listPromptVersions: () => ipcRenderer.invoke("prompt-settings:versions"),
  restorePromptVersion: (version) =>
    ipcRenderer.invoke("prompt-settings:restore", version),
  getTimeAwarenessContext: (input) =>
    ipcRenderer.invoke("time-awareness:context", input),
  getXuanMoodHome: () => ipcRenderer.invoke("xuan-mood:home"),
  recordXuanMoodEvent: (input) => ipcRenderer.invoke("xuan-mood:event", input),
  refreshXuanMood: () => ipcRenderer.invoke("xuan-mood:refresh"),
  listAlbumMoments: (filters) =>
    ipcRenderer.invoke("album:moments:list", filters),
  createAlbumMoment: (input) =>
    ipcRenderer.invoke("album:moments:create", input),
  updateAlbumMoment: (id, changes) =>
    ipcRenderer.invoke("album:moments:update", id, changes),
  hideAlbumMoment: (id) => ipcRenderer.invoke("album:moments:hide", id),
  addAlbumMomentSource: (id, source) =>
    ipcRenderer.invoke("album:sources:add", id, source),
  listAlbumSourceCandidates: (filters) =>
    ipcRenderer.invoke("album:sources:candidates", filters),
  listConversations: () => ipcRenderer.invoke("conversations:list"),
  createConversation: (title) =>
    ipcRenderer.invoke("conversations:create", title),
  getConversation: (id) => ipcRenderer.invoke("conversations:get", id),
  saveConversationMessages: (id, messages) =>
    ipcRenderer.invoke("conversations:messages:save", id, messages),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id)
});
