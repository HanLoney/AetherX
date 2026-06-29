const { app, BrowserWindow, ipcMain, net, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const appIcon = path.join(__dirname, "app-icon-rounded.png");
const CONFIG_FILE = "ai-connection.json";

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {
      providerId: "openai",
      providerName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
      encryptedApiKey: ""
    };
  }
}

function decryptApiKey(config) {
  if (!config.encryptedApiKey) return "";
  try {
    const buffer = Buffer.from(config.encryptedApiKey, "base64");
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function publicConfig(config = readStoredConfig()) {
  return {
    providerId: config.providerId || "custom",
    providerName: config.providerName || "自定义",
    baseUrl: config.baseUrl || "",
    model: config.model || "",
    hasApiKey: Boolean(decryptApiKey(config))
  };
}

function normalizeConfig(input) {
  const baseUrl = String(input?.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(input?.model || "").trim();
  if (!baseUrl) throw new Error("请填写 API 端点");
  if (!model) throw new Error("请填写模型名称");

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("API 端点格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("API 端点仅支持 http:// 或 https://");
  }
  if (url.username || url.password) {
    throw new Error("API 端点不能包含用户名或密码");
  }

  return {
    providerId: String(input?.providerId || "custom").slice(0, 60),
    providerName: String(input?.providerName || "自定义").slice(0, 80),
    baseUrl,
    model: model.slice(0, 200)
  };
}

function chatUrl(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`;
}

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

  ipcMain.handle("ai:config:get", () => publicConfig());

  ipcMain.handle("ai:config:save", (_event, input) => {
    const normalized = normalizeConfig(input);
    const current = readStoredConfig();
    const providedKey = String(input?.apiKey || "").trim();
    const sameConnection =
      normalized.providerId === current.providerId &&
      normalized.baseUrl === current.baseUrl;
    let encryptedApiKey = sameConnection ? current.encryptedApiKey || "" : "";

    if (providedKey) {
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(providedKey)
        : Buffer.from(providedKey, "utf8");
      encryptedApiKey = encrypted.toString("base64");
    }

    const stored = { ...normalized, encryptedApiKey };
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(stored, null, 2), "utf8");
    return publicConfig(stored);
  });

  ipcMain.handle("ai:chat", async (_event, payload) => {
    const normalized = normalizeConfig(payload);
    const stored = readStoredConfig();
    const matchesStoredConnection =
      normalized.providerId === stored.providerId &&
      normalized.baseUrl === stored.baseUrl &&
      normalized.model === stored.model;
    const apiKey =
      String(payload?.apiKey || "").trim() ||
      (matchesStoredConnection ? decryptApiKey(stored) : "");
    if (!apiKey) throw new Error("请填写 API Key");

    const messages = Array.isArray(payload?.messages)
      ? payload.messages.slice(-60).map((message) => {
          const role = ["system", "user", "assistant", "tool"].includes(message?.role)
            ? message.role
            : "user";
          const sanitized = {
            role,
            content:
              message?.content === null
                ? null
                : String(message?.content || "").slice(0, 30000)
          };
          if (role === "assistant" && Array.isArray(message?.tool_calls)) {
            sanitized.tool_calls = message.tool_calls.slice(0, 10).map((call) => ({
              id: String(call?.id || "").slice(0, 200),
              type: "function",
              function: {
                name: String(call?.function?.name || "").slice(0, 100),
                arguments: String(call?.function?.arguments || "{}").slice(0, 20000)
              }
            }));
          }
          if (role === "tool") {
            sanitized.tool_call_id = String(message?.tool_call_id || "").slice(0, 200);
          }
          return sanitized;
        })
      : [];
    if (!messages.length) throw new Error("消息不能为空");

    const tools = Array.isArray(payload?.tools)
      ? payload.tools.slice(0, 40).map((tool) => ({
          type: "function",
          function: {
            name: String(tool?.function?.name || "").slice(0, 100),
            description: String(tool?.function?.description || "").slice(0, 1000),
            parameters:
              tool?.function?.parameters &&
              typeof tool.function.parameters === "object"
                ? tool.function.parameters
                : { type: "object", properties: {} }
          }
        }))
      : [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await net.fetch(chatUrl(normalized.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: normalized.model,
          messages,
          ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          stream: false
        }),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text || `HTTP ${response.status}` } };
      }
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("请求超时，请稍后重试");
      throw new Error(error?.message || "网络请求失败");
    } finally {
      clearTimeout(timer);
    }
  });
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
