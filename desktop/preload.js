const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  getAIConfig: () => ipcRenderer.invoke("ai:config:get"),
  saveAIConfig: (config) => ipcRenderer.invoke("ai:config:save", config),
  requestAI: (payload) => ipcRenderer.invoke("ai:chat", payload)
});
