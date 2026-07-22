const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  getStatus: () => ipcRenderer.invoke("launcher:status:get"),
  runAction: (action) => ipcRenderer.invoke("launcher:action", action),
  openFolder: (kind) => ipcRenderer.invoke("launcher:folder:open", kind),
  onStatus: (callback) => subscribe("launcher:status", callback),
  onProgress: (callback) => subscribe("launcher:progress", callback),
  onBusy: (callback) => subscribe("launcher:busy", callback)
});

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
