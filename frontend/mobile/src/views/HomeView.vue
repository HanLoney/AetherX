<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, BookOpenText, Images, MessageCircle, Sprout } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import AvatarCropper from "../components/AvatarCropper.vue";
import ConnectionPill from "../components/ConnectionPill.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { useDataStore } from "../stores/data";

const router = useRouter();
const data = useDataStore();
const assistantCropper = ref<{ choose: () => void; complete: () => void } | null>(null);
const avatarSaving = ref(false);
const avatarError = ref("");
const assistantName = computed(() => String(data.assistant.value.name || "小玄"));
const assistantAvatar = computed(() => String(data.assistant.value.avatarDataUrl || ""));
const relationship = computed(() => String(
  data.assistant.value.relationshipSummary
  || data.assistant.value.selfDefinition
  || "陪你一起生活的数字伙伴"
));
const recentJournal = computed(() => data.journals.value[0]);
const recentJournalExcerpt = computed(() => String(recentJournal.value?.content || "")
  .replace(/!\[[^\]]*]\(data:image\/[^)]+\)/g, "")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/[*_~`>]/g, "")
  .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
  .replace(/\s+/g, " ")
  .trim());

async function saveAssistantAvatar(avatarDataUrl: string) {
  if (avatarSaving.value) return;
  avatarSaving.value = true;
  avatarError.value = "";
  try {
    await data.updateAssistantProfile({ avatarDataUrl });
    assistantCropper.value?.complete();
  } catch (reason) {
    avatarError.value = (reason as Error).message || "头像暂时没有保存成功。";
  } finally {
    avatarSaving.value = false;
  }
}

</script>

<template>
  <AppShell :title="assistantName" headerless quiet>
    <section class="companion-stage">
      <i class="stage-orbit stage-orbit-pink" aria-hidden="true" />
      <i class="stage-orbit stage-orbit-blue" aria-hidden="true" />
      <div class="card-sync">
        <ConnectionPill />
      </div>

      <div class="companion-profile">
        <button class="avatar-orbit" type="button" aria-label="更换小玄头像" :disabled="avatarSaving" @click="assistantCropper?.choose()">
          <ProfileAvatar :name="assistantName" :src="assistantAvatar" size="large" />
        </button>
        <div class="hero-copy">
          <h1>{{ assistantName }}</h1>
          <p>{{ relationship }}</p>
          <div class="hero-actions">
            <button class="chat-entry" aria-label="进入聊天" @click="router.push('/chat')">
              <MessageCircle :size="14" />
              <strong>开始聊天</strong>
              <ArrowRight :size="14" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <nav class="home-portals" aria-label="陪伴空间入口">
      <button type="button" @click="router.push('/journals')">
        <i><BookOpenText :size="17" /></i>
        <span><strong>手记</strong><small>她写下的日常</small></span>
      </button>
      <button type="button" @click="router.push('/gallery')">
        <i><Images :size="17" /></i>
        <span><strong>相册</strong><small>一起收藏的画面</small></span>
      </button>
      <button type="button" @click="router.push('/memories')">
        <i><Sprout :size="17" /></i>
        <span><strong>成长</strong><small>慢慢成为的她</small></span>
      </button>
    </nav>

    <div class="home-mosaic">
      <button class="journal-sheet" type="button" aria-label="浏览全部手记" @click="router.push('/journals')">
        <header>
          <div>
            <small>最近手记</small>
            <h2>{{ recentJournal?.title || "她还没有写下第一篇手记" }}</h2>
          </div>
          <span>{{ recentJournal ? (recentJournal.type === "daily" ? "日记" : "周记") : "翻开" }}</span>
        </header>
        <p v-if="recentJournal">{{ recentJournalExcerpt || "这一页留下了一些不适合匆匆读完的话。" }}</p>
        <p v-else class="journal-empty">等故事积攒得再多一点，这张纸会自然写满。</p>
        <footer>
          <span>{{ recentJournal?.periodKey || "手记本" }}</span>
          <i>{{ recentJournal?.mood || "去翻阅全部" }} <ArrowRight :size="13" /></i>
        </footer>
      </button>

      <section class="gallery-stack" aria-label="最近画面">
        <header>
          <div><small>最近画面</small><h2>她眼里的片刻</h2></div>
          <span>{{ data.galleryTotal.value }} 张</span>
        </header>

        <div v-if="data.galleryImages.value.length" class="gallery-photos">
          <figure
            v-for="(image, index) in data.galleryImages.value"
            :key="image.id"
            :class="`photo-${index + 1}`"
          >
            <img :src="image.source" alt="小玄最近留下的画面" />
          </figure>
        </div>
        <div v-else class="gallery-empty">
          <i /><i /><i />
          <p>新的画面会在这里慢慢显影。</p>
        </div>
      </section>

    </div>
    <AvatarCropper
      ref="assistantCropper"
      subject="小玄头像"
      :saving="avatarSaving"
      :error="avatarError"
      @clear-error="avatarError = ''"
      @confirm="saveAssistantAvatar"
    />
  </AppShell>
</template>

<style scoped>
:global(:root) {
  --home-module-gap: 16px;
  --home-module-padding: 18px;
}

.companion-stage {
  position: relative;
  min-height: 168px;
  overflow: hidden;
  margin-top: calc(env(safe-area-inset-top) + 14px);
  padding: 22px 18px;
  border: 1px solid rgba(255,255,255,.9);
  border-radius: 36px 36px 36px 14px;
  background:
    linear-gradient(128deg,rgba(255,255,255,.88),rgba(246,248,253,.62)),
    radial-gradient(circle at 100% 0%,rgba(var(--blue-rgb),.22),transparent 46%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.98),
    0 24px 60px rgba(75,69,102,.12);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
}

.stage-orbit {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.stage-orbit-pink {
  width: 180px;
  height: 180px;
  left: -95px;
  bottom: -105px;
  background: radial-gradient(circle,rgba(var(--pink-rgb),.26),transparent 68%);
}

.stage-orbit-blue {
  width: 230px;
  height: 230px;
  right: -110px;
  top: -130px;
  border: 1px solid rgba(var(--blue-rgb),.16);
  box-shadow: 0 0 0 25px rgba(var(--blue-rgb),.035);
}

.card-sync {
  position: absolute;
  z-index: 2;
  top: 15px;
  right: 17px;
}

.card-sync :deep(.connection-pill) {
  min-height: 25px;
  gap: 4px;
  padding: 0 8px;
  border-color: rgba(132,126,158,.1);
  background: rgba(255,255,255,.48);
  font-size: calc(8px * var(--font-scale, 1));
  backdrop-filter: blur(10px);
}

.companion-profile {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 16px;
}

.avatar-orbit {
  position: relative;
  display: block;
  padding: 4px;
  border: 1px solid rgba(var(--pink-rgb),.22);
  border-radius: 30px;
  background: rgba(255,255,255,.46);
  box-shadow: inset 0 1px rgba(255,255,255,.82),0 11px 25px rgba(93,78,116,.12);
}

.avatar-orbit:disabled { opacity: .65; }

.avatar-orbit :deep(.avatar-large) {
  width: 82px;
  height: 82px;
  border-radius: 26px;
  box-shadow: none;
}

.hero-copy {
  min-width: 0;
}

.hero-copy h1 {
  overflow: hidden;
  margin: 0;
  font-size: calc(32px * var(--font-scale, 1));
  letter-spacing: -.07em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-actions {
  display: flex;
  align-items: center;
  margin-top: 13px;
}

.hero-copy p {
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--soft-ink);
  font-size: calc(11px * var(--font-scale, 1));
  line-height: 1.55;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-entry {
  flex: 0 0 auto;
  width: fit-content;
  min-height: 33px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid rgba(132,126,158,.11);
  border-radius: 12px;
  color: #716b83;
  text-align: left;
  background: linear-gradient(125deg,rgba(var(--pink-rgb),.13),rgba(var(--blue-rgb),.16));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.72),0 8px 18px rgba(92,84,123,.08);
}

.chat-entry strong {
  font-size: calc(9px * var(--font-scale, 1));
  letter-spacing: .02em;
}

@media (max-width: 350px) {
  .companion-stage {
    padding-inline: 15px;
  }

  .companion-profile {
    gap: 12px;
  }

  .hero-copy h1 {
    font-size: calc(28px * var(--font-scale, 1));
  }

  .chat-entry {
    padding-inline: 8px;
  }
}

.home-portals {
  display: grid;
  grid-template-columns: repeat(3,minmax(0,1fr));
  gap: 8px;
  margin-top: var(--home-module-gap);
}

.home-portals button {
  min-width: 0;
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 9px;
  border: 1px solid rgba(255,255,255,.78);
  border-radius: 19px 19px 19px 8px;
  color: #716b80;
  background: linear-gradient(145deg,rgba(255,255,255,.65),rgba(248,247,252,.42));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.86),0 10px 24px rgba(74,68,98,.07);
  text-align: left;
  backdrop-filter: blur(14px);
}

.home-portals button:nth-child(2) {
  border-radius: 19px;
}

.home-portals button:nth-child(3) {
  border-radius: 19px 19px 8px 19px;
}

.home-portals i {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: #9a7294;
  background: linear-gradient(135deg,rgba(var(--pink-rgb),.16),rgba(var(--blue-rgb),.17));
}

.home-portals span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.home-portals strong {
  font-size: calc(11px * var(--font-scale, 1));
}

.home-portals small {
  overflow: hidden;
  color: var(--muted);
  font-size: calc(7px * var(--font-scale, 1));
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 370px) {
  .home-portals button {
    justify-content: center;
    padding-inline: 5px;
  }

  .home-portals small {
    display: none;
  }
}

.home-mosaic {
  display: grid;
  gap: var(--home-module-gap);
  margin-top: var(--home-module-gap);
  padding-bottom: 6px;
}

.journal-sheet {
  width: 100%;
  display: block;
  position: relative;
  min-height: 174px;
  overflow: hidden;
  padding: var(--home-module-padding) var(--home-module-padding) 16px 23px;
  border: 1px solid rgba(233,226,220,.9);
  border-radius: 12px 30px 30px 12px;
  background:
    repeating-linear-gradient(180deg,transparent 0,transparent 31px,rgba(125,144,167,.075) 32px),
    linear-gradient(120deg,#fffdfb,#fbfbfd);
  box-shadow: 0 18px 42px rgba(73,68,94,.08);
  color: inherit;
  text-align: left;
}

.journal-sheet::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 6px;
  background: linear-gradient(180deg,#e6a3c0,#a7cbea);
}

.journal-sheet header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.journal-sheet header > div {
  min-width: 0;
}

.journal-sheet small {
  color: #a17c97;
  font-size: calc(9px * var(--font-scale, 1));
  font-weight: 700;
}

.journal-sheet h2 {
  overflow: hidden;
  margin: 5px 0 0;
  font-size: calc(17px * var(--font-scale, 1));
  letter-spacing: -.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journal-sheet header > span {
  flex: 0 0 auto;
  margin-left: 14px;
  padding: 4px 8px;
  border-radius: 999px;
  color: #9b7897;
  background: rgba(var(--pink-rgb),.1);
  font-size: calc(8px * var(--font-scale, 1));
}

.journal-sheet > p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  margin: 15px 0 0;
  color: #696273;
  font-size: calc(11px * var(--font-scale, 1));
  line-height: 1.85;
}

.journal-sheet > p.journal-empty {
  color: var(--muted);
}

.journal-sheet footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  color: var(--muted);
  font-size: calc(8px * var(--font-scale, 1));
}

.journal-sheet footer i {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-style: normal;
}

.gallery-stack {
  position: relative;
  min-height: 188px;
  padding: var(--home-module-padding) 8px 4px;
}

.gallery-stack header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.gallery-stack header {
  align-items: flex-end;
  padding: 0 7px;
}

.gallery-stack small {
  color: #a17c97;
  font-size: calc(9px * var(--font-scale, 1));
  font-weight: 700;
}

.gallery-stack h2 {
  margin: 5px 0 0;
  font-size: calc(17px * var(--font-scale, 1));
  letter-spacing: -.04em;
}

.gallery-stack header > span {
  color: var(--muted);
  font-size: calc(9px * var(--font-scale, 1));
}

.gallery-photos {
  height: 142px;
  display: grid;
  grid-template-columns: repeat(3,1fr);
  align-items: end;
  gap: 0;
  padding: 8px 13px 0;
}

.gallery-photos figure {
  position: relative;
  z-index: 1;
  height: 119px;
  overflow: hidden;
  margin: 0 -5px;
  padding: 5px 5px 17px;
  border: 1px solid rgba(227,221,226,.9);
  border-radius: 3px;
  background: #fffdfc;
  box-shadow: 0 14px 26px rgba(73,67,94,.15);
  transform-origin: center bottom;
}

.gallery-photos figure.photo-1 {
  z-index: 1;
  transform: rotate(-6deg) translateY(7px);
}

.gallery-photos figure.photo-2 {
  z-index: 2;
  transform: rotate(2deg) translateY(-1px);
}

.gallery-photos figure.photo-3 {
  z-index: 1;
  transform: rotate(6deg) translateY(8px);
}

.gallery-photos img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.gallery-empty {
  height: 134px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 5px;
  color: var(--muted);
}

.gallery-empty > i {
  width: 42px;
  height: 58px;
  border: 1px solid rgba(128,116,145,.13);
  border-radius: 3px;
  background: rgba(255,255,255,.45);
  box-shadow: 0 9px 20px rgba(75,69,100,.07);
  transform: rotate(-6deg);
}

.gallery-empty > i:nth-child(2) {
  transform: translateY(-5px);
}

.gallery-empty > i:nth-child(3) {
  transform: rotate(6deg);
}

.gallery-empty p {
  position: absolute;
  bottom: 2px;
  margin: 0;
  font-size: calc(9px * var(--font-scale, 1));
}

</style>
