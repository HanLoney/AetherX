<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EmptyState from "../components/EmptyState.vue";
import type { GalleryImage } from "../lib/api";
import { useDataStore } from "../stores/data";

type GalleryFilter = "all" | "chat" | "journal";

const data = useDataStore();
const images = computed(() => data.galleryAlbumImages.value);
const selected = ref<GalleryImage | null>(null);
const filter = ref<GalleryFilter>("all");
const loading = computed(() => data.galleryAlbumLoading.value && !images.value.length);
const error = ref("");
const total = computed(() => data.galleryAlbumTotal.value);
const pageIndex = ref(0);
const pageSize = 4;
const turnDirection = ref<"forward" | "backward">("forward");
let touchStartX = 0;
let touchStartY = 0;
let lastSwipeAt = 0;

const visible = computed(() => images.value.filter(
  (image) => filter.value === "all" || image.origin === filter.value
));

const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize)));
const pageImages = computed(() => visible.value.slice(
  pageIndex.value * pageSize,
  (pageIndex.value + 1) * pageSize
));
const pageLabel = computed(() => {
  const dates = pageImages.value.map((image) => validDate(image.createdAt)).filter(Boolean) as Date[];
  if (!dates.length) return "未记录时间";
  const newest = dates[0];
  const oldest = dates[dates.length - 1];
  const newestLabel = `${newest.getFullYear()} 年 ${newest.getMonth() + 1} 月`;
  const oldestLabel = `${oldest.getFullYear()} 年 ${oldest.getMonth() + 1} 月`;
  return newestLabel === oldestLabel ? newestLabel : `${newestLabel} — ${oldestLabel}`;
});

function validDate(value: number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: number) {
  const date = validDate(value);
  if (!date) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", ".");
}

function originLabel(image: GalleryImage) {
  return image.origin === "journal" ? "手记" : "对话";
}

function turnPage(offset: number) {
  const next = pageIndex.value + offset;
  if (next < 0 || next >= pageCount.value) return;
  turnDirection.value = offset > 0 ? "forward" : "backward";
  pageIndex.value = next;
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.changedTouches[0];
  touchStartX = touch?.clientX || 0;
  touchStartY = touch?.clientY || 0;
}

function handleTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (!touch) return;
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
  lastSwipeAt = Date.now();
  turnPage(deltaX < 0 ? 1 : -1);
}

function openImage(image: GalleryImage) {
  if (Date.now() - lastSwipeAt < 350) return;
  selected.value = image;
}

async function syncGallery() {
  error.value = "";
  try {
    await data.preloadGallery();
  } catch (reason) {
    error.value = (reason as Error).message || "相册暂时没有打开。";
  }
}

onMounted(syncGallery);
watch(filter, () => { pageIndex.value = 0; });
watch(pageCount, (count) => {
  if (pageIndex.value >= count) pageIndex.value = count - 1;
});
</script>

<template>
  <AppShell title="" headerless>
    <div class="gallery-heading">
      <div class="gallery-tabs" aria-label="相册来源筛选">
        <button
          v-for="item in [{id:'all',label:'全部'},{id:'chat',label:'对话'},{id:'journal',label:'手记'}]"
          :key="item.id"
          type="button"
          :class="{ active: filter === item.id }"
          @click="filter = item.id as GalleryFilter"
        >{{ item.label }}</button>
      </div>
      <span>{{ loading ? `正在同步 ${images.length} / ${total || '…'}` : `共 ${total} 张` }}</span>
    </div>

    <section class="album-shell">
      <div class="album-binding" aria-hidden="true"><i/><i/><i/><i/><i/></div>
      <div
        class="album-page"
        @touchstart.passive="handleTouchStart"
        @touchend.passive="handleTouchEnd"
      >
        <span class="album-page-mark">AETHERX<br>MEMORIES</span>

        <EmptyState
          v-if="!loading && !visible.length"
          :title="images.length ? '这一页还没有对应的画面' : '相册还在等待第一张画面'"
          :description="error || (images.length ? '换一个分类继续翻阅吧。' : '以后一起看见的风景，会慢慢出现在这里。')"
        />

        <div v-else class="gallery-grid">
          <Transition :name="`gallery-turn-${turnDirection}`" mode="out-in">
          <section :key="`${filter}-${pageIndex}`" class="gallery-month">
            <header><h2>{{ pageLabel }}</h2></header>
            <div class="gallery-month-grid">
              <button
                v-for="(item,index) in pageImages"
                :key="item.id"
                type="button"
                :class="['gallery-item',`gallery-tilt-${index % 4}`]"
                @click="openImage(item)"
              >
                <span class="gallery-photo">
                  <img loading="lazy" :src="item.source" :alt="`${originLabel(item)}留影`" />
                  <i :class="`gallery-badge gallery-badge-${item.origin}`">{{ originLabel(item) }}</i>
                </span>
                <time :datetime="validDate(item.createdAt)?.toISOString()">{{ formatDate(item.createdAt) }}</time>
              </button>
            </div>
          </section>
          </Transition>
        </div>

        <footer class="gallery-status" role="status">
          <span v-if="loading">已同步 {{ images.length }} / {{ total || '…' }} 张</span>
          <button v-else-if="error" type="button" @click="syncGallery">重新同步</button>
          <nav v-else-if="visible.length" aria-label="相册翻页">
            <button type="button" aria-label="上一页" :disabled="pageIndex === 0" @click="turnPage(-1)"><ChevronLeft :size="16" /></button>
            <span>第 {{ pageIndex + 1 }} / {{ pageCount }} 页</span>
            <button type="button" aria-label="下一页" :disabled="pageIndex >= pageCount - 1" @click="turnPage(1)"><ChevronRight :size="16" /></button>
          </nav>
        </footer>
      </div>
    </section>

    <Transition name="fade">
      <div v-if="selected" class="gallery-lightbox" role="dialog" aria-modal="true" @click.self="selected = null">
        <button type="button" aria-label="关闭大图" @click="selected = null"><X :size="20" /></button>
        <figure>
          <img :src="selected.originalSource || selected.source" :alt="`${originLabel(selected)}留影`" />
          <figcaption>{{ originLabel(selected) }}留影 · {{ formatDate(selected.createdAt) }}</figcaption>
        </figure>
      </div>
    </Transition>
  </AppShell>
</template>

<style scoped>
.gallery-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:calc(env(safe-area-inset-top) + 14px) 6px 14px}.gallery-heading>span{color:var(--muted);font-size: calc(9px * var(--font-scale, 1));white-space:nowrap}
.gallery-tabs{display:flex;gap:4px;padding:4px;border-radius:12px;background:rgba(234,235,244,.72)}.gallery-tabs button{min-height:29px;padding:0 11px;border:0;border-radius:9px;color:#8e8796;background:transparent;font-size: calc(9px * var(--font-scale, 1))}.gallery-tabs button.active{color:#617da4;background:rgba(255,255,255,.92);box-shadow:0 4px 12px rgba(93,91,122,.08)}
.album-shell{position:relative;padding:12px 10px 12px 31px;border:1px solid rgba(112,105,137,.16);border-radius:18px 34px 34px 18px;background:linear-gradient(90deg,rgba(81,72,105,.22),transparent 30px),linear-gradient(145deg,#bfc3d9,#d6c9d7 48%,#aec9df);box-shadow:13px 24px 54px rgba(74,68,94,.17),inset 0 1px rgba(255,255,255,.58)}
.album-shell::before{content:"";position:absolute;inset:10px auto 10px 22px;width:1px;background:rgba(66,61,84,.2);box-shadow:4px 0 rgba(255,255,255,.18)}
.album-binding{position:absolute;z-index:3;inset:25px auto 25px 12px;display:flex;flex-direction:column;justify-content:space-around;pointer-events:none}.album-binding i{width:29px;height:6px;border:2px solid rgba(74,69,88,.52);border-left:0;border-radius:0 999px 999px 0;background:linear-gradient(180deg,#f2edf2,#9f9aa9 52%,#f7f4f7);box-shadow:0 2px 3px rgba(51,47,65,.2)}
.album-page{position:relative;height:550px;overflow:hidden;padding:35px 14px 64px;border-radius:10px 27px 27px 10px;touch-action:pan-y;background:radial-gradient(circle at 2px 2px,rgba(106,96,121,.055) 1px,transparent 1.2px) 0 0/18px 18px,linear-gradient(135deg,rgba(236,214,224,.18),transparent 35%,rgba(194,222,237,.16)),#fbf8f2;box-shadow:inset 8px 0 17px rgba(83,77,98,.07),0 6px 18px rgba(66,60,83,.11)}
.album-page-mark{position:absolute;top:13px;right:18px;color:rgba(105,97,121,.24);font:700 7px/1.25 Georgia,serif;letter-spacing:.14em;text-align:right}
.gallery-grid{position:relative;z-index:1}.gallery-month>header{display:flex;align-items:baseline;gap:9px;margin-bottom:18px}.gallery-month h2{margin:0;color:#4b4656;font:500 18px/1.2 Georgia,serif;letter-spacing:.03em}.gallery-month header span{color:#a096a4;font-size: calc(8px * var(--font-scale, 1))}
.gallery-month-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:21px 13px}.gallery-item{min-width:0;display:grid;gap:9px;padding:6px 6px 9px;border:1px solid rgba(130,117,119,.12);border-radius:2px;background:#fffdfa;box-shadow:3px 8px 18px rgba(76,68,80,.13),0 1px rgba(255,255,255,.9) inset;text-align:left}.gallery-tilt-0{transform:rotate(-1.4deg)}.gallery-tilt-1{transform:rotate(1.1deg) translateY(4px)}.gallery-tilt-2{transform:rotate(-.5deg) translateY(-2px)}.gallery-tilt-3{transform:rotate(1.5deg)}
.gallery-photo{position:relative;aspect-ratio:3/4;overflow:hidden;background:#e9e5e5}.gallery-photo img{width:100%;height:100%;display:block;object-fit:cover;filter:saturate(.96) contrast(.98)}.gallery-badge{position:absolute;top:6px;left:6px;padding:2px 7px;border-radius:999px;color:#fff;font-size: calc(8px * var(--font-scale, 1));font-style:normal;backdrop-filter:blur(4px)}.gallery-badge-chat{background:rgba(97,125,164,.82)}.gallery-badge-journal{background:rgba(197,121,158,.82)}.gallery-item time{padding:0 2px;color:#9a919b;font:8px/1.2 Georgia,serif;letter-spacing:.03em}
.gallery-status{position:absolute;z-index:2;right:14px;bottom:18px;left:14px;min-height:34px;display:grid;place-items:center;color:#9a919f;font-size: calc(8px * var(--font-scale, 1))}.gallery-status>button{min-height:31px;padding:0 15px;border:1px solid rgba(105,126,160,.16);border-radius:999px;color:#667fa4;background:rgba(255,255,255,.74)}.gallery-status nav{display:flex;align-items:center;justify-content:center;gap:12px}.gallery-status nav button{width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid rgba(105,126,160,.16);border-radius:50%;color:#667fa4;background:rgba(255,255,255,.74)}.gallery-status nav button:disabled{opacity:.3}.gallery-status nav span{min-width:62px;text-align:center}
.gallery-turn-forward-enter-active,.gallery-turn-forward-leave-active,.gallery-turn-backward-enter-active,.gallery-turn-backward-leave-active{transition:opacity .16s ease,transform .2s ease}.gallery-turn-forward-enter-from{opacity:0;transform:translateX(28px) rotateY(-4deg)}.gallery-turn-forward-leave-to{opacity:0;transform:translateX(-28px) rotateY(4deg)}.gallery-turn-backward-enter-from{opacity:0;transform:translateX(-28px) rotateY(4deg)}.gallery-turn-backward-leave-to{opacity:0;transform:translateX(28px) rotateY(-4deg)}
.gallery-lightbox{position:fixed;z-index:60;inset:0;display:grid;place-items:center;padding:58px 20px calc(30px + env(safe-area-inset-bottom));background:rgba(28,24,38,.74);backdrop-filter:blur(10px)}.gallery-lightbox>button{position:absolute;top:max(18px,env(safe-area-inset-top));right:18px;width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:50%;color:#fff;background:rgba(255,255,255,.14)}.gallery-lightbox figure{max-width:620px;max-height:100%;display:grid;gap:10px;justify-items:center;margin:0}.gallery-lightbox img{max-width:100%;max-height:76dvh;display:block;border-radius:14px;object-fit:contain;box-shadow:0 24px 60px rgba(0,0,0,.4)}.gallery-lightbox figcaption{color:rgba(255,255,255,.88);font-size: calc(10px * var(--font-scale, 1));text-align:center}
</style>
