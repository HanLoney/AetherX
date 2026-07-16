import type { AetherApi, SyncChange } from "./api";
import { loadSyncCursor, saveSyncCursor } from "./storage";

type ChangeHandler = (changes: SyncChange[]) => void | Promise<void>;

export class SyncCoordinator {
  private controller: AbortController | null = null;
  private cursor = 0;
  private retryAttempt = 0;
  private running = false;

  constructor(private readonly api: AetherApi, private readonly onChanges: ChangeHandler) {}

  async start() {
    if (this.running) return;
    this.running = true;
    this.cursor = await loadSyncCursor();
    try { await this.catchUp(); } catch { /* 长连接重试前会再次补拉 */ }
    void this.connect();
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private async catchUp() {
    let hasMore = true;
    while (this.running && hasMore) {
      const page = await this.api.syncChanges(this.cursor);
      if (page.changes.length) await this.onChanges(page.changes);
      this.cursor = page.nextCursor;
      await saveSyncCursor(this.cursor);
      hasMore = page.hasMore;
    }
  }

  private async connect() {
    while (this.running) {
      this.controller = new AbortController();
      try {
        const response = await fetch(`${this.api.serverUrl}/api/v1/sync/events?after=${this.cursor}`, {
          headers: { Authorization: `Bearer ${this.api.accessToken}` },
          signal: this.controller.signal
        });
        if (response.status === 401) {
          await this.api.session();
          throw new Error("Unauthorized");
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        this.retryAttempt = 0;
        await parseEventStream(response.body, async (event) => {
          if (event.event !== "change") return;
          const change = JSON.parse(event.data) as SyncChange;
          if (change.seq <= this.cursor) return;
          await this.onChanges([change]);
          this.cursor = change.seq;
          await saveSyncCursor(this.cursor);
        });
      } catch (error) {
        if (!this.running || (error as Error).name === "AbortError") return;
      }
      if (!this.running) return;
      const delay = Math.min(30_000, 1_000 * 2 ** this.retryAttempt) + Math.floor(Math.random() * 400);
      this.retryAttempt += 1;
      await wait(delay);
      try { await this.catchUp(); } catch { /* 下一轮继续重试 */ }
    }
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
