const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const REMOTE_HTTPS_PORT = 4318;
const AETHERX_HUB_TARGET = "http://127.0.0.1:4318";

function normalizeDnsName(value) {
  return String(value || "").trim().replace(/\.+$/, "");
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || "").trim() || "{}");
  } catch {
    return fallback;
  }
}

function inspectServeConfiguration(payload, options = {}) {
  const target = options.target || AETHERX_HUB_TARGET;
  const port = Number(options.port || REMOTE_HTTPS_PORT);
  const tcp = payload?.TCP?.[String(port)] || null;
  const entries = Object.entries(payload?.Web || {});
  let endpoint = "";

  for (const [hostPort, web] of entries) {
    const handlers = web?.Handlers || {};
    const root = handlers["/"];
    if (root?.Proxy === target) {
      endpoint = hostPort;
      break;
    }
  }

  const enabled = Boolean(tcp?.HTTPS && endpoint);
  return {
    enabled,
    conflict: Boolean(tcp && !enabled),
    url: enabled ? `https://${endpoint}` : ""
  };
}

function executableCandidates(env = process.env) {
  return [
    env.AETHERX_TAILSCALE_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, "Tailscale", "tailscale.exe"),
    env.ProgramFiles && path.join(env.ProgramFiles, "Tailscale IPN", "tailscale.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Tailscale", "tailscale.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Tailscale IPN", "tailscale.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Tailscale", "tailscale.exe")
  ].filter(Boolean);
}

async function findTailscaleExecutable(options = {}) {
  const access = options.access || fs.promises.access;
  for (const candidate of executableCandidates(options.env)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续尝试 PATH 与其他标准安装位置。
    }
  }

  try {
    const result = await (options.execFileImpl || execFileAsync)("where.exe", ["tailscale.exe"], {
      windowsHide: true,
      timeout: 2500
    });
    return String(result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

function commandError(error, fallback) {
  const detail = String(error?.stderr || error?.stdout || error?.message || "").trim();
  return new Error(detail || fallback);
}

function tailscaleServeConsentUrl(message) {
  const matched = String(message || "").match(/https:\/\/login\.tailscale\.com\/f\/serve\?[^\s]+/i);
  return matched ? matched[0].replace(/[),.;]+$/, "") : "";
}

class TailscaleManager {
  constructor(options = {}) {
    this.execFileImpl = options.execFileImpl || execFileAsync;
    this.spawnImpl = options.spawnImpl || spawn;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.env = options.env || process.env;
    this.executable = options.executable || "";
    this.cachedVersion = "";
    this.lastDiscoveryAt = 0;
  }

  async resolveExecutable() {
    if (this.executable) return this.executable;
    if (Date.now() - this.lastDiscoveryAt < 5000) return "";
    this.lastDiscoveryAt = Date.now();
    this.executable = await findTailscaleExecutable({
      env: this.env,
      execFileImpl: this.execFileImpl
    });
    return this.executable;
  }

  async run(args, options = {}) {
    const executable = await this.resolveExecutable();
    if (!executable) throw new Error("尚未安装 Tailscale");
    try {
      return await this.execFileImpl(executable, args, {
        windowsHide: true,
        timeout: options.timeout || 8000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw commandError(error, "Tailscale 操作失败");
    }
  }

  async getVersion() {
    if (this.cachedVersion) return this.cachedVersion;
    try {
      const result = await this.run(["version", "--json"]);
      const payload = parseJson(result.stdout);
      this.cachedVersion = payload.short || payload.version || "";
    } catch {
      try {
        const result = await this.run(["version"]);
        this.cachedVersion = String(result.stdout || "").split(/\r?\n/)[0].trim();
      } catch {
        this.cachedVersion = "";
      }
    }
    return this.cachedVersion;
  }

  async getStatus(options = {}) {
    const executable = await this.resolveExecutable();
    if (!executable) {
      return {
        tailscale: {
          installed: false,
          connected: false,
          state: "missing",
          version: null,
          dnsName: "",
          tailnet: "",
          ip: "",
          error: ""
        },
        remote: this.remoteStatus("missing")
      };
    }

    let statusPayload;
    try {
      const result = await this.run(["status", "--json"]);
      statusPayload = parseJson(result.stdout);
    } catch (error) {
      return {
        tailscale: {
          installed: true,
          connected: false,
          state: "unavailable",
          version: await this.getVersion(),
          dnsName: "",
          tailnet: "",
          ip: "",
          error: error.message
        },
        remote: this.remoteStatus("unavailable")
      };
    }

    const backendState = String(statusPayload.BackendState || "");
    const connected = backendState === "Running" && statusPayload.Self?.Online !== false;
    const dnsName = normalizeDnsName(statusPayload.Self?.DNSName);
    const tailscale = {
      installed: true,
      connected,
      state: connected ? "connected" : backendState === "NeedsLogin" ? "needs-login" : "stopped",
      version: await this.getVersion(),
      dnsName,
      tailnet: statusPayload.CurrentTailnet?.Name || statusPayload.MagicDNSSuffix || "",
      ip: statusPayload.TailscaleIPs?.[0] || "",
      error: ""
    };
    if (!connected) return { tailscale, remote: this.remoteStatus(tailscale.state) };

    let serve = { enabled: false, conflict: false, url: "" };
    try {
      const result = await this.run(["serve", "status", "--json"]);
      serve = inspectServeConfiguration(parseJson(result.stdout));
    } catch (error) {
      return {
        tailscale,
        remote: { ...this.remoteStatus("unavailable"), error: error.message }
      };
    }

    if (!serve.enabled) {
      return {
        tailscale,
        remote: {
          ...this.remoteStatus(serve.conflict ? "conflict" : "disabled"),
          conflict: serve.conflict
        }
      };
    }

    const health = options.hubHealthy === false
      ? { healthy: false, latencyMs: null }
      : await this.probeRemote(serve.url);
    return {
      tailscale,
      remote: {
        enabled: true,
        healthy: health.healthy,
        conflict: false,
        url: serve.url,
        latencyMs: health.latencyMs,
        status: health.healthy ? "healthy" : "waiting-hub",
        error: ""
      }
    };
  }

  remoteStatus(status) {
    return {
      enabled: false,
      healthy: false,
      conflict: false,
      url: "",
      latencyMs: null,
      status,
      error: ""
    };
  }

  async probeRemote(url) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    try {
      const response = await this.fetchImpl(`${url}/health`, { signal: controller.signal });
      if (!response.ok) return { healthy: false, latencyMs: Date.now() - startedAt };
      const payload = await response.json();
      return {
        healthy: payload?.data?.service === "aetherx-backend",
        latencyMs: Date.now() - startedAt
      };
    } catch {
      return { healthy: false, latencyMs: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async openClient() {
    const executable = await this.resolveExecutable();
    if (!executable) throw new Error("尚未安装 Tailscale");
    const child = this.spawnImpl(executable, ["login", "--timeout=10m"], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    child.unref?.();
  }

  async enable() {
    const status = await this.getStatus({ hubHealthy: true });
    if (!status.tailscale.connected) throw new Error("请先登录并连接 Tailscale");
    if (status.remote.conflict) {
      throw new Error(`Tailscale 的 HTTPS ${REMOTE_HTTPS_PORT} 端口已被其他服务占用`);
    }
    if (!status.remote.enabled) {
      try {
        await this.run([
          "serve",
          "--bg",
          "--yes",
          `--https=${REMOTE_HTTPS_PORT}`,
          AETHERX_HUB_TARGET
        ], { timeout: 20000 });
      } catch (error) {
        const consentUrl = tailscaleServeConsentUrl(error.message);
        if (!consentUrl) throw error;
        const consentError = new Error("Tailscale Serve 需要先授权，已为你打开授权页面。完成授权后，请再次点击“开启远程访问”。");
        consentError.actionUrl = consentUrl;
        throw consentError;
      }
    }
    return this.getStatus({ hubHealthy: true });
  }

  async disable() {
    const status = await this.getStatus({ hubHealthy: true });
    if (!status.remote.enabled) return status;
    await this.run(["serve", `--https=${REMOTE_HTTPS_PORT}`, "off"], { timeout: 12000 });
    return this.getStatus({ hubHealthy: true });
  }
}

module.exports = {
  AETHERX_HUB_TARGET,
  REMOTE_HTTPS_PORT,
  TAILSCALE_DOWNLOAD_URL,
  TailscaleManager,
  findTailscaleExecutable,
  inspectServeConfiguration,
  normalizeDnsName,
  tailscaleServeConsentUrl
};
