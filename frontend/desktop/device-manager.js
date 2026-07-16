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
        generate: find("generatePairingBtn"),
        regenerate: find("regeneratePairingBtn"),
        statusDot: find("pairingStatusDot"),
        statusTitle: find("pairingStatusTitle"),
        statusDetail: find("pairingStatusDetail"),
        countdown: find("pairingCountdown"),
        qrCode: find("pairingQrCode"),
        qrPlaceholder: find("pairingQrPlaceholder"),
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
      this.elements.generate.addEventListener("click", () => this.generate());
      this.elements.regenerate.addEventListener("click", () => this.generate());
      this.elements.copy.addEventListener("click", () => this.copyCode());
      this.elements.approve.addEventListener("click", () => this.approve());
      this.elements.refresh.addEventListener("click", () => this.refreshDevices());
      this.elements.deviceList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-revoke-device]");
        if (button) this.revoke(button.dataset.revokeDevice, button.dataset.deviceName);
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

    async generate() {
      this.setBusy(this.elements.generate, true, "正在生成…");
      this.setBusy(this.elements.regenerate, true, "正在生成…");
      this.hideNotice();
      this.stopTimers();
      try {
        const session = await this.api.createPairingSession({
          ttlSeconds: PAIRING_TTL_SECONDS
        });
        this.session = session;
        this.pairingCode = buildPairingCode(session, this.getServerUrl());
        this.qrCodeDataUrl = "";
        this.renderPairing();
        await this.generateQrCode();
        this.startTimers();
      } catch (error) {
        this.showNotice(error.message || "暂时无法生成连接码。", "error");
      } finally {
        this.setBusy(this.elements.generate, false, "生成连接码");
        this.setBusy(this.elements.regenerate, false, "换一个连接码");
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
        this.session = {
          ...this.session,
          ...(await this.api.getPairingSession(this.session.id))
        };
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
        this.session = {
          ...this.session,
          ...(await this.api.approvePairingSession(this.session.id))
        };
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
      this.elements.deviceName.textContent = this.session.deviceName || "未命名设备";
      this.elements.approve.disabled = this.session.status !== "pending";
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
          const label = document.createElement("span");
          label.className = "device-revoked-label";
          label.textContent = "已撤销";
          row.append(label);
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
      pairingView,
      formatCountdown
    };
  }
})(typeof window === "undefined" ? globalThis : window);
