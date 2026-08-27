const mode = process.argv[2];
const port = Number(process.argv[3] || 9224);

if (!mode) {
  throw new Error("Usage: node scripts/release-desktop-cdp.js <mode> [port]");
}

async function target() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json();
  const page = targets.find((entry) => entry.type === "page");
  if (!page) throw new Error("Electron debug page was not found.");
  return page;
}

async function connect() {
  const page = await target();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };
  return { socket, evaluate };
}

async function waitFor(evaluate, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

const { socket, evaluate } = await connect();
try {
  if (mode === "inspect") {
    console.log(JSON.stringify(await evaluate(`({
      title: document.title,
      url: location.href,
      text: document.body.innerText,
      inputs: [...document.querySelectorAll("input")].map((input) => ({
        id: input.id,
        type: input.type,
        value: input.value
      }))
    })`), null, 2));
  } else if (mode === "register") {
    const username = `release_user_${Date.now()}`;
    const password = `Release-${Date.now()}-Safe`;
    await evaluate(`(() => {
      const set = (id, value) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("displayName", "发布验收用户");
      set("username", ${JSON.stringify(username)});
      set("password", ${JSON.stringify(password)});
      document.getElementById("authForm").requestSubmit();
    })()`);
    await waitFor(evaluate, `location.href.endsWith("home.html")`, 20000);
    console.log(JSON.stringify({
      username,
      password,
      page: await evaluate(`({ title: document.title, url: location.href, text: document.body.innerText })`)
    }, null, 2));
  } else if (mode === "home") {
    console.log(JSON.stringify(await evaluate(`({
      title: document.title,
      url: location.href,
      text: document.body.innerText,
      buttons: [...document.querySelectorAll("button")].map((button) => ({ id: button.id, text: button.innerText, title: button.title })),
      inputs: [...document.querySelectorAll("input,textarea")].map((input) => ({ id: input.id, type: input.type, placeholder: input.placeholder, value: input.value }))
    })`), null, 2));
  } else if (mode === "api-smoke") {
    console.log(JSON.stringify(await evaluate(`(async () => {
      const conversations = await window.desktop.listConversations();
      const todo = await window.desktop.createTodo({
        text: "正式发布验收待办",
        startAt: new Date(Date.now() + 3600000).toISOString(),
        endAt: new Date(Date.now() + 7200000).toISOString()
      });
      const todoUpdated = await window.desktop.updateTodo(todo.id, { text: "正式发布验收待办-已编辑" });
      const memory = await window.desktop.createMemory({
        content: "正式发布验收记忆关键字 AETHERX_RELEASE_SMOKE",
        category: "fact",
        importance: 4,
        status: "confirmed"
      });
      const recalled = await window.desktop.recallMemories("AETHERX_RELEASE_SMOKE");
      let chatError = null;
      try {
        await window.desktop.agentChat({ message: "你好，这是正式发布验收。" });
      } catch (error) {
        chatError = error.message;
      }
      const todos = await window.desktop.listTodos({});
      const memories = await window.desktop.listMemories({});
      await window.desktop.deleteTodo(todo.id);
      return { conversations, todo, todoUpdated, memory, recalled, chatError, todos, memories };
    })()`), null, 2));
  } else if (mode === "persistence") {
    console.log(JSON.stringify(await evaluate(`(async () => ({
      auth: await window.desktop.getCurrentAuth(),
      conversations: await window.desktop.listConversations(),
      todos: await window.desktop.listTodos({}),
      memories: await window.desktop.listMemories({})
    }))()`), null, 2));
  } else if (mode === "profile-audit") {
    console.log(JSON.stringify(await evaluate(`(async () => ({
      auth: await window.desktop.getCurrentAuth(),
      userProfile: await window.desktop.getProfile(),
      assistantProfile: await window.desktop.getAssistantProfile(),
      prompt: await window.desktop.getPromptSettings(),
      memoryContext: await window.desktop.recallMemories("AETHERX_RELEASE_SMOKE")
    }))()`), null, 2));
  } else if (mode === "chat-ui") {
    console.log(JSON.stringify(await evaluate(`(async () => {
      const input = document.getElementById("messageInput");
      input.value = "你好，这是正式发布验收。";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("sendBtn").click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        text: document.body.innerText,
        settingsOpen: !document.getElementById("settingsModal")?.classList.contains("hidden"),
        conversations: await window.desktop.listConversations()
      };
    })()`), null, 2));
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} finally {
  socket.close();
}
