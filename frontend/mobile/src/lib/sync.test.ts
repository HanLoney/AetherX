import { describe, expect, it } from "vitest";
import { parseEventStream } from "./sync";

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
});
