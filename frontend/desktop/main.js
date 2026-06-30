const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { XuanApiClient } = require("./api-client");

const appIcon = path.join(__dirname, "app-icon-rounded.png");
const api = new XuanApiClient({
  baseUrl: process.env.XUANAI_SERVER_URL || "http://127.0.0.1:4318",
  userId: process.env.XUANAI_USER_ID || "local-user"
});

function registerIpcHandlers() {
  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("ai:config:get", () => api.getAiConfig());
  ipcMain.handle("ai:config:save", (_event, input) =>
    api.saveAiConfig(input)
  );
  ipcMain.handle("ai:chat", (_event, payload) => api.requestAi(payload));

  ipcMain.handle("todos:list", (_event, filters) => api.listTodos(filters));
  ipcMain.handle("todos:get", (_event, id) => api.getTodo(id));
  ipcMain.handle("todos:create", (_event, todo) => api.createTodo(todo));
  ipcMain.handle("todos:update", (_event, id, changes) =>
    api.updateTodo(id, changes)
  );
  ipcMain.handle("todos:delete", (_event, id) => api.deleteTodo(id));
  ipcMain.handle("todos:clear-completed", () => api.clearCompletedTodos());

  ipcMain.handle("profile:get", () => api.getProfile());
  ipcMain.handle("profile:save", (_event, profile) => api.saveProfile(profile));
  ipcMain.handle("preferences:list", (_event, filters) =>
    api.listPreferences(filters)
  );
  ipcMain.handle("preferences:save", (_event, preference) =>
    api.savePreference(preference)
  );
  ipcMain.handle("preferences:delete", (_event, id) =>
    api.deletePreference(id)
  );
  ipcMain.handle("memories:list", (_event, filters) =>
    api.listMemories(filters)
  );
  ipcMain.handle("memories:create", (_event, memory) =>
    api.createMemory(memory)
  );
  ipcMain.handle("memories:update", (_event, id, changes) =>
    api.updateMemory(id, changes)
  );
  ipcMain.handle("memories:confirm", (_event, id) => api.confirmMemory(id));
  ipcMain.handle("memories:delete", (_event, id) => api.deleteMemory(id));
  ipcMain.handle("memories:recall", (_event, query) =>
    api.recallMemories(query)
  );
  ipcMain.handle("memories:extract", (_event, payload) =>
    api.extractMemories(payload)
  );
  ipcMain.handle("conversations:list", () => api.listConversations());
  ipcMain.handle("conversations:create", (_event, title) =>
    api.createConversation(title)
  );
  ipcMain.handle("conversations:get", (_event, id) => api.getConversation(id));
  ipcMain.handle("conversations:messages:save", (_event, id, messages) =>
    api.saveConversationMessages(id, messages)
  );
  ipcMain.handle("conversations:delete", (_event, id) =>
    api.deleteConversation(id)
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    icon: appIcon,
    frame: false,
    transparent: false,
    backgroundColor: "#f9f8ff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("home.html");
  win.once("ready-to-show", () => win.show());
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
