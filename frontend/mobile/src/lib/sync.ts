import type { AetherApi, SyncChange } from "./api";
import { loadSyncCursor, saveSyncCursor } from "./storage";

type ChangeHandler = (changes: SyncChange[]) => void | Promise<void>;
export interface SyncConnectionStatus {
  connected: boolean;
  cursor: number;
  state: "connecting" | "online" | "retrying" | "stopped";
}
type StatusHandler = (status: SyncConnectionStatus) => void;
type CommandHandler = (command: Record<string, unknown>) => void | Promise<void>;
export interface SyncCoordinatorOptions {
  controlOnly?: boolean;
}

export class SyncCoordinator {
  private controller: AbortController | null = null;
  private commandPollTimer: ReturnType<typeof setInterval> | null = null;
  private cursor = 0;
  private retryAttempt = 0;
  private running = false;
  private handledCommandIds = new Set<string>();

  constructor(
    private readonly api: AetherApi,
    private readonly onChanges: ChangeHandler,
    private readonly cursorScope: string,
    private readonly onStatus: StatusHandler = () => undefined,
    private readonly clientId = "",
    private readonly onCommand: CommandHandler = () => undefined,
    private readonly options: SyncCoordinatorOptions = {}
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;
    this.cursor = await loadSyncCursor(this.cursorScope);
    this.notify(false, "connecting");
    if (!this.options.controlOnly) {
      try { await this.catchUp(); } catch { /* 长连接重试前会再次补拉 */ }
    } else {
      void this.pollCommands();
      this.commandPollTimer = setInterval(() => void this.pollCommands(), 3_000);
    }
    void this.connect();
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    if (this.commandPollTimer) clearInterval(this.commandPollTimer);
    this.commandPollTimer = null;
    this.notify(false, "stopped");
  }

  private async catchUp() {
    let hasMore = true;
    while (this.running && hasMore) {
      const page = await this.api.syncChanges(this.cursor);
      if (page.changes.length) await this.onChanges(page.changes);
      this.cursor = page.nextCursor;
      await saveSyncCursor(this.cursorScope, this.cursor);
      this.notify(false, "connecting");
      hasMore = page.hasMore;
    }
  }

  private async connect() {
    while (this.running) {
      this.controller = new AbortController();
      try {
        const query = new URLSearchParams({ after: String(this.cursor) });
        if (this.clientId) query.set("client_id", this.clientId);
        if (this.options.controlOnly) query.set("control_only", "1");
        const response = await fetch(`${this.api.serverUrl}/api/v1/sync/events?${query}`, {
          headers: { Authorization: `Bearer ${this.api.accessToken}` },
          signal: this.controller.signal
        });
        if (response.status === 401) {
          await this.api.session();
          throw new Error("Unauthorized");
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        this.retryAttempt = 0;
        this.notify(true, "online");
        await parseEventStream(response.body, async (event) => {
          if (event.event === "ready" && this.options.controlOnly) {
            const ready = JSON.parse(event.data) as { cursor?: number; latestSequence?: number };
            const cursor = Number(ready.cursor ?? ready.latestSequence ?? this.cursor);
            if (Number.isSafeInteger(cursor) && cursor >= 0) {
              this.cursor = cursor;
              await saveSyncCursor(this.cursorScope, this.cursor);
              this.notify(true, "online");
            }
            return;
          }
          if (event.event === "hub-command") {
            await this.deliverCommand(JSON.parse(event.data) as Record<string, unknown>);
            return;
          }
          if (event.event === "cluster-change") {
            const change = JSON.parse(event.data) as Record<string, unknown>;
            await this.onCommand({ ...change, type: "cluster-change" });
            return;
          }
          if (event.event !== "change") return;
          const change = JSON.parse(event.data) as SyncChange;
          if (change.seq <= this.cursor) return;
          await this.onChanges([change]);
          this.cursor = change.seq;
          await saveSyncCursor(this.cursorScope, this.cursor);
          this.notify(true, "online");
        });
      } catch (error) {
        if (!this.running || (error as Error).name === "AbortError") return;
        this.notify(false, "retrying");
      }
      if (!this.running) return;
      const delay = Math.min(30_000, 1_000 * 2 ** this.retryAttempt) + Math.floor(Math.random() * 400);
      this.retryAttempt += 1;
      await wait(delay);
      if (!this.options.controlOnly) {
        try { await this.catchUp(); } catch { /* 下一轮继续重试 */ }
      }
    }
  }

  private notify(connected: boolean, state: SyncConnectionStatus["state"]) {
    this.onStatus({ connected, cursor: this.cursor, state });
  }

  private async pollCommands() {
    if (!this.running || !this.options.controlOnly || !this.clientId) return;
    try {
      const result = await this.api.syncCommands(this.clientId);
      for (const command of result.commands || []) await this.deliverCommand(command);
    } catch {
      // SSE 仍会继续重连；轮询只是代理不支持流式响应时的控制兜底。
    }
  }

  private async deliverCommand(command: Record<string, unknown>) {
    const commandId = String(command.commandId || "");
    if (commandId && this.handledCommandIds.has(commandId)) return;
    if (commandId) {
      this.handledCommandIds.add(commandId);
      if (this.handledCommandIds.size > 100) {
        this.handledCommandIds.delete(this.handledCommandIds.values().next().value || "");
      }
    }
    await this.onCommand(command);
  }
}

interface ParsedEvent { event: string; data: string; id: string }

export async function parseEventStream(stream: ReadableStream<Uint8Array>, handler: (event: ParsedEvent) => void | Promise<void>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseBlock(block);
      if (event.data) await handler(event);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function parseBlock(block: string): ParsedEvent {
  const result: ParsedEvent = { event: "message", data: "", id: "" };
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") result.event = value;
    else if (field === "id") result.id = value;
    else if (field === "data") data.push(value);
  }
  result.data = data.join("\n");
  return result;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
