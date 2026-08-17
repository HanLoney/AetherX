(function exposeConnectionCenter(global) {
  const REFRESH_INTERVAL_MS = 8_000;

  class AetherConnectionCenter {
    constructor(options) {
      this.api = options.api;
      this.root = options.root;
      this.onManageDevices = options.onManageDevices || (() => {});
      this.setInterval = options.setInterval || global.setInterval.bind(global);
      this.clearInterval = options.clearInterval || global.clearInterval.bind(global);
      this.elements = collectElements(this.root);
      this.timer = null;
      this.requestId = 0;
      this.opened = false;
      this.bound = false;
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.elements.close.addEventListener("click", () => this.close());
      this.elements.refresh.addEventListener("click", () => void this.refresh());
      this.elements.manage.addEventListener("click", () => {
        this.close();
        this.onManageDevices();
      });
      this.root.addEventListener("click", (event) => {
        if (event.target === this.root) this.close();
      });
      global.document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.opened) this.close();
      });
    }

    open() {
      this.bind();
      this.opened = true;
      this.root.classList.remove("hidden");
      void this.refresh();
      this.timer = this.setInterval(() => void this.refresh({ background: true }), REFRESH_INTERVAL_MS);
    }

    close() {
      this.opened = false;
      this.root.classList.add("hidden");
      if (this.timer) this.clearInterval(this.timer);
      this.timer = null;
    }

    async refresh(options = {}) {
      const requestId = ++this.requestId;
      if (!options.background) this.elements.refresh.classList.add("is-loading");
      try {
        const status = await this.api.getConnectionStatus();
        if (!this.opened || requestId !== this.requestId) return;
        renderConnectionStatus(this.elements, status || {});
      } catch (error) {
        if (!this.opened || requestId !== this.requestId) return;
        renderConnectionError(this.elements, error?.message || "连接状态暂时无法读取");
      } finally {
        if (requestId === this.requestId) this.elements.refresh.classList.remove("is-loading");
      }
    }

    destroy() {
      this.close();
      this.requestId += 1;
    }
  }

  function collectElements(root) {
    const find = (id) => root.querySelector(`#${id}`);
    return {
      close: find("closeConnectionCenterBtn"),
      refresh: find("refreshConnectionCenterBtn"),
      manage: find("manageConnectionDevicesBtn"),
      overallDot: find("connectionOverallDot"),
      overallTitle: find("connectionOverallTitle"),
      overallDetail: find("connectionOverallDetail"),
      activeHub: find("connectionActiveHub"),
      epoch: find("connectionEpoch"),
      syncState: find("connectionSyncState"),
      computerNode: find("computerHubNode"),
      computerRole: find("computerHubRole"),
      computerRuntime: find("computerHubRuntime"),
      computerHealth: find("computerHubHealth"),
      computerReplication: find("computerHubReplication"),
      computerIdentity: find("computerHubIdentity"),
      mobileNode: find("mobileHubNode"),
      mobileRole: find("mobileHubRole"),
      mobileHealth: find("mobileHubHealth"),
      mobileProgress: find("mobileHubProgress"),
      mobileMedia: find("mobileHubMedia"),
      mobileIdentity: find("mobileHubIdentity"),
      bridge: find("hubPeerBridge"),
      bridgeTitle: find("hubPeerBridgeTitle"),
      bridgeDetail: find("hubPeerBridgeDetail"),
      bridgeProgress: find("hubPeerBridgeProgress"),
      desktopCard: find("desktopClientCard"),
      desktopRoute: find("desktopClientRoute"),
      desktopState: find("desktopClientState"),
      anywhereCard: find("anywhereCard"),
      anywhereTitle: find("anywhereTitle"),
      anywhereDetail: find("anywhereDetail"),
      anywhereState: find("anywhereState"),
      mobileClientCard: find("mobileClientCard"),
      mobileClientName: find("mobileClientName"),
      mobileClientRoute: find("mobileClientRoute"),
      mobileClientState: find("mobileClientState"),
      endpointList: find("connectionEndpointList")
    };
  }

  function renderConnectionStatus(elements, status) {
    const cluster = status.cluster || null;
    const computer = status.computerHub || {};
    const mobileHubs = Array.isArray(status.mobileHubs) ? status.mobileHubs : [];
    const mobile = selectMobileHub(mobileHubs);
    const mobileClient = mobile?.client || null;
    const activeHubType = computer.active ? "电脑 Hub" : mobile?.active ? "手机 Hub" : "当前 Hub";
    const activeHubName = status.activeHub?.name || (computer.active ? "电脑 Hub" : mobile?.name) || "尚未确定";
    const activeHubLabel = activeHubName === activeHubType
      ? activeHubType
      : `${activeHubType} · ${activeHubName}`;
    const sync = deriveSyncState(cluster, mobile);
    const mobileOnline = Boolean(mobileClient && !["offline", "incompatible"].includes(mobileClient.status));
    const computerOnline = computer.online === true;
    const overall = !computerOnline
      ? { state: "error", title: "电脑 Hub 不可用", detail: "桌面端无法连接本机中枢" }
      : mobile && !mobileOnline
        ? { state: "warning", title: "电脑链路正常，手机端离线", detail: "手机重新打开后会继续同步备用副本" }
        : mobile && sync.state !== "healthy"
          ? { state: "warning", title: sync.title, detail: sync.detail }
          : { state: "healthy", title: "中枢链路稳定", detail: mobile ? "电脑与手机 Hub 状态已对齐" : "电脑内置 Hub 正常运行" };

    elements.overallDot.className = `connection-overall-dot ${overall.state}`;
    elements.overallTitle.textContent = overall.title;
    elements.overallDetail.textContent = overall.detail;
    elements.activeHub.textContent = activeHubLabel;
    elements.epoch.textContent = cluster ? String(Number(cluster.epoch) || 1) : "--";
    elements.syncState.textContent = sync.title;

    renderComputerHub(elements, computer);
    renderMobileHub(elements, mobile, sync);
    renderBridge(elements, sync, mobile);
    renderDesktopClient(elements, status.desktop || {}, activeHubLabel);
    renderAnywhere(elements, status.network || {});
    renderMobileClient(elements, mobileClient, activeHubLabel, mobile);
    renderEndpoints(elements.endpointList, status.network?.endpoints || []);
  }

  function renderComputerHub(elements, computer) {
    const online = computer.online === true;
    elements.computerNode.dataset.state = online ? "healthy" : "offline";
    elements.computerRole.textContent = computer.active ? "当前活动" : online ? "备用副本" : "离线";
    elements.computerRuntime.textContent = computer.runtime?.mode === "embedded" ? "桌面端内置" : "外部中枢";
    elements.computerHealth.textContent = online
      ? `在线${computer.latencyMs == null ? "" : ` · ${computer.latencyMs} ms`}`
      : "无法访问";
    elements.computerReplication.textContent = computer.cluster?.replication?.ready ? "复制通道就绪" : "等待对端";
    elements.computerIdentity.textContent = shortIdentity(computer.node?.name, computer.node?.id);
  }

  function renderMobileHub(elements, mobile, sync) {
    if (!mobile) {
      elements.mobileNode.dataset.state = "offline";
      elements.mobileRole.textContent = "尚未配对";
      elements.mobileHealth.textContent = "未建立 Local Hub";
      elements.mobileProgress.textContent = "--";
      elements.mobileMedia.textContent = "--";
      elements.mobileIdentity.textContent = "--";
      return;
    }
    const clientStatus = String(mobile.client?.status || "offline");
    const online = mobile.hubOnline === true;
    const progress = normalizedProgress(mobile);
    elements.mobileNode.dataset.state = online ? sync?.state === "healthy" ? "healthy" : "warning" : "offline";
    elements.mobileRole.textContent = mobile.active ? "当前活动" : mobile.ready ? "备用副本" : "准备中";
    elements.mobileHealth.textContent = mobile.client
      ? clientStatusLabel(clientStatus)
      : "客户端未上报";
    elements.mobileProgress.textContent = !online
      ? "同步状态待确认"
      : sync?.state === "healthy"
        ? "已同步"
        : progress > 0
          ? `同步中 · ${progress}%`
          : "等待同步";
    const mediaBytes = Number(mobile.progress?.mediaBytes || 0);
    const mediaTotal = Number(mobile.progress?.mediaTotalBytes || 0);
    elements.mobileMedia.textContent = mediaTotal > 0
      ? `${formatBytes(mediaBytes)} / ${formatBytes(mediaTotal)}`
      : mobile.snapshot?.status === "completed" ? "完整" : "等待统计";
    elements.mobileIdentity.textContent = shortIdentity(mobile.name, mobile.id);
  }

  function renderBridge(elements, sync, mobile) {
    elements.bridge.dataset.state = mobile ? sync.state : "offline";
    elements.bridgeTitle.textContent = sync.title;
    elements.bridgeDetail.textContent = mobile ? sync.detail : "PAIR A MOBILE HUB";
    elements.bridgeProgress.style.width = `${sync.progress}%`;
  }

  function renderDesktopClient(elements, desktop, activeHubName) {
    elements.desktopCard.dataset.state = desktop.connected ? "healthy" : "warning";
    elements.desktopRoute.textContent = desktop.connected ? `连接到 ${activeHubName}` : "等待活动 Hub";
    elements.desktopState.textContent = desktop.connected ? `在线 · v${desktop.version || "?"}` : "重连中";
  }

  function renderAnywhere(elements, network) {
    const tailscale = network.tailscale || {};
    const remote = network.remote || {};
    const lanAccess = network.lanAccess || {};
    const lan = (network.endpoints || []).filter((item) => item.transport === "lan");
    const state = remote.healthy ? "healthy" : tailscale.connected || lan.length ? "warning" : "offline";
    elements.anywhereCard.dataset.state = state;
    if (remote.healthy) {
      elements.anywhereTitle.textContent = "Anywhere 已联通";
      elements.anywhereDetail.textContent = remote.url || tailscale.dnsName || "私人 HTTPS 入口在线";
      elements.anywhereState.textContent = "远程可用";
    } else if (tailscale.connected) {
      elements.anywhereTitle.textContent = "Tailscale 已连接";
      elements.anywhereDetail.textContent = remote.enabled ? "远程入口等待 Hub" : "尚未开启 AetherX HTTPS 入口";
      elements.anywhereState.textContent = "待开启";
    } else if (lan.length && lanAccess.status === "public") {
      elements.anywhereTitle.textContent = "当前 Wi-Fi 为公用网络";
      elements.anywhereDetail.textContent = "可信家庭网络请设为专用，跨网络请启用 Anywhere";
      elements.anywhereState.textContent = "LAN 已阻止";
    } else if (lan.length) {
      elements.anywhereTitle.textContent = "局域网可用";
      elements.anywhereDetail.textContent = "同一 Wi-Fi 下可直连电脑 Hub";
      elements.anywhereState.textContent = "本地链路";
    } else {
      elements.anywhereTitle.textContent = tailscale.installed ? "Tailscale 未连接" : "未安装 Tailscale";
      elements.anywhereDetail.textContent = "跨网络连接暂不可用";
      elements.anywhereState.textContent = "离线";
    }
  }

  function renderMobileClient(elements, client, activeHubName, mobile) {
    if (!client) {
      elements.mobileClientCard.dataset.state = "offline";
      elements.mobileClientName.textContent = "手机客户端";
      elements.mobileClientRoute.textContent = mobile ? "等待手机客户端心跳" : "尚未建立手机 Hub";
      elements.mobileClientState.textContent = "离线";
      return;
    }
    const state = ["healthy", "warning", "idle"].includes(client.status)
      ? client.status === "healthy" ? "healthy" : "warning"
      : "offline";
    elements.mobileClientCard.dataset.state = state;
    elements.mobileClientName.textContent = client.name || "手机客户端";
    elements.mobileClientRoute.textContent = state === "offline"
      ? `上次连接到 ${activeHubName}`
      : `连接到 ${activeHubName}`;
    elements.mobileClientState.textContent = clientStatusLabel(client.status);
  }

  function renderEndpoints(container, endpoints) {
    container.innerHTML = "";
    const available = Array.isArray(endpoints) ? endpoints.slice(0, 4) : [];
    if (!available.length) {
      const empty = global.document.createElement("span");
      empty.textContent = "暂未发现可共享连接地址";
      container.append(empty);
      return;
    }
    available.forEach((endpoint) => {
      const chip = global.document.createElement("span");
      chip.className = endpoint.transport === "anywhere" ? "anywhere" : "lan";
      chip.textContent = `${endpoint.transport === "anywhere" ? "Anywhere" : "LAN"} · ${endpoint.address}`;
      chip.title = endpoint.address;
      container.append(chip);
    });
  }

  function renderConnectionError(elements, message) {
    elements.overallDot.className = "connection-overall-dot error";
    elements.overallTitle.textContent = "连接状态读取失败";
    elements.overallDetail.textContent = message;
    [elements.computerNode, elements.mobileNode, elements.desktopCard, elements.anywhereCard, elements.mobileClientCard]
      .forEach((element) => { element.dataset.state = "offline"; });
  }

  function deriveSyncState(cluster, mobile) {
    if (!mobile) return { state: "offline", title: "未配置双 Hub", detail: "等待手机 Hub 配对", progress: 0 };
    if (cluster?.state && cluster.state !== "stable") {
      return { state: "syncing", title: "安全切换中", detail: String(cluster.state), progress: normalizedProgress(mobile) };
    }
    const progress = normalizedProgress(mobile);
    if (mobile.hubOnline !== true) {
      return {
        state: "waiting",
        title: "等待手机重连",
        detail: "当前无法验证双方数据是否仍然一致",
        progress
      };
    }
    const caughtUp = mobile.replication?.confirmedCurrent === true;
    if (caughtUp) return { state: "healthy", title: "已同步", detail: "SIGNED OPERATION / BLOB", progress: 100 };
    if (progress > 0) return { state: "syncing", title: `同步中 ${progress}%`, detail: "正在追平手机 Hub", progress };
    return { state: "waiting", title: "等待同步", detail: "手机 Hub 尚未追平", progress: 0 };
  }

  function selectMobileHub(hubs) {
    const available = (Array.isArray(hubs) ? hubs : [])
      .filter((hub) => hub && hub.revokedAt == null);
    return available.find((hub) => hub.active) || available
      .sort((left, right) => {
        const leftOnline = left.hubOnline === true;
        const rightOnline = right.hubOnline === true;
        if (leftOnline !== rightOnline) return rightOnline ? 1 : -1;
        const leftSeen = Number(left.hubLastSeenAt || left.lastSeenAt || 0);
        const rightSeen = Number(right.hubLastSeenAt || right.lastSeenAt || 0);
        return rightSeen - leftSeen;
      })[0] || null;
  }

  function normalizedProgress(mobile) {
    if (!mobile) return 0;
    if (mobile.replication?.caughtUp === true || mobile.snapshot?.status === "completed" && mobile.ready) return 100;
    const value = Number(mobile.progress?.progress || 0);
    return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
  }

  function clientStatusLabel(value) {
    const labels = {
      healthy: "在线",
      warning: "连接异常",
      idle: "后台待机",
      incompatible: "版本不兼容",
      offline: "离线"
    };
    return labels[String(value || "offline")] || "状态未知";
  }

  function shortIdentity(name, id) {
    const label = String(name || "").trim();
    const shortId = String(id || "").trim().slice(0, 8);
    return label ? `${label}${shortId ? ` · ${shortId}` : ""}` : shortId || "--";
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  global.AetherConnectionCenter = AetherConnectionCenter;
  if (typeof module !== "undefined") {
    module.exports = { deriveSyncState, normalizedProgress, selectMobileHub };
  }
})(typeof window !== "undefined" ? window : globalThis);
