<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ArrowUpRight, BrainCircuit, CalendarDays, MessageCircle, Sparkles } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import ConnectionPill from "../components/ConnectionPill.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { useDataStore } from "../stores/data";

const router = useRouter();
const data = useDataStore();
const assistantName = computed(() => String(data.assistant.value.name || "小玄"));
const assistantAvatar = computed(() => String(data.assistant.value.avatarDataUrl || ""));
const relationship = computed(() => String(data.assistant.value.relationshipSummary || data.assistant.value.selfDefinition || "陪你一起生活的数字伙伴"));
const recentTodos = computed(() => data.activeTodos.value.slice(0, 3));
const recentMemory = computed(() => data.memories.value[0]);

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
</script>

<template>
  <AppShell title="只属于你们的空间" kicker="AETHERX · PERSONAL SPACE">
    <template #header><ConnectionPill /></template>

    <section class="companion-hero">
      <div class="hero-rings" aria-hidden="true"><i /><i /><i /></div>
      <ProfileAvatar :name="assistantName" :src="assistantAvatar" size="large" />
      <div class="hero-copy">
        <span>DIGITAL COMPANION</span>
        <h2>{{ assistantName }}</h2>
        <p>{{ relationship }}</p>
      </div>
      <button aria-label="开始聊天" @click="router.push('/chat')"><MessageCircle :size="20" /><ArrowUpRight :size="15" /></button>
    </section>

    <section class="day-ribbon">
      <div><span>还在心上的事</span><strong>{{ data.activeTodos.value.length }}</strong><small>项待办</small></div>
      <i />
      <div><span>被记住的片刻</span><strong>{{ data.memories.value.length }}</strong><small>条记忆</small></div>
    </section>

    <div class="section-label"><h2>今天的节奏</h2><button @click="router.push('/todos')">查看全部</button></div>
    <section class="timeline" @click="router.push('/todos')">
      <template v-if="recentTodos.length">
        <article v-for="todo in recentTodos" :key="todo.id">
          <time>{{ timeLabel(todo.startAt) }}</time><i /><span>{{ todo.text }}</span>
        </article>
      </template>
      <div v-else class="timeline-empty"><CalendarDays :size="19" /><span>今天没有赶着做的事，慢一点也很好。</span></div>
    </section>

    <div class="section-label"><h2>记忆的回声</h2><button @click="router.push('/memories')">走进记忆中心</button></div>
    <section class="memory-note" @click="router.push('/memories')">
      <div class="note-mark"><BrainCircuit :size="21" /></div>
      <template v-if="recentMemory">
        <div><span>{{ recentMemory.domain }} · {{ recentMemory.type }}</span><p>{{ recentMemory.content }}</p></div>
      </template>
      <div v-else><span>MEMORY ARCHIVE</span><p>故事还没有写进来，等你们慢慢把这里填满。</p></div>
      <Sparkles class="note-spark" :size="30" />
    </section>
  </AppShell>
</template>

<style scoped>
.companion-hero { position: relative; min-height: 210px; overflow: hidden; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 20px; padding: 30px 24px; border: 1px solid rgba(255,255,255,.86); border-radius: 38px 38px 38px 12px; background: linear-gradient(120deg,rgba(255,255,255,.84),rgba(245,247,253,.65)); box-shadow: var(--shadow); backdrop-filter: blur(22px); }
.hero-copy { position: relative; min-width: 0; z-index: 1; }
.hero-copy > span { color: #a17a9e; font-size: 9px; font-weight: 800; letter-spacing: .18em; }
.hero-copy h2 { margin: 7px 0 5px; font-size: 31px; letter-spacing: -.06em; }
.hero-copy p { max-width: 230px; margin: 0; color: var(--soft-ink); font-size: 11px; line-height: 1.65; }
.companion-hero > button { position: absolute; right: 18px; bottom: 18px; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; gap: 2px; border: 0; border-radius: 50%; color: #fff; background: linear-gradient(135deg,#cb8cad,#79a9d2); box-shadow: 0 11px 28px rgba(129,112,160,.25); }
.hero-rings { position: absolute; width: 210px; height: 210px; right: -80px; top: -70px; opacity: .52; }
.hero-rings i { position: absolute; inset: 0; border: 1px solid rgba(var(--blue-rgb),.22); border-radius: 50%; }
.hero-rings i:nth-child(2) { inset: 24px; }.hero-rings i:nth-child(3) { inset: 50px; background: rgba(var(--blue-rgb),.09); }
.day-ribbon { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin: 16px 7px 0; padding: 18px 10px; border-block: 1px solid var(--line); }
.day-ribbon > div { display: grid; grid-template-columns: auto auto; align-items: baseline; justify-content: center; column-gap: 6px; text-align: center; }
.day-ribbon span { grid-column: 1 / -1; margin-bottom: 4px; color: var(--muted); font-size: 9px; }
.day-ribbon strong { font-family: Georgia,serif; font-size: 27px; font-weight: 500; }.day-ribbon small { color: var(--soft-ink); font-size: 9px; }
.day-ribbon > i { width: 1px; height: 38px; background: var(--line); }
.timeline { padding: 8px 3px; cursor: pointer; }
.timeline article { min-height: 47px; display: grid; grid-template-columns: 50px 13px 1fr; align-items: center; gap: 8px; position: relative; }
.timeline article:not(:last-child)::after { content:""; position:absolute; left:64px; top:29px; bottom:-18px; width:1px; background:linear-gradient(rgba(var(--pink-rgb),.36),rgba(var(--blue-rgb),.2)); }
.timeline time { color: #878193; font-family: Georgia,serif; font-size: 13px; }.timeline article > i { z-index:1; width:9px; height:9px; border:2px solid #fff; border-radius:50%; background:linear-gradient(135deg,var(--pink),var(--blue)); box-shadow:0 0 0 4px rgba(var(--pink-rgb),.1); }.timeline article > span { padding: 12px 15px; border-radius: 16px; background: rgba(255,255,255,.55); font-size: 12px; }
.timeline-empty { display:flex; align-items:center; gap:11px; padding:18px; color:var(--muted); border:1px dashed rgba(121,112,149,.18); border-radius:18px; font-size:11px; }
.memory-note { position:relative; min-height:130px; overflow:hidden; display:grid; grid-template-columns:auto 1fr; align-items:center; gap:16px; padding:22px 20px; border-radius:12px 32px 32px 12px; color:#fff; background:linear-gradient(118deg,#8d82a3,#888db3 55%,#73a5ca); box-shadow:0 20px 46px rgba(93,88,131,.22); cursor:pointer; }
.note-mark { width:49px;height:49px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.3);border-radius:50%;background:rgba(255,255,255,.08); }.memory-note span{font-size:9px;font-weight:800;letter-spacing:.13em;opacity:.75}.memory-note p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;margin:6px 0 0;font-size:13px;line-height:1.65}.note-spark{position:absolute;right:16px;bottom:13px;opacity:.16}
</style>
