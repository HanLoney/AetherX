(function exposeDeviceManager(global) {
  const PAIRING_TTL_SECONDS = 300;
  const DEFAULT_POLL_INTERVAL = 1500;

  function buildPairingCode(session, serverUrl) {
    const id = String(session?.id || "").trim();
    const secret = String(session?.secret || "").trim();
    const server = String(serverUrl || "").trim().replace(/\/+$/, "");
    if (!id || !secret || !/^https?:\/\//i.test(server)) {
      throw new Error("缺少生成连接码所需的信息。");
    }
    const query = new URLSearchParams({
      server,
      id,
      secret,
      expiresAt: String(session.expiresAt || "")
    });
    return `aetherx://pair?${query.toString()}`;
  }

  function buildHubPairingCode(session, serverUrls = "") {
    if (!serverUrls || (Array.isArray(serverUrls) && !serverUrls.length)) {
      if (!session?.qrPayload) throw new Error("缺少手机 Hub 配对信息。");
      return `aetherx://hub-pair?payload=${encodePairingPayload(session.qrPayload)}`;
    }
    const reference = hubPairingReference(session, serverUrls);
    const query = new URLSearchParams({
      v: "2",
      i: reference.sessionId,
      k: reference.secret,
      e: String(reference.expiresAt)
    });
    reference.serverUrls.forEach((server) => query.append("s", server));
    return `aetherx://hub-pair?${query.toString()}`;
  }

  function buildCompletePairingCode(clientSession, serverUrls, hubSession) {
    const servers = normalizePairingServers(serverUrls);
    const clientUrl = new URL(buildPairingCode(clientSession, servers[0]));
    const hub = hubPairingReference(hubSession, servers);
    const query = new URLSearchParams({
      v: "2",
      c: clientUrl.searchParams.get("id"),
      cs: clientUrl.searchParams.get("secret"),
      h: hub.sessionId,
      hs: hub.secret,
      e: String(Math.min(
        Number(clientUrl.searchParams.get("expiresAt")) || Infinity,
        hub.expiresAt
      ))
    });
    servers.forEach((server) => query.append("s", server));
    return `aetherx://complete-pair?${query.toString()}`;
  }

  function hubPairingReference(session, serverUrls) {
    const sessionId = String(session?.id || session?.qrPayload?.sessionId || "").trim();
    const secret = String(session?.secret || session?.qrPayload?.secret || "").trim();
    const expiresAt = Number(session?.expiresAt || session?.qrPayload?.expiresAt);
    const servers = normalizePairingServers(serverUrls);
    if (!sessionId || secret.length < 32 || !Number.isFinite(expiresAt)) {
      throw new Error("缺少生成手机 Hub 短码所需的信息。");
    }
    return { version: 2, serverUrls: servers, sessionId, secret, expiresAt };
  }

  function normalizePairingServers(serverUrls) {
    const values = Array.isArray(serverUrls) ? serverUrls : [serverUrls];
    const servers = [];
    values.forEach((value) => {
      try {
        const server = new URL(String(value || "").trim());
        if (!["http:", "https:"].includes(server.protocol)) return;
        if (!servers.includes(server.origin)) servers.push(server.origin);
      } catch {
        // Ignore malformed fallback addresses and validate the final list below.
      }
    });
    if (!servers.length) throw new Error("缺少手机可访问的配对地址。");
    return servers;
  }

  function encodePairingPayload(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function combinePairingSessions(client, hub) {
    if (!client || !hub) return null;
    const statuses = [client.status, hub.status];
    let status = "created";
    if (statuses.every((value) => value === "redeemed")) status = "redeemed";
    else if (statuses.every((value) => ["approved", "redeemed"].includes(value))) status = "approved";
    else if (
      statuses.every((value) => ["pending", "approved", "redeemed"].includes(value)) &&
      statuses.some((value) => value === "pending")
    ) status = "pending";
    else if (statuses.some((value) => value !== "created")) status = "claiming";
    return {
      id: `${client.id}:${hub.id}`,
      status,
      expiresAt: Math.min(Number(client.expiresAt) || Infinity, Number(hub.expiresAt) || Infinity),
      deviceName: client.deviceName || hub.nodeName || "",
      nodeName: hub.nodeName || "",
      combined: true
    };
  }

  function selectReachablePairingServer(endpoints, fallback) {
    const reachable = (Array.isArray(endpoints) ? endpoints : [])
      .filter((endpoint) => /^https?:\/\//i.test(String(endpoint?.address || "")))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    return reachable[0]?.address || normalizePairingServers(fallback)[0];
  }

  function selectReachablePairingServers(endpoints, fallback) {
    const reachable = (Array.isArray(endpoints) ? endpoints : [])
      .filter((endpoint) => /^https?:\/\//i.test(String(endpoint?.address || "")))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))
      .map((endpoint) => endpoint.address);
    const fallbackValue = String(fallback || "");
    const candidates = /^https?:\/\//i.test(fallbackValue) && /^(?:https?:\/\/)(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(fallbackValue)
      ? [fallbackValue, ...reachable]
      : [...reachable, fallbackValue];
    return normalizePairingServers(candidates);
  }

  function pairingView(session, now = Date.now()) {
    if (!session) {
      return { state: "idle", title: "尚未生成连接码", detail: "", terminal: true };
    }
    if (Number(session.expiresAt) <= now && session.status !== "redeemed") {
      return {
        state: "expired",
        title: "连接码已过期",
        detail: "请生成一个新的连接码",
        terminal: true
      };
    }
    const views = {
      created: {
        state: "waiting",
        title: "等待手机申请",
        detail: "把连接码粘贴到手机端",
        terminal: false
      },
      pending: {
        state: "pending",
        title: "收到连接申请",
        detail: "确认设备名称后再批准",
        terminal: false
      },
      claiming: {
        state: "waiting",
        title: "正在提交双重申请",
        detail: "客户端与手机 Hub 身份正在同时校验",
        terminal: false
      },
      approved: {
        state: "approved",
        title: "已批准连接",
        detail: "等待手机完成安全连接",
        terminal: false
      },
      redeemed: {
        state: "success",
        title: "手机连接成功",
        detail: "这台设备现在可以同步数据",
        terminal: true
      }
    };
    return views[session.status] || {
      state: "error",
      title: "连接状态异常",
      detail: "请生成一个新的连接码",
      terminal: true
    };
  }

  function formatCountdown(expiresAt, now = Date.now()) {
    const remaining = Math.max(0, Math.ceil((Number(expiresAt) - now) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
    const seconds = String(remaining % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatDeviceTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "尚无活动记录";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function deviceIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M10 6h4M10.5 18h3"/></svg>';
  }

  class AetherDeviceManager {
    constructor(options) {
      this.api = options.api;
      this.root = options.root;
      this.getServerUrl = options.getServerUrl;
      this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL;
      this.setTimeout = options.setTimeout || global.setTimeout.bind(global);
      this.clearTimeout = options.clearTimeout || global.clearTimeout.bind(global);
      this.confirm = options.confirm || global.confirm.bind(global);
      this.session = null;
      this.clientSession = null;
      this.hubSession = null;
      this.pairingCode = "";
      this.qrCodeDataUrl = "";
      this.pollTimer = null;
      this.countdownTimer = null;
      this.polling = false;
      this.opened = false;
      this.bound = false;
      this.handleKeydown = (event) => {
        if (event.key === "Escape" && this.opened) this.close();
      };
      this.elements = this.collectElements();
    }

    collectElements() {
      const find = (id) => this.root.querySelector(`#${id}`);
      return {
        close: find("closeDeviceManagerBtn"),
        pairingEmpty: find("pairingEmpty"),
        pairingActive: find("pairingActive"),
        generateComplete: find("generateCompletePairingBtn"),
        statusDot: find("pairingStatusDot"),
        statusTitle: find("pairingStatusTitle"),
        statusDetail: find("pairingStatusDetail"),
        countdown: find("pairingCountdown"),
        qrCode: find("pairingQrCode"),
        qrPlaceholder: find("pairingQrPlaceholder"),
        shareTitle: find("pairingShareTitle"),
        shareDescription: find("pairingShareDescription"),
        codeLabel: find("pairingCodeLabel"),
        code: find("pairingCode"),
        copy: find("copyPairingCodeBtn"),
        request: find("pairingRequest"),
        deviceName: find("pairingDeviceName"),
        approve: find("approvePairingBtn"),
        notice: find("deviceManagerNotice"),
        refresh: find("refreshDevicesBtn"),
        deviceList: find("deviceList")
      };
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.elements.close.addEventListener("click", () => this.close());
      this.root.addEventListener("click", (event) => {
        if (event.target === this.root) this.close();
      });
      this.elements.generateComplete?.addEventListener("click", () => this.generateComplete());
      this.elements.copy.addEventListener("click", () => this.copyCode());
      this.elements.approve.addEventListener("click", () => this.approve());
      this.elements.refresh.addEventListener("click", () => this.refreshDevices());
      this.elements.deviceList.addEventListener("click", (event) => {
        const revokeButton = event.target.closest("[data-revoke-device]");
        if (revokeButton) {
          this.revoke(revokeButton.dataset.revokeDevice, revokeButton.dataset.deviceName);
          return;
        }
        const deleteButton = event.target.closest("[data-delete-device]");
        if (deleteButton) {
          this.deleteRecord(deleteButton.dataset.deleteDevice, deleteButton.dataset.deviceName);
        }
      });
      global.document.addEventListener("keydown", this.handleKeydown);
    }

    async open() {
      this.bind();
      this.opened = true;
      this.root.classList.remove("hidden");
      this.hideNotice();
      this.renderPairing();
      await this.refreshDevices();
      if (this.session && !pairingView(this.session).terminal) this.startTimers();
    }

    close() {
      this.opened = false;
      this.root.classList.add("hidden");
      this.stopTimers();
    }

    destroy() {
      this.opened = false;
      this.stopTimers();
      if (this.bound) global.document.removeEventListener("keydown", this.handleKeydown);
      this.bound = false;
    }

    async generateComplete() {
      this.setBusy(this.elements.generateComplete, true, "正在生成一体化配对码…");
      this.hideNotice();
      this.stopTimers();
      try {
        const endpoints = await this.api.getHubPairingEndpoints();
        if (!Array.isArray(endpoints) || !endpoints.length) {
          throw new Error("没有找到手机可访问的 Hub 地址，请先确认手机与电脑在同一局域网或 Anywhere 已可用。");
        }
        const [clientSession, hubSession] = await Promise.all([
          this.api.createPairingSession({ ttlSeconds: PAIRING_TTL_SECONDS }),
          this.api.createHubPairingSession({ ttlSeconds: PAIRING_TTL_SECONDS, endpoints })
        ]);
        this.clientSession = clientSession;
        this.hubSession = hubSession;
        this.session = combinePairingSessions(clientSession, hubSession);
        this.pairingCode = buildCompletePairingCode(
          clientSession,
          selectReachablePairingServers(endpoints, this.getServerUrl()),
          hubSession
        );
        this.qrCodeDataUrl = "";
        this.renderPairing();
        await this.generateQrCode();
        this.startTimers();
      } catch (error) {
        this.showNotice(error.message || "暂时无法生成一体化配对码。", "error");
      } finally {
        this.setBusy(this.elements.generateComplete, false, "生成一体化配对码");
      }
    }

    async copyCode() {
      if (!this.pairingCode) return;
      this.elements.copy.disabled = true;
      try {
        await this.api.writeClipboard(this.pairingCode);
        this.elements.copy.textContent = "已复制";
        this.setTimeout(() => {
          this.elements.copy.textContent = "复制";
          this.elements.copy.disabled = false;
        }, 1400);
      } catch (error) {
        this.elements.copy.disabled = false;
        this.showNotice(error.message || "复制失败，请手动选择连接码。", "error");
      }
    }

    async generateQrCode() {
      this.elements.qrCode.classList.add("hidden");
      this.elements.qrPlaceholder.classList.remove("hidden");
      this.elements.qrPlaceholder.textContent = "正在生成二维码…";
      try {
        this.qrCodeDataUrl = await this.api.generateQrCode(this.pairingCode);
        this.elements.qrCode.src = this.qrCodeDataUrl;
        this.elements.qrCode.classList.remove("hidden");
        this.elements.qrPlaceholder.classList.add("hidden");
      } catch (error) {
        this.elements.qrPlaceholder.textContent = "二维码生成失败，请复制连接码";
        this.showNotice(error.message || "二维码生成失败，请使用连接码。", "error");
      }
    }

    startTimers() {
      this.stopTimers();
      if (!this.opened || !this.session) return;
      this.schedulePoll(0);
      this.tickCountdown();
    }

    stopTimers() {
      if (this.pollTimer !== null) this.clearTimeout(this.pollTimer);
      if (this.countdownTimer !== null) this.clearTimeout(this.countdownTimer);
      this.pollTimer = null;
      this.countdownTimer = null;
    }

    schedulePoll(delay = this.pollIntervalMs) {
      if (!this.opened || !this.session || pairingView(this.session).terminal) return;
      if (this.pollTimer !== null) this.clearTimeout(this.pollTimer);
      this.pollTimer = this.setTimeout(() => {
        this.pollTimer = null;
        this.pollPairing();
      }, delay);
    }

    async pollPairing() {
      if (this.polling || !this.opened || !this.session) return;
      this.polling = true;
      try {
        const previousStatus = this.session.status;
        const [clientSession, hubSession] = await Promise.all([
          this.api.getPairingSession(this.clientSession.id),
          this.api.getHubPairingSession(this.hubSession.id)
        ]);
        this.clientSession = { ...this.clientSession, ...clientSession };
        this.hubSession = { ...this.hubSession, ...hubSession };
        this.session = combinePairingSessions(this.clientSession, this.hubSession);
        this.renderPairing();
        if (this.session.status === "redeemed" && previousStatus !== "redeemed") {
          this.showNotice("手机已经安全连接，可以开始同步了。", "success");
          await this.refreshDevices();
        }
      } catch (error) {
        if (error?.code === "PAIRING_SESSION_EXPIRED" || error?.status === 410) {
          this.session.expiresAt = 0;
          this.renderPairing();
        } else {
          this.showNotice(error.message || "读取配对状态失败，正在重试。", "error");
        }
      } finally {
        this.polling = false;
        this.schedulePoll();
      }
    }

    tickCountdown() {
      if (!this.opened || !this.session) return;
      this.elements.countdown.textContent = formatCountdown(this.session.expiresAt);
      const view = pairingView(this.session);
      if (view.terminal) {
        this.renderPairing();
        return;
      }
      this.countdownTimer = this.setTimeout(() => {
        this.countdownTimer = null;
        this.tickCountdown();
      }, 1000);
    }

    async approve() {
      if (!this.session || this.session.status !== "pending") return;
      this.setBusy(this.elements.approve, true, "正在批准…");
      this.hideNotice();
      try {
        const approvals = [];
        if (this.clientSession.status === "pending") {
          approvals.push(this.api.approvePairingSession(this.clientSession.id).then((value) => {
            this.clientSession = { ...this.clientSession, ...value };
          }));
        }
        if (this.hubSession.status === "pending") {
          approvals.push(this.api.approveHubPairingSession(this.hubSession.id).then((value) => {
            this.hubSession = { ...this.hubSession, ...value };
          }));
        }
        await Promise.all(approvals);
        this.session = combinePairingSessions(this.clientSession, this.hubSession);
        this.renderPairing();
        this.showNotice("已经批准，手机正在完成连接。", "success");
        this.schedulePoll(0);
      } catch (error) {
        this.showNotice(error.message || "批准连接失败。", "error");
      } finally {
        this.setBusy(this.elements.approve, false, "批准连接");
      }
    }

    renderPairing() {
      const active = Boolean(this.session);
      this.elements.pairingEmpty.classList.toggle("hidden", active);
      this.elements.pairingActive.classList.toggle("hidden", !active);
      if (!active) return;

      const view = pairingView(this.session);
      this.elements.statusDot.className = `pairing-status-dot ${view.state}`;
      this.elements.statusTitle.textContent = view.title;
      this.elements.statusDetail.textContent = view.detail;
      this.elements.countdown.textContent =
        view.state === "success" ? "完成" : formatCountdown(this.session.expiresAt);
      this.elements.code.value = this.pairingCode;
      this.elements.qrCode.classList.toggle("hidden", !this.qrCodeDataUrl);
      this.elements.qrPlaceholder.classList.toggle("hidden", Boolean(this.qrCodeDataUrl));
      this.elements.request.classList.toggle("hidden", this.session.status !== "pending");
      this.elements.deviceName.textContent = this.session.nodeName || this.session.deviceName || "未命名设备";
      this.elements.approve.disabled = this.session.status !== "pending";
      this.elements.shareTitle.textContent = "一次连接客户端并建立手机 Hub";
      this.elements.shareDescription.textContent = "手机扫描一次，电脑批准一次；客户端登录和备用 Hub 身份会同时建立。";
      this.elements.codeLabel.textContent = "一体化配对码（aetherx://complete-pair）";
      if (view.state === "waiting") {
        this.elements.statusDetail.textContent = "在手机登录页或连接设置中扫描这一张二维码";
      }
    }

    async refreshDevices() {
      this.elements.refresh.disabled = true;
      this.elements.refresh.classList.add("is-loading");
      if (!this.elements.deviceList.children.length) {
        this.elements.deviceList.innerHTML = '<div class="device-list-loading">正在读取设备…</div>';
      }
      try {
        const result = await this.api.listDevices();
        this.renderDevices(Array.isArray(result) ? result : result?.devices || []);
      } catch (error) {
        this.elements.deviceList.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "device-list-empty error";
        empty.textContent = error.message || "设备列表暂时无法读取。";
        this.elements.deviceList.append(empty);
      } finally {
        this.elements.refresh.disabled = false;
        this.elements.refresh.classList.remove("is-loading");
      }
    }

    renderDevices(devices) {
      this.elements.deviceList.innerHTML = "";
      if (!devices.length) {
        const empty = document.createElement("div");
        empty.className = "device-list-empty";
        empty.innerHTML = `${deviceIconMarkup()}<strong>还没有连接设备</strong><span>完成上方配对后，手机会出现在这里。</span>`;
        this.elements.deviceList.append(empty);
        return;
      }

      const sorted = [...devices].sort((left, right) => {
        if (left.status !== right.status) return left.status === "active" ? -1 : 1;
        return Number(right.lastSeenAt || right.createdAt) - Number(left.lastSeenAt || left.createdAt);
      });
      sorted.forEach((device) => {
        const revoked = device.status === "revoked";
        const row = document.createElement("article");
        row.className = `device-row${revoked ? " is-revoked" : ""}`;

        const icon = document.createElement("span");
        icon.className = "device-row-icon";
        icon.innerHTML = deviceIconMarkup();

        const copy = document.createElement("div");
        copy.className = "device-row-copy";
        const name = document.createElement("strong");
        name.textContent = device.name || "未命名设备";
        const detail = document.createElement("small");
        detail.textContent = revoked
          ? `已撤销 · ${formatDeviceTime(device.revokedAt)}`
          : `最近连接 · ${formatDeviceTime(device.lastSeenAt || device.createdAt)}`;
        copy.append(name, detail);

        row.append(icon, copy);
        if (revoked) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "device-delete-button";
          remove.dataset.deleteDevice = device.id;
          remove.dataset.deviceName = device.name || "这条设备记录";
          remove.textContent = "删除记录";
          row.append(remove);
        } else {
          const revoke = document.createElement("button");
          revoke.type = "button";
          revoke.className = "device-revoke-button";
          revoke.dataset.revokeDevice = device.id;
          revoke.dataset.deviceName = device.name || "这台设备";
          revoke.textContent = "撤销访问";
          row.append(revoke);
        }
        this.elements.deviceList.append(row);
      });
    }

    async revoke(id, name) {
      if (!id || !this.confirm(`确定撤销“${name || "这台设备"}”吗？撤销后需要重新配对。`)) {
        return;
      }
      const button = this.elements.deviceList.querySelector(
        `[data-revoke-device="${global.CSS?.escape ? global.CSS.escape(id) : id}"]`
      );
      if (button) this.setBusy(button, true, "正在撤销…");
      this.hideNotice();
      try {
        await this.api.revokeDevice(id);
        this.showNotice("设备访问已撤销。", "success");
        await this.refreshDevices();
      } catch (error) {
        if (button) this.setBusy(button, false, "撤销访问");
        this.showNotice(error.message || "撤销设备失败。", "error");
      }
    }

    async deleteRecord(id, name) {
      if (!id || !this.confirm(`确定删除“${name || "这条设备记录"}”吗？删除后不会影响其他设备。`)) {
        return;
      }
      const button = this.elements.deviceList.querySelector(
        `[data-delete-device="${global.CSS?.escape ? global.CSS.escape(id) : id}"]`
      );
      if (button) this.setBusy(button, true, "正在删除…");
      this.hideNotice();
      try {
        await this.api.deleteDeviceRecord(id);
        this.showNotice("已删除设备记录。", "success");
        await this.refreshDevices();
      } catch (error) {
        if (button) this.setBusy(button, false, "删除记录");
        this.showNotice(error.message || "删除设备记录失败。", "error");
      }
    }

    setBusy(button, busy, label) {
      button.disabled = busy;
      button.textContent = label;
    }

    showNotice(message, tone) {
      this.elements.notice.textContent = message;
      this.elements.notice.className = `device-manager-notice ${tone || "info"}`;
    }

    hideNotice() {
      this.elements.notice.textContent = "";
      this.elements.notice.className = "device-manager-notice hidden";
    }
  }

  global.AetherDeviceManager = AetherDeviceManager;
  if (typeof module !== "undefined") {
    module.exports = {
      AetherDeviceManager,
      buildPairingCode,
      buildHubPairingCode,
      buildCompletePairingCode,
      combinePairingSessions,
      selectReachablePairingServer,
      selectReachablePairingServers,
      pairingView,
      formatCountdown
    };
  }
})(typeof window === "undefined" ? globalThis : window);
