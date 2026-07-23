const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  getStatus: () => ipcRenderer.invoke("launcher:status:get"),
  runAction: (action) => invokeAction(action),
  generateQr: (value) => ipcRenderer.invoke("launcher:qr:create", value),
  copyText: (value) => ipcRenderer.invoke("launcher:clipboard:write", value),
  openFolder: (kind) => ipcRenderer.invoke("launcher:folder:open", kind),
  onStatus: (callback) => subscribe("launcher:status", callback),
  onProgress: (callback) => subscribe("launcher:progress", callback),
  onBusy: (callback) => subscribe("launcher:busy", callback)
});

async function invokeAction(action) {
  try {
    return await ipcRenderer.invoke("launcher:action", action);
  } catch (error) {
    const message = String(error?.message || error || "操作失败").replace(
      /^Error invoking remote method 'launcher:action': Error:\s*/,
      ""
    );
    throw new Error(message);
  }
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
