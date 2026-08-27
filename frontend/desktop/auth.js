const state = {
  mode: "login",
  config: null,
  loading: false,
  scanning: false,
  qrLogin: null,
  qrPollTimer: 0,
  qrCountdownTimer: 0,
  cloudEdition: false,
  pendingEmail: "",
  pendingPassword: "",
  passwordResetActive: false,
  hub: {
    computer: "checking",
    mobile: "searching",
    target: "unknown"
  }
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
  loginIdentifierLabel: document.querySelector("#loginIdentifierLabel"),
  advancedServer: document.querySelector("#advancedServer"),
  password: document.querySelector("#password"),
  passwordHelp: document.querySelector("#passwordHelp"),
  registrationSecretField: document.querySelector("#registrationSecretField"),
  registrationSecret: document.querySelector("#registrationSecret"),
  migrationNotice: document.querySelector("#migrationNotice"),
  authError: document.querySelector("#authError"),
  submitBtn: document.querySelector("#submitBtn"),
  submitText: document.querySelector("#submitBtn span"),
  togglePassword: document.querySelector("#togglePassword"),
  hubRoutePanel: document.querySelector("#hubRoutePanel"),
  computerHubNode: document.querySelector("#computerHubNode"),
  computerHubState: document.querySelector("#computerHubState"),
  mobileHubNode: document.querySelector("#mobileHubNode"),
  mobileHubState: document.querySelector("#mobileHubState"),
  hubRouteLink: document.querySelector("#hubRouteLink"),
  hubRouteSummary: document.querySelector("#hubRouteSummary"),
  scanHubBtn: document.querySelector("#scanHubBtn"),
  qrLoginPanel: document.querySelector("#qrLoginPanel"),
  qrLoginImage: document.querySelector("#qrLoginImage"),
  qrLoginStatus: document.querySelector("#qrLoginStatus"),
  qrLoginCountdown: document.querySelector("#qrLoginCountdown"),
  refreshQrLoginBtn: document.querySelector("#refreshQrLoginBtn"),
  passwordLoginDivider: document.querySelector("#passwordLoginDivider"),
  emailVerificationPanel: document.querySelector("#emailVerificationPanel"),
  emailVerificationMessage: document.querySelector("#emailVerificationMessage"),
  emailVerificationToken: document.querySelector("#emailVerificationToken"),
  verifyEmailBtn: document.querySelector("#verifyEmailBtn"),
  resendEmailBtn: document.querySelector("#resendEmailBtn"),
  verificationLoginBtn: document.querySelector("#verificationLoginBtn"),
  forgotPasswordBtn: document.querySelector("#forgotPasswordBtn"),
  passwordResetPanel: document.querySelector("#passwordResetPanel"),
  passwordResetMessage: document.querySelector("#passwordResetMessage"),
  passwordResetToken: document.querySelector("#passwordResetToken"),
  passwordResetNewPassword: document.querySelector("#passwordResetNewPassword"),
  completePasswordResetBtn: document.querySelector("#completePasswordResetBtn"),
  cancelPasswordResetBtn: document.querySelector("#cancelPasswordResetBtn")
};

function usesEmailIdentity() {
  return state.config?.loginIdentifier === "email";
}

function applyIdentityMode() {
  const email = usesEmailIdentity();
  document.body.classList.toggle("cloud-auth", email);
  elements.loginIdentifierLabel.textContent = email ? "邮箱" : "账号名";
  elements.username.type = email ? "email" : "text";
  elements.username.autocomplete = email ? "email" : "username";
  elements.username.placeholder = email ? "输入邮箱地址" : "输入账号名";
  elements.hubRoutePanel.classList.toggle("hidden", email);
  elements.qrLoginPanel.classList.toggle("hidden", email || state.mode === "register");
  elements.passwordLoginDivider.classList.toggle("hidden", email || state.mode === "register");
  if (state.cloudEdition) elements.advancedServer.classList.add("hidden");
  elements.forgotPasswordBtn.classList.toggle(
    "hidden",
    !email || state.mode !== "login" || state.passwordResetActive
  );
}

const hubStateText = {
  checking: "正在检查…",
  ready: "已在线",
  online: "已在线",
  searching: "正在搜索…",
  discovered: "已发现，待验证",
  verifying: "正在验证身份…",
  verified: "身份已验证",
  connecting: "正在连接…",
  connected: "已连接",
  offline: "暂未启动",
  notFound: "未发现，可稍后连接",
  failed: "连接异常",
  skipped: "未连接，可稍后连接"
};

function setHubNode(node, label, status) {
  if (!node) return;
  node.className = `hub-node ${status}`;
  label.textContent = hubStateText[status] || status;
}

function setHubSummary(message, tone = "") {
  elements.hubRouteSummary.textContent = message;
  elements.hubRoutePanel.classList.toggle("is-alert", tone === "alert");
}

function renderHubDiscovery(discovery) {
  if (!discovery) return;
  const computer = discovery.computerHub || {};
  const mobile = discovery.mobileHub || {};
  state.hub.target = discovery.activeTarget || "unknown";
  state.hub.computer = computer.state || "offline";
  state.hub.mobile = mobile.state || "searching";

  setHubNode(elements.computerHubNode, elements.computerHubState, state.hub.computer);
  setHubNode(elements.mobileHubNode, elements.mobileHubState, state.hub.mobile);
  if (mobile.endpoint && ["discovered", "online", "connected"].includes(state.hub.mobile)) {
    const latency = state.hub.mobile === "online" && Number.isFinite(Number(mobile.latencyMs))
      ? ` · ${Number(mobile.latencyMs)} ms`
      : "";
    elements.mobileHubState.textContent = `${hubStateText[state.hub.mobile]} ${mobile.endpoint.replace(/^https?:\/\//, "")}${latency}`;
  }
  elements.hubRouteLink.className = `hub-route-link ${
    ["discovered", "online", "connected"].includes(state.hub.mobile) ? "ready" : "searching"
  }`;

  if (state.hub.computer === "offline") {
    setHubSummary("电脑 Hub 尚未在线，请稍候或重新启动 AetherX。", "alert");
  } else if (state.hub.mobile === "discovered") {
    setHubSummary("已收到手机 Hub 广播，正在等待连接验证；仍可先通过电脑 Hub 登录。");
  } else if (state.hub.mobile === "online") {
    setHubSummary("手机 Hub 已在线，登录后会根据当前活动 Hub 自动接入。");
  } else if (state.hub.mobile === "notFound") {
    setHubSummary("暂未发现手机 Hub，将先通过电脑 Hub 登录，手机上线后会自动连接。");
  } else {
    setHubSummary("会先通过电脑 Hub 验证账号；手机 Hub 未发现也不影响登录，可稍后自动连接。");
  }
}

function renderHubProgress(progress = {}) {
  if (progress.stage === "checking") {
    setHubNode(elements.computerHubNode, elements.computerHubState, "checking");
    setHubNode(elements.mobileHubNode, elements.mobileHubState, "searching");
    elements.hubRouteLink.className = "hub-route-link searching";
    setHubSummary(progress.message || "正在读取双 Hub 状态…");
    return;
  }
  if (progress.target === "mobile") {
    if (progress.stage === "searching") setHubNode(elements.mobileHubNode, elements.mobileHubState, "searching");
    if (progress.stage === "not-found") setHubNode(elements.mobileHubNode, elements.mobileHubState, "notFound");
    if (progress.stage === "verifying") setHubNode(elements.mobileHubNode, elements.mobileHubState, "verifying");
    if (progress.stage === "verified") setHubNode(elements.mobileHubNode, elements.mobileHubState, "verified");
    if (progress.stage === "routing") setHubNode(elements.mobileHubNode, elements.mobileHubState, "connecting");
    if (progress.stage === "connected") setHubNode(elements.mobileHubNode, elements.mobileHubState, "connected");
    elements.hubRouteLink.className = `hub-route-link ${
      ["verifying", "verified", "routing"].includes(progress.stage) ? "active" : "ready"
    }`;
  }
  if (progress.target === "computer" && progress.stage === "connected") {
    setHubNode(elements.computerHubNode, elements.computerHubState, "connected");
    if (progress.pendingTarget === "mobile") {
      setHubNode(elements.mobileHubNode, elements.mobileHubState, "skipped");
    }
    elements.hubRouteLink.className = "hub-route-link ready";
  }
  if (progress.stage === "failed") {
    const target = progress.target === "computer" ? elements.computerHubNode : elements.mobileHubNode;
    const label = progress.target === "computer" ? elements.computerHubState : elements.mobileHubState;
    setHubNode(target, label, "failed");
    elements.hubRouteLink.className = "hub-route-link failed";
    setHubSummary(progress.message || "Hub 连接失败，请检查设备状态后重试。", "alert");
    return;
  }
  if (progress.message) {
    setHubSummary(progress.message);
  }
}

async function scanHubs() {
  if (state.cloudEdition || usesEmailIdentity()) return;
  if (state.scanning || state.loading) return;
  state.scanning = true;
  elements.scanHubBtn.disabled = true;
  renderHubProgress({ stage: "checking", message: "正在检查电脑 Hub，并搜索手机 Hub…" });
  try {
    const discovery = await window.desktop.getAuthHubDiscovery({ wait: true });
    renderHubDiscovery(discovery);
  } catch (error) {
    setHubNode(elements.mobileHubNode, elements.mobileHubState, "failed");
    setHubSummary(error.message || "无法完成 Hub 搜索，请稍后重试。", "alert");
  } finally {
    state.scanning = false;
    elements.scanHubBtn.disabled = false;
  }
}

function setMode(mode) {
  state.mode = mode;
  state.passwordResetActive = false;
  elements.passwordResetPanel.classList.add("hidden");
  elements.submitBtn.classList.remove("hidden");
  const registering = mode === "register";
  document.body.classList.toggle("register-mode", registering);
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
  elements.qrLoginPanel.classList.toggle("hidden", registering);
  elements.passwordLoginDivider.classList.toggle("hidden", registering);
  applyIdentityMode();
  if (!usesEmailIdentity() && !registering && (!state.qrLogin || state.qrLogin.expiresAt <= Date.now())) {
    createQrLogin().catch(() => undefined);
  }
  hideError();
}

function stopQrLoginTimers() {
  window.clearTimeout(state.qrPollTimer);
  window.clearInterval(state.qrCountdownTimer);
  state.qrPollTimer = 0;
  state.qrCountdownTimer = 0;
}

function updateQrCountdown() {
  if (!state.qrLogin) return;
  const seconds = Math.max(0, Math.ceil((state.qrLogin.expiresAt - Date.now()) / 1000));
  elements.qrLoginCountdown.textContent = `${seconds}s`;
  if (seconds === 0) {
    stopQrLoginTimers();
    elements.qrLoginStatus.textContent = "二维码已过期，请重新生成";
  }
}

async function pollQrLogin() {
  if (!state.qrLogin || state.mode !== "login") return;
  const challenge = state.qrLogin;
  try {
    const result = await window.desktop.pollDesktopQrLogin({
      id: challenge.id,
      secret: challenge.secret
    });
    if (state.qrLogin !== challenge) return;
    if (result.status === "pending") {
      state.qrPollTimer = window.setTimeout(pollQrLogin, 1200);
      return;
    }
    stopQrLoginTimers();
    elements.qrLoginStatus.textContent = "手机已确认，正在连接活动 Hub…";
  } catch (error) {
    if (state.qrLogin !== challenge) return;
    stopQrLoginTimers();
    elements.qrLoginStatus.textContent = error.message || "扫码登录失败，请重新生成";
  }
}

async function createQrLogin() {
  if (state.cloudEdition || usesEmailIdentity()) return;
  stopQrLoginTimers();
  elements.refreshQrLoginBtn.disabled = true;
  elements.qrLoginStatus.textContent = "正在生成一次性登录码…";
  elements.qrLoginImage.removeAttribute("src");
  elements.qrLoginCountdown.textContent = "--";
  try {
    state.qrLogin = await window.desktop.createDesktopQrLogin();
    elements.qrLoginImage.src = state.qrLogin.qrDataUrl;
    elements.qrLoginStatus.textContent = "打开手机端连接设置，扫描此二维码";
    updateQrCountdown();
    state.qrCountdownTimer = window.setInterval(updateQrCountdown, 1000);
    state.qrPollTimer = window.setTimeout(pollQrLogin, 600);
  } catch (error) {
    state.qrLogin = null;
    elements.qrLoginStatus.textContent = error.message || "暂时无法生成扫码登录二维码";
  } finally {
    elements.refreshQrLoginBtn.disabled = false;
  }
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
    applyIdentityMode();
    if (state.config.serverUrl && state.config.serverUrl !== serverUrl) {
      elements.serverUrl.value = state.config.serverUrl;
    }
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
    password: elements.password.value,
    displayName: elements.displayName.value.trim(),
    registrationSecret: elements.registrationSecret.value,
    ...(usesEmailIdentity()
      ? { email: elements.username.value.trim() }
      : { username: elements.username.value.trim() })
  };
  if (!(input.email || input.username) || !input.password) {
    showError(usesEmailIdentity()
      ? "把邮箱和密码填完整再进去吧。"
      : "把账号名和密码填完整再进去吧。");
    return;
  }

  setLoading(true);
  try {
    if (state.mode === "register") {
      const result = await window.desktop.register(input);
      if (result?.verificationRequired) {
        if (usesEmailIdentity()) {
          try {
            await window.desktop.login(input);
            return;
          } catch {
            // A new or unverified account continues through the neutral verification flow.
          }
        }
        state.pendingEmail = input.email;
        state.pendingPassword = input.password;
        elements.emailVerificationMessage.textContent =
          "新账号：请查收验证邮件并粘贴令牌。\n已有账号：无需再次验证，直接返回登录。";
        elements.emailVerificationPanel.classList.remove("hidden");
        setLoading(false);
      }
    } else {
      await window.desktop.login(input);
    }
  } catch (error) {
    showError(error.message || "没有成功进入，请稍后再试。");
    setLoading(false);
  }
}

function setLoading(loading) {
  state.loading = loading;
  elements.submitBtn.disabled = loading;
  elements.scanHubBtn.disabled = loading || state.scanning;
  elements.refreshQrLoginBtn.disabled = loading;
  elements.submitText.textContent = loading
    ? state.mode === "register" ? "正在创建空间…" : "正在登录…"
    : state.mode === "register" ? "创建并进入" : "进入 AetherX";
}

function extractVerificationToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).searchParams.get("token") || raw;
  } catch {
    return raw;
  }
}

async function verifyEmail() {
  const token = extractVerificationToken(elements.emailVerificationToken.value);
  if (!token) {
    showError("请粘贴验证邮件中的链接或令牌。");
    return;
  }
  hideError();
  setLoading(true);
  try {
    await window.desktop.verifyEmail({ token });
  } catch (error) {
    showError(error.message || "邮箱验证没有成功，请重新发送后再试。");
    setLoading(false);
  }
}

async function resendEmailVerification() {
  if (!state.pendingEmail || !state.pendingPassword) {
    showError("请先填写邮箱和密码，再重新发送验证邮件。");
    return;
  }
  hideError();
  elements.resendEmailBtn.disabled = true;
  try {
    await window.desktop.resendEmailVerification({
      email: state.pendingEmail,
      password: state.pendingPassword
    });
    elements.emailVerificationMessage.textContent =
      "尚未验证：凭据正确时会发送新的验证邮件。\n已经验证：无需再次收信，直接返回登录。";
  } catch (error) {
    showError(error.message || "验证邮件暂时没有发送成功。");
  } finally {
    elements.resendEmailBtn.disabled = false;
  }
}

function returnToEmailLogin() {
  state.pendingEmail = "";
  state.pendingPassword = "";
  elements.emailVerificationToken.value = "";
  elements.emailVerificationPanel.classList.add("hidden");
  hideError();
  setMode("login");
}

async function requestPasswordReset() {
  const email = elements.username.value.trim();
  if (!email) {
    showError("请先填写需要找回的邮箱。");
    return;
  }
  hideError();
  elements.forgotPasswordBtn.disabled = true;
  try {
    await window.desktop.requestPasswordReset({ email });
    state.passwordResetActive = true;
    elements.passwordResetMessage.textContent =
      "如果这个邮箱已注册并完成验证，重置邮件已经发送。请粘贴邮件中的链接或令牌。";
    elements.passwordResetPanel.classList.remove("hidden");
    elements.submitBtn.classList.add("hidden");
    applyIdentityMode();
  } catch (error) {
    showError(error.message || "密码重置邮件暂时没有发送成功。");
  } finally {
    elements.forgotPasswordBtn.disabled = false;
  }
}

async function completePasswordReset() {
  const token = extractVerificationToken(elements.passwordResetToken.value);
  const password = elements.passwordResetNewPassword.value;
  if (!token || password.length < 10) {
    showError("请粘贴有效的重置链接，并填写至少 10 个字符的新密码。");
    return;
  }
  hideError();
  elements.completePasswordResetBtn.disabled = true;
  try {
    await window.desktop.resetPassword({ token, password });
    state.passwordResetActive = false;
    elements.passwordResetPanel.classList.add("hidden");
    elements.submitBtn.classList.remove("hidden");
    elements.password.value = "";
    elements.passwordResetToken.value = "";
    elements.passwordResetNewPassword.value = "";
    elements.formHint.textContent = "密码已经更新，请使用新密码登录";
    applyIdentityMode();
  } catch (error) {
    showError(error.message || "密码没有重置成功，请重新申请链接。");
  } finally {
    elements.completePasswordResetBtn.disabled = false;
  }
}

function cancelPasswordReset() {
  state.passwordResetActive = false;
  elements.passwordResetPanel.classList.add("hidden");
  elements.submitBtn.classList.remove("hidden");
  applyIdentityMode();
  hideError();
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
elements.scanHubBtn.addEventListener("click", scanHubs);
elements.refreshQrLoginBtn.addEventListener("click", createQrLogin);
elements.verifyEmailBtn.addEventListener("click", verifyEmail);
elements.resendEmailBtn.addEventListener("click", resendEmailVerification);
elements.verificationLoginBtn.addEventListener("click", returnToEmailLogin);
elements.forgotPasswordBtn.addEventListener("click", requestPasswordReset);
elements.completePasswordResetBtn.addEventListener("click", completePasswordReset);
elements.cancelPasswordResetBtn.addEventListener("click", cancelPasswordReset);
elements.togglePassword.addEventListener("click", () => {
  const visible = elements.password.type === "text";
  elements.password.type = visible ? "password" : "text";
  elements.togglePassword.textContent = visible ? "显示" : "隐藏";
});
document.querySelector("#minimizeBtn").addEventListener("click", window.desktop.minimize);
document.querySelector("#maximizeBtn").addEventListener("click", window.desktop.maximize);
document.querySelector("#closeBtn").addEventListener("click", window.desktop.close);

async function initialize() {
  const removeHubProgressListener = window.desktop.onAuthHubProgress(renderHubProgress);
  window.addEventListener("beforeunload", removeHubProgressListener, { once: true });
  const auth = await window.desktop.getAuthState();
  state.cloudEdition = auth.cloudEdition === true;
  elements.serverUrl.value = auth.serverUrl || "http://127.0.0.1:4318";
  if (!state.cloudEdition) {
    await scanHubs();
    await createQrLogin();
  }
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
