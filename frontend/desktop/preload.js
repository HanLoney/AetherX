const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
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
  listConversations: () => ipcRenderer.invoke("conversations:list"),
  createConversation: (title) =>
    ipcRenderer.invoke("conversations:create", title),
  getConversation: (id) => ipcRenderer.invoke("conversations:get", id),
  saveConversationMessages: (id, messages) =>
    ipcRenderer.invoke("conversations:messages:save", id, messages),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id)
});
