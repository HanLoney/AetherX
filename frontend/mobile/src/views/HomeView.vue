<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, BrainCircuit, CalendarDays, MessageCircle, Sparkles } from "@lucide/vue";
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
  <AppShell :title="`和 ${assistantName} 在一起`" kicker="AETHERX · PERSONAL SPACE">
    <template #header><ConnectionPill /></template>

    <section class="companion-hero">
      <div class="hero-glow" aria-hidden="true" />
      <div class="companion-profile">
        <div class="avatar-orbit">
          <ProfileAvatar :name="assistantName" :src="assistantAvatar" size="large" />
          <i aria-hidden="true" />
        </div>
        <div class="hero-copy">
          <span>YOUR DIGITAL COMPANION</span>
          <h2>{{ assistantName }}</h2>
          <p>{{ relationship }}</p>
        </div>
      </div>

      <button class="chat-entry" aria-label="进入聊天" @click="router.push('/chat')">
        <i><MessageCircle :size="21" /></i>
        <span><small>继续你们的对话</small><strong>去找 {{ assistantName }}</strong></span>
        <ArrowRight :size="20" />
      </button>
    </section>

    <section class="space-pulse" aria-label="空间概览">
      <div>
        <span>还在心上的事</span>
        <p><strong>{{ data.activeTodos.value.length }}</strong><small>项待办</small></p>
      </div>
      <div>
        <span>被记住的片刻</span>
        <p><strong>{{ data.memories.value.length }}</strong><small>条记忆</small></p>
      </div>
    </section>

    <div class="home-sections">
      <section class="rhythm-panel">
        <header class="panel-heading">
          <div><span>TODAY</span><h2>今天的节奏</h2></div>
          <button aria-label="查看全部待办" @click="router.push('/todos')"><ArrowRight :size="17" /></button>
        </header>
        <div class="timeline" @click="router.push('/todos')">
          <template v-if="recentTodos.length">
            <article v-for="todo in recentTodos" :key="todo.id">
              <time>{{ timeLabel(todo.startAt) }}</time><i /><span>{{ todo.text }}</span>
            </article>
          </template>
          <div v-else class="timeline-empty"><CalendarDays :size="19" /><span>没有赶着做的事，慢一点也很好。</span></div>
        </div>
      </section>

      <section class="memory-note" @click="router.push('/memories')">
        <header><span>MEMORY ECHO</span><ArrowRight :size="17" /></header>
        <div class="memory-body">
          <div class="note-mark"><BrainCircuit :size="20" /></div>
          <template v-if="recentMemory">
            <div><small>{{ recentMemory.domain }} · {{ recentMemory.type }}</small><p>{{ recentMemory.content }}</p></div>
          </template>
          <div v-else><small>记忆档案</small><p>故事还没有写进来，等你们慢慢把这里填满。</p></div>
        </div>
        <Sparkles class="note-spark" :size="54" />
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.companion-hero { position: relative; overflow: hidden; padding: 24px 20px 18px; border: 1px solid rgba(255,255,255,.88); border-radius: 34px 34px 34px 12px; background: linear-gradient(128deg,rgba(255,255,255,.9),rgba(245,247,253,.68)); box-shadow: var(--shadow); backdrop-filter: blur(22px); }
.hero-glow { position:absolute; width:210px; height:210px; right:-72px; top:-90px; border-radius:50%; background:radial-gradient(circle,rgba(var(--blue-rgb),.3),rgba(var(--blue-rgb),0) 68%); }
.companion-profile { position:relative; z-index:1; display:grid; grid-template-columns:auto 1fr; align-items:center; gap:17px; }
.avatar-orbit { position:relative; padding:5px; }
.avatar-orbit::before { content:""; position:absolute; inset:-3px; border:1px solid rgba(var(--pink-rgb),.22); border-radius:38% 62% 56% 44% / 48% 43% 57% 52%; transform:rotate(-8deg); }
.avatar-orbit > i { position:absolute; right:2px; bottom:6px; width:13px; height:13px; border:3px solid #fff; border-radius:50%; background:#71c3a3; box-shadow:0 3px 9px rgba(72,153,124,.28); }
.hero-copy { min-width: 0; }
.hero-copy > span { color: #a17a9e; font-size: 9px; font-weight: 800; letter-spacing: .18em; }
.hero-copy h2 { margin: 6px 0 4px; font-size: 29px; letter-spacing: -.06em; }
.hero-copy p { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; margin: 0; color: var(--soft-ink); font-size: 11px; line-height: 1.6; }
.chat-entry { position:relative; z-index:1; width:100%; min-height:66px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px; margin-top:21px; padding:9px 14px 9px 10px; border:0; border-radius:21px; color:#fff; text-align:left; background:linear-gradient(118deg,#ca88ad,#9294c1 56%,#75a9d1); box-shadow:0 16px 34px rgba(118,101,151,.24); }
.chat-entry > i { width:46px; height:46px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.24); border-radius:15px; background:rgba(255,255,255,.12); }
.chat-entry span { display:grid; gap:2px; }.chat-entry small { font-size:9px; opacity:.76; }.chat-entry strong { font-size:13px; letter-spacing:.01em; }
.space-pulse { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 0 20px; }
.space-pulse > div { position:relative; min-height:70px; overflow:hidden; padding:13px 15px; border:1px solid rgba(255,255,255,.75); border-radius:20px; background:rgba(255,255,255,.48); }
.space-pulse > div::after { content:""; position:absolute; width:58px; height:58px; right:-18px; bottom:-26px; border:1px solid rgba(var(--pink-rgb),.18); border-radius:50%; }
.space-pulse > div:last-child::after { border-color:rgba(var(--blue-rgb),.22); }
.space-pulse span { color:var(--muted); font-size:9px; }.space-pulse p { display:flex; align-items:baseline; gap:5px; margin:4px 0 0; }
.space-pulse strong { font-family:Georgia,serif; font-size:25px; font-weight:500; }.space-pulse small { color:var(--soft-ink); font-size:9px; }
.home-sections { display:grid; gap:14px; }
.rhythm-panel { padding:19px 17px 13px; border:1px solid rgba(255,255,255,.78); border-radius:28px 12px 28px 28px; background:rgba(255,255,255,.54); box-shadow:0 16px 38px rgba(80,74,107,.07); }
.panel-heading { display:flex; align-items:center; justify-content:space-between; }
.panel-heading span,.memory-note > header span { color:#a07b9d; font-size:8px; font-weight:800; letter-spacing:.17em; }
.panel-heading h2 { margin:4px 0 0; font-size:17px; letter-spacing:-.04em; }
.panel-heading button { width:34px; height:34px; display:grid; place-items:center; border:1px solid var(--line); border-radius:12px; color:#817a90; background:rgba(255,255,255,.62); }
.timeline { padding: 9px 0 0; cursor: pointer; }
.timeline article { min-height: 47px; display: grid; grid-template-columns: 50px 13px 1fr; align-items: center; gap: 8px; position: relative; }
.timeline article:not(:last-child)::after { content:""; position:absolute; left:64px; top:29px; bottom:-18px; width:1px; background:linear-gradient(rgba(var(--pink-rgb),.36),rgba(var(--blue-rgb),.2)); }
.timeline time { color: #878193; font-family: Georgia,serif; font-size: 13px; }.timeline article > i { z-index:1; width:9px; height:9px; border:2px solid #fff; border-radius:50%; background:linear-gradient(135deg,var(--pink),var(--blue)); box-shadow:0 0 0 4px rgba(var(--pink-rgb),.1); }.timeline article > span { padding: 12px 15px; border-radius: 16px; background: rgba(255,255,255,.55); font-size: 12px; }
.timeline-empty { display:flex; align-items:center; gap:11px; padding:18px; color:var(--muted); border:1px dashed rgba(121,112,149,.18); border-radius:18px; font-size:11px; }
.memory-note { position:relative; min-height:142px; overflow:hidden; padding:18px 18px 20px; border-radius:12px 30px 30px 30px; color:#fff; background:linear-gradient(118deg,#8d82a3,#888db3 55%,#73a5ca); box-shadow:0 20px 46px rgba(93,88,131,.22); cursor:pointer; }
.memory-note > header { display:flex; align-items:center; justify-content:space-between; }.memory-note > header span { color:#fff; opacity:.65; }
.memory-body { position:relative; z-index:1; display:grid; grid-template-columns:auto 1fr; align-items:center; gap:14px; margin-top:16px; }
.note-mark { width:46px;height:46px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.3);border-radius:16px;background:rgba(255,255,255,.09); }
.memory-note small { font-size:9px; opacity:.7; }.memory-note p { display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin:5px 0 0;font-size:12px;line-height:1.65; }
.note-spark { position:absolute;right:10px;bottom:3px;opacity:.12;transform:rotate(12deg); }
</style>
