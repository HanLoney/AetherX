const state = {
  mode: "login",
  config: null,
  loading: false
};

const elements = {
  form: document.querySelector("#authForm"),
  formKicker: document.querySelector("#formKicker"),
  formTitle: document.querySelector("#formTitle"),
  formHint: document.querySelector("#formHint"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  serverUrl: document.querySelector("#serverUrl"),
  serverState: document.querySelector("#serverState"),
  displayNameField: document.querySelector("#displayNameField"),
  displayName: document.querySelector("#displayName"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  passwordHelp: document.querySelector("#passwordHelp"),
  registrationSecretField: document.querySelector("#registrationSecretField"),
  registrationSecret: document.querySelector("#registrationSecret"),
  migrationNotice: document.querySelector("#migrationNotice"),
  authError: document.querySelector("#authError"),
  submitBtn: document.querySelector("#submitBtn"),
  submitText: document.querySelector("#submitBtn span"),
  togglePassword: document.querySelector("#togglePassword")
};

function setMode(mode) {
  state.mode = mode;
  const registering = mode === "register";
  elements.loginTab.classList.toggle("active", !registering);
  elements.registerTab.classList.toggle("active", registering);
  elements.displayNameField.classList.toggle("hidden", !registering);
  elements.passwordHelp.classList.toggle("hidden", !registering);
  elements.registrationSecretField.classList.toggle(
    "hidden",
    !registering || !state.config?.requiresRegistrationSecret
  );
  elements.migrationNotice.classList.toggle(
    "hidden",
    !registering || !state.config?.firstUser
  );
  elements.formKicker.textContent = registering ? "CREATE YOUR SPACE" : "WELCOME BACK";
  elements.formTitle.textContent = registering ? "创建你的账号" : "欢迎回来";
  elements.formHint.textContent = registering
    ? "从这里开始，所有内容只属于你"
    : "登录后继续刚才的故事";
  elements.submitText.textContent = registering ? "创建并进入" : "进入 AetherX";
  elements.password.autocomplete = registering ? "new-password" : "current-password";
  hideError();
}

async function inspectServer() {
  const serverUrl = elements.serverUrl.value.trim();
  if (!/^https?:\/\//i.test(serverUrl)) {
    state.config = null;
    elements.serverState.className = "server-state failed";
    showError("服务器地址需要以 http:// 或 https:// 开头。");
    return false;
  }
  try {
    state.config = await window.desktop.getAuthConfig(serverUrl);
    elements.serverState.className = "server-state connected";
    elements.registerTab.disabled = !state.config.registrationAvailable;
    if (state.config.firstUser) setMode("register");
    else if (!state.config.registrationAvailable && state.mode === "register") setMode("login");
    else setMode(state.mode);
    return true;
  } catch (error) {
    state.config = null;
    elements.serverState.className = "server-state failed";
    elements.registerTab.disabled = true;
    showError(error.message || "连接不到这台服务器，请检查地址和服务状态。");
    return false;
  }
}

async function submit(event) {
  event.preventDefault();
  if (state.loading) return;
  hideError();
  if (!state.config && !(await inspectServer())) return;

  const input = {
    serverUrl: elements.serverUrl.value.trim(),
    username: elements.username.value.trim(),
    password: elements.password.value,
    displayName: elements.displayName.value.trim(),
    registrationSecret: elements.registrationSecret.value
  };
  if (!input.username || !input.password) {
    showError("把账号名和密码填完整再进去吧。");
    return;
  }

  setLoading(true);
  try {
    if (state.mode === "register") await window.desktop.register(input);
    else await window.desktop.login(input);
  } catch (error) {
    showError(error.message || "没有成功进入，请稍后再试。");
    setLoading(false);
  }
}

function setLoading(loading) {
  state.loading = loading;
  elements.submitBtn.disabled = loading;
  elements.submitText.textContent = loading
    ? state.mode === "register" ? "正在创建空间…" : "正在登录…"
    : state.mode === "register" ? "创建并进入" : "进入 AetherX";
}

function showError(message) {
  elements.authError.textContent = message;
  elements.authError.classList.remove("hidden");
}

function hideError() {
  elements.authError.classList.add("hidden");
  elements.authError.textContent = "";
}

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.registerTab.addEventListener("click", () => {
  if (!elements.registerTab.disabled) setMode("register");
});
elements.serverUrl.addEventListener("change", inspectServer);
elements.form.addEventListener("submit", submit);
elements.togglePassword.addEventListener("click", () => {
  const visible = elements.password.type === "text";
  elements.password.type = visible ? "password" : "text";
  elements.togglePassword.textContent = visible ? "显示" : "隐藏";
});
document.querySelector("#minimizeBtn").addEventListener("click", window.desktop.minimize);
document.querySelector("#maximizeBtn").addEventListener("click", window.desktop.maximize);
document.querySelector("#closeBtn").addEventListener("click", window.desktop.close);

async function initialize() {
  const auth = await window.desktop.getAuthState();
  elements.serverUrl.value = auth.serverUrl || "http://127.0.0.1:4318";
  if (auth.hasSession) {
    setLoading(true);
    try {
      const result = await window.desktop.bootstrapAuth();
      if (result.authenticated) return;
    } catch (error) {
      showError(error.message || "暂时连接不到服务器，请检查地址后重试。");
    } finally {
      setLoading(false);
    }
  }
  await inspectServer();
}

initialize().catch((error) => showError(error.message || "登录页面初始化失败。"));
