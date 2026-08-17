import { afterEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  loadSyncCursor: vi.fn(async () => 0),
  saveSyncCursor: vi.fn(async () => undefined)
}));

vi.mock("./storage", () => storageMocks);

import { parseEventStream, SyncCoordinator } from "./sync";

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.loadSyncCursor.mockClear();
  storageMocks.saveSyncCursor.mockClear();
});

describe("parseEventStream", () => {
  it("handles events split across network chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: ready\ndata: {\"cursor\":0}\n\nevent: ch"));
        controller.enqueue(encoder.encode("ange\nid: 3\ndata: {\"seq\":3}\n\n"));
        controller.close();
      }
    });
    const events: Array<{ event: string; data: string; id: string }> = [];
    await parseEventStream(stream, (event) => { events.push(event); });
    expect(events).toEqual([
      { event: "ready", data: "{\"cursor\":0}", id: "" },
      { event: "change", data: "{\"seq\":3}", id: "3" }
    ]);
  });

  it("ignores heartbeat comments", async () => {
    const stream = new Response(": heartbeat\n\nevent: change\ndata: ok\n\n").body!;
    const events: string[] = [];
    await parseEventStream(stream, (event) => { events.push(event.data); });
    expect(events).toEqual(["ok"]);
  });

  it("delivers Hub commands without advancing the change cursor", async () => {
    const command = { type: "synchronize-local-hub", nodeId: "android-1" };
    const stream = new Response(
      `event: ready\ndata: {"cursor":0}\n\nevent: hub-command\ndata: ${JSON.stringify(command)}\n\n`
    ).body!;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    const received: Array<Record<string, unknown>> = [];
    let coordinator!: SyncCoordinator;
    const done = new Promise<void>((resolve) => {
      coordinator = new SyncCoordinator(
        {
          serverUrl: "http://127.0.0.1:4318",
          accessToken: "token",
          syncChanges: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false }))
        } as never,
        vi.fn(),
        "test-scope",
        vi.fn(),
        "android-1",
        async (value) => {
          received.push(value);
          coordinator.stop();
          resolve();
        }
      );
    });

    await coordinator.start();
    await done;

    expect(received).toEqual([command]);
    expect(storageMocks.saveSyncCursor).toHaveBeenCalledWith("test-scope", 0);
    expect(storageMocks.saveSyncCursor).toHaveBeenCalledTimes(1);
  });

  it("delivers cluster changes so the client can route immediately", async () => {
    const change = { state: "stable", activeNodeId: "android-1", epoch: 8 };
    const stream = new Response(
      `event: ready\ndata: {"cursor":0}\n\nevent: cluster-change\ndata: ${JSON.stringify(change)}\n\n`
    ).body!;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));

    const received: Array<Record<string, unknown>> = [];
    let coordinator!: SyncCoordinator;
    const done = new Promise<void>((resolve) => {
      coordinator = new SyncCoordinator(
        {
          serverUrl: "http://127.0.0.1:4318",
          accessToken: "token",
          syncChanges: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false }))
        } as never,
        vi.fn(),
        "cluster-scope",
        vi.fn(),
        "android-1",
        async (value) => {
          received.push(value);
          coordinator.stop();
          resolve();
        }
      );
    });

    await coordinator.start();
    await done;

    expect(received).toEqual([{ ...change, type: "cluster-change" }]);
  });

  it("keeps a command-only control channel without pulling business changes", async () => {
    const command = { type: "switch-desktop-hub", nodeId: "android-1" };
    const stream = new Response(
      `event: ready\ndata: {"cursor":42,"latestSequence":42}\n\nevent: hub-command\ndata: ${JSON.stringify(command)}\n\n`
    ).body!;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
    const syncChanges = vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false }));
    const received: Array<Record<string, unknown>> = [];
    let coordinator!: SyncCoordinator;
    const done = new Promise<void>((resolve) => {
      coordinator = new SyncCoordinator(
        {
          serverUrl: "http://127.0.0.1:4318",
          accessToken: "token",
          syncChanges
        } as never,
        vi.fn(),
        "control-scope",
        vi.fn(),
        "android-1",
        async (value) => {
          received.push(value);
          coordinator.stop();
          resolve();
        },
        { controlOnly: true }
      );
    });

    await coordinator.start();
    await done;

    expect(syncChanges).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("control_only=1");
    expect(received).toEqual([command]);
    expect(storageMocks.saveSyncCursor).toHaveBeenCalledWith("control-scope", 42);
  });

  it("polls queued Hub commands when an SSE proxy does not deliver stream data", async () => {
    const command = { commandId: "command-1", type: "switch-desktop-hub", nodeId: "android-1" };
    const syncCommands = vi.fn(async () => ({ commands: [command] }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream(), { status: 200 }));
    const received: Array<Record<string, unknown>> = [];
    let coordinator!: SyncCoordinator;
    const done = new Promise<void>((resolve) => {
      coordinator = new SyncCoordinator(
        {
          serverUrl: "https://hub.example.test",
          accessToken: "token",
          syncChanges: vi.fn(),
          syncCommands
        } as never,
        vi.fn(),
        "poll-control-scope",
        vi.fn(),
        "android-1",
        async (value) => {
          received.push(value);
          coordinator.stop();
          resolve();
        },
        { controlOnly: true }
      );
    });

    await coordinator.start();
    await done;

    expect(syncCommands).toHaveBeenCalledWith("android-1");
    expect(received).toEqual([command]);
  });
});
