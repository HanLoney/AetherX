import { describe, expect, it } from "vitest";
import { GalleryOriginalLoader, type GalleryPreloadImage } from "./gallery-original-loader";

describe("gallery original loader", () => {
  it("limits background loads and promotes a selected image", async () => {
    const created: GalleryPreloadImage[] = [];
    const ready: string[] = [];
    const loader = new GalleryOriginalLoader(
      (source) => ready.push(source),
      1,
      () => {
        const image: GalleryPreloadImage = { decoding: "auto", onload: null, onerror: null, src: "" };
        created.push(image);
        return image;
      }
    );

    const first = loader.load("original-1");
    const second = loader.load("original-2");
    const third = loader.load("original-3");
    expect(created.map((image) => image.src)).toEqual(["original-1"]);
    expect(created[0].fetchPriority).toBe("low");

    expect(loader.load("original-3", true)).toBe(third);
    expect(created.map((image) => image.src)).toEqual(["original-1", "original-3"]);
    expect(created[1].fetchPriority).toBe("high");

    created[1].onload?.call({} as GlobalEventHandlers, {} as Event);
    await third;
    expect(created.map((image) => image.src)).toEqual(["original-1", "original-3"]);

    expect(loader.load("original-1", true)).toBe(first);
    expect(created[0].fetchPriority).toBe("high");
    created[0].onload?.call({} as GlobalEventHandlers, {} as Event);
    await first;
    expect(created.map((image) => image.src)).toEqual(["original-1", "original-3", "original-2"]);

    created[2].onerror?.call({} as GlobalEventHandlers, {} as Event);
    await second;
    expect(ready).toEqual(["original-3", "original-1"]);
    expect(loader.isReady("original-2")).toBe(false);
    expect(loader.isReady("original-3")).toBe(true);
  });
});
