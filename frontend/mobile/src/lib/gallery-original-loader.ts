export interface GalleryPreloadImage {
  decoding: string;
  fetchPriority?: "high" | "low" | "auto";
  onload: ((this: GlobalEventHandlers, event: Event) => unknown) | null;
  onerror: ((this: GlobalEventHandlers, event: Event | string) => unknown) | null;
  src: string;
}

interface OriginalLoadJob {
  source: string;
  priority: boolean;
  promise: Promise<boolean>;
  resolve: (loaded: boolean) => void;
}

export class GalleryOriginalLoader {
  private readonly ready = new Set<string>();
  private readonly pending = new Map<string, OriginalLoadJob>();
  private readonly queue: OriginalLoadJob[] = [];
  private readonly activeImages = new Map<string, GalleryPreloadImage>();
  private active = 0;

  constructor(
    private readonly onReady: (source: string) => void = () => undefined,
    private readonly concurrency = 2,
    private readonly createImage: () => GalleryPreloadImage = () => new Image()
  ) {}

  isReady(source: string) {
    return this.ready.has(source);
  }

  load(source: string, priority = false) {
    const normalized = String(source || "").trim();
    if (!normalized) return Promise.resolve(false);
    if (this.ready.has(normalized)) return Promise.resolve(true);

    const existing = this.pending.get(normalized);
    if (existing) {
      if (priority) {
        existing.priority = true;
        const activeImage = this.activeImages.get(normalized);
        if (activeImage) activeImage.fetchPriority = "high";
        else this.prioritize(existing);
        this.pump();
      }
      return existing.promise;
    }

    let resolve: (loaded: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((complete) => { resolve = complete; });
    const job = { source: normalized, priority, promise, resolve };
    this.pending.set(normalized, job);
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return promise;
  }

  private prioritize(job: OriginalLoadJob) {
    const index = this.queue.indexOf(job);
    if (index <= 0) return;
    this.queue.splice(index, 1);
    this.queue.unshift(job);
  }

  private pump() {
    const limit = Math.max(1, this.concurrency);
    while (this.queue.length) {
      const priorityIndex = this.queue.findIndex((job) => job.priority);
      const foregroundSlotAvailable = priorityIndex >= 0 && this.active < limit + 1;
      if (this.active >= limit && !foregroundSlotAvailable) return;
      const nextIndex = priorityIndex >= 0 ? priorityIndex : 0;
      const [job] = this.queue.splice(nextIndex, 1);
      if (!job) return;
      this.active += 1;
      const image = this.createImage();
      image.decoding = "async";
      image.fetchPriority = job.priority ? "high" : "low";
      this.activeImages.set(job.source, image);
      let settled = false;
      const finish = (loaded: boolean) => {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        if (loaded) this.ready.add(job.source);
        this.activeImages.delete(job.source);
        this.pending.delete(job.source);
        this.active -= 1;
        job.resolve(loaded);
        if (loaded) this.onReady(job.source);
        this.pump();
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = job.source;
    }
  }
}
