import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import type { AetherApi, DeviceHeartbeatInput } from "./api";
import { loadInstallationId } from "./storage";

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface MobileHealthSnapshot {
  syncStatus: DeviceHeartbeatInput["syncStatus"];
  syncCursor: number;
  sseConnected: boolean;
  lastError?: string;
}

export class MobileHealthReporter {
  private timer: number | null = null;
  private running = false;
  private sending: Promise<void> | null = null;
  private latencyMs: number | null = null;
  private identity: Promise<Pick<DeviceHeartbeatInput,
    "installationId" | "name" | "platform" | "model" | "osVersion" | "appVersion">> | null = null;

  constructor(
    private readonly api: AetherApi,
    private readonly snapshot: () => MobileHealthSnapshot
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.handleVisibility);
    void this.report();
    this.timer = window.setInterval(() => void this.report(), HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    document.removeEventListener("visibilitychange", this.handleVisibility);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  report() {
    if (!this.running) return Promise.resolve();
    if (this.sending) return this.sending;
    this.sending = this.send()
      .catch(() => undefined)
      .finally(() => { this.sending = null; });
    return this.sending;
  }

  private readonly handleVisibility = () => {
    void this.report();
  };

  private async send() {
    const identity = await this.getIdentity();
    const state = this.snapshot();
    const startedAt = performance.now();
    await this.api.deviceHeartbeat({
      ...identity,
      ...state,
      protocolVersion: 1,
      foreground: document.visibilityState !== "hidden",
      latencyMs: this.latencyMs
    });
    this.latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  }

  private getIdentity() {
    if (!this.identity) this.identity = readIdentity();
    return this.identity;
  }
}

async function readIdentity() {
  const [installationId, device, app] = await Promise.all([
    loadInstallationId(),
    Device.getInfo().catch(() => null),
    Capacitor.isNativePlatform() ? App.getInfo().catch(() => null) : Promise.resolve(null)
  ]);
  const manufacturer = cleanLabel(device?.manufacturer);
  const model = cleanLabel(device?.model);
  const combined = [manufacturer, model]
    .filter((item, index, all) => item && all.indexOf(item) === index)
    .join(" ");
  return {
    installationId,
    name: combined || "AetherX 移动端",
    platform: device?.platform || Capacitor.getPlatform(),
    model,
    osVersion: device?.osVersion || "",
    appVersion: app?.version || "0.1.0"
  };
}

function cleanLabel(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}
