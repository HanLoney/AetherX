<script setup lang="ts">
import { computed, ref } from "vue";
import {
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EmptyState from "../components/EmptyState.vue";
import type { Memory } from "../lib/api";
import { useDataStore } from "../stores/data";

type MemoryFilter = "all" | "active" | "candidate";

const data = useDataStore();
const query = ref("");
const filter = ref<MemoryFilter>("all");
const actingId = ref("");
const actionError = ref("");

const activeCount = computed(() => data.memories.value.filter((memory) => memory.status === "active").length);
const candidateCount = computed(() => data.memories.value.filter((memory) => memory.status === "candidate").length);
const tabs = computed(() => [
  { id: "all" as const, label: "全部", count: data.memories.value.length },
  { id: "active" as const, label: "已珍藏", count: activeCount.value },
  { id: "candidate" as const, label: "待确认", count: candidateCount.value }
]);

const visible = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return data.memories.value
    .filter((memory) => {
      const statusMatches = filter.value === "all" || memory.status === filter.value;
      const searchable = `${memory.content} ${memory.sourceExcerpt} ${memory.domain} ${memory.type}`.toLocaleLowerCase();
      return statusMatches && (!needle || searchable.includes(needle));
    })
    .sort((left, right) => {
      if (filter.value === "all" && left.status !== right.status) {
        return left.status === "candidate" ? -1 : right.status === "candidate" ? 1 : 0;
      }
      return (right.updatedAt || 0) - (left.updatedAt || 0);
    });
});

const emptyTitle = computed(() => query.value.trim()
  ? "没有找到这段记忆"
  : filter.value === "candidate"
    ? "没有等待确认的记忆"
    : filter.value === "active"
      ? "还没有珍藏的记忆"
      : "记忆正在慢慢积累");

const emptyDescription = computed(() => query.value.trim()
  ? "换一个关键词试试，也许它藏在另一种说法里。"
  : filter.value === "candidate"
    ? "新发现会先来到这里，等你决定是否留下。"
    : "陪伴越久，这里就会收进越多重要的小事。");

function domainIcon(memory: Memory) {
  const domain = memory.domain.toLocaleLowerCase();
  if (/relationship|关系|人际/.test(domain)) return UsersRound;
  if (/emotion|情绪|感受/.test(domain)) return Heart;
  if (/health|健康/.test(domain)) return HeartPulse;
  if (/work|工作/.test(domain)) return BriefcaseBusiness;
  if (/learning|学习/.test(domain)) return GraduationCap;
  if (/profile|个人|身份/.test(domain)) return UserRound;
  if (/life|生活/.test(domain)) return Home;
  return BrainCircuit;
}

function domainLabel(domain: string) {
  const labels: Record<string, string> = {
    life: "生活日常",
    relationship: "人际关系",
    health: "健康状态",
    work: "工作事务",
    learning: "学习成长",
    emotion: "情绪感受",
    profile: "关于你"
  };
  return labels[domain.toLocaleLowerCase()] || domain || "日常片段";
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    fact: "事实",
    event: "经历",
    preference: "偏好",
    goal: "目标",
    relationship: "关系",
    summary: "总结"
  };
  return labels[type.toLocaleLowerCase()] || type || "记忆";
}

function sourceLabel(source: Memory["source"]) {
  return source === "explicit" ? "由你亲口告诉" : source === "imported" ? "从旧记录带来" : "从相处中发现";
}

function confidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

async function confirm(memory: Memory) {
  if (actingId.value) return;
  actingId.value = memory.id;
  actionError.value = "";
  try {
    await data.confirmMemory(memory.id);
  } catch (reason) {
    actionError.value = (reason as Error).message || "这条记忆暂时没有确认成功。";
  } finally {
    actingId.value = "";
  }
}

async function remove(memory: Memory) {
  if (actingId.value) return;
  actingId.value = memory.id;
  actionError.value = "";
  try {
    await data.removeMemory(memory.id);
  } catch (reason) {
    actionError.value = (reason as Error).message || "这条记忆暂时没有移除成功。";
  } finally {
    actingId.value = "";
  }
}
</script>

<template>
  <AppShell title="" headerless>
    <section class="memory-overview">
      <i class="overview-orbit overview-orbit-pink" aria-hidden="true" />
      <i class="overview-orbit overview-orbit-blue" aria-hidden="true" />
      <header>
        <span><Sparkles :size="12" /> MEMORY GARDEN</span>
      </header>
      <div class="overview-core">
        <div class="overview-number"><strong>{{ activeCount }}</strong><span>段记忆</span></div>
        <div class="overview-copy">
          <h1>被好好珍藏</h1>
          <p>那些关于你的重要小事，小玄都认真记得。</p>
        </div>
        <div class="overview-mark"><Heart :size="22" /></div>
      </div>
      <footer :class="{ pending: candidateCount }">
        <span>{{ candidateCount ? `${candidateCount} 段新发现等待确认` : '现在没有需要确认的新发现' }}</span>
        <b>{{ candidateCount || '✓' }}</b>
      </footer>
    </section>

    <label class="memory-search">
      <Search :size="17" />
      <input v-model="query" type="search" autocomplete="off" placeholder="搜索人、事情或一句话…" />
      <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''"><X :size="15" /></button>
    </label>

    <nav class="memory-tabs" aria-label="记忆筛选">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        :class="{ active: filter === item.id }"
        @click="filter = item.id"
      >
        <span>{{ item.label }}</span><b>{{ item.count }}</b>
      </button>
    </nav>

    <p v-if="actionError" class="memory-error">{{ actionError }}</p>

    <section class="memory-stream" aria-live="polite">
      <EmptyState v-if="!visible.length" :title="emptyTitle" :description="emptyDescription" />

      <article v-for="memory in visible" :key="memory.id" :class="['memory-card',memory.status]">
        <header>
          <div class="memory-symbol"><component :is="domainIcon(memory)" :size="18" /></div>
          <div class="memory-heading">
            <strong>{{ domainLabel(memory.domain) }}</strong>
            <span>{{ typeLabel(memory.type) }} · {{ sourceLabel(memory.source) }}</span>
          </div>
          <em>{{ memory.status === 'candidate' ? '待确认' : memory.status === 'archived' ? '已归档' : '已珍藏' }}</em>
        </header>

        <h2>{{ memory.content }}</h2>

        <blockquote v-if="memory.sourceExcerpt">
          <span>当时的原话</span>
          <p>“{{ memory.sourceExcerpt }}”</p>
        </blockquote>

        <footer>
          <div class="confidence-copy"><span>记忆可靠度</span><b>{{ confidence(memory.confidence) }}%</b></div>
          <div class="confidence-track"><i :style="{ width: `${confidence(memory.confidence)}%` }" /></div>
        </footer>

        <div v-if="memory.status === 'candidate'" class="memory-actions">
          <button type="button" :disabled="Boolean(actingId)" @click="remove(memory)"><Trash2 :size="15" />忽略</button>
          <button type="button" :disabled="Boolean(actingId)" @click="confirm(memory)"><Check :size="16" />{{ actingId === memory.id ? '正在保存…' : '确认珍藏' }}</button>
        </div>
      </article>
    </section>
  </AppShell>
</template>

<style scoped>
.memory-overview{position:relative;min-height:156px;overflow:hidden;margin-top:calc(env(safe-area-inset-top) + 14px);padding:16px 16px 13px;border:1px solid rgba(255,255,255,.24);border-radius:29px 29px 29px 11px;background:radial-gradient(circle at 8% 110%,rgba(232,156,198,.42),transparent 42%),radial-gradient(circle at 100% 0%,rgba(132,196,232,.38),transparent 45%),linear-gradient(132deg,#86788f 0%,#858cab 48%,#719fbd 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 24px 56px rgba(83,76,115,.22);backdrop-filter:blur(24px) saturate(145%)}
.overview-orbit{position:absolute;border-radius:50%;pointer-events:none}.overview-orbit-pink{width:150px;height:150px;right:-82px;bottom:-105px;background:radial-gradient(circle,rgba(255,186,220,.34),transparent 70%)}.overview-orbit-blue{width:126px;height:126px;top:-83px;left:-58px;border:1px solid rgba(218,238,255,.2);box-shadow:0 0 0 18px rgba(224,239,255,.035)}
.memory-overview>header{position:relative;z-index:1;display:flex;align-items:center}.memory-overview>header span{display:flex;align-items:center;gap:5px;color:rgba(255,255,255,.68);font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.13em}
.overview-core{position:relative;z-index:1;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin-top:10px}.overview-number{min-width:54px;display:grid;justify-items:center}.overview-number strong{color:#fff;font-family:Georgia,serif;font-size: calc(38px * var(--font-scale, 1));font-weight:500;line-height:.95;letter-spacing:-.05em;text-shadow:0 3px 14px rgba(50,44,72,.18)}.overview-number span{margin-top:4px;color:rgba(255,255,255,.62);font-size: calc(7px * var(--font-scale, 1))}.overview-copy{min-width:0}.overview-copy h1{margin:0;color:#fff;font-size: calc(18px * var(--font-scale, 1));letter-spacing:-.045em;text-shadow:0 2px 12px rgba(52,45,72,.15)}.overview-copy p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin:5px 0 0;color:rgba(255,255,255,.7);font-size: calc(8px * var(--font-scale, 1));line-height:1.55}.overview-mark{width:43px;height:43px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:16px;color:rgba(255,255,255,.9);background:linear-gradient(135deg,rgba(255,255,255,.19),rgba(255,255,255,.07));box-shadow:inset 0 1px rgba(255,255,255,.24),0 9px 20px rgba(50,44,72,.12);backdrop-filter:blur(10px)}
.memory-overview>footer{position:relative;z-index:1;min-height:27px;display:flex;align-items:center;justify-content:space-between;margin-top:11px;padding:0 4px 0 9px;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:rgba(255,255,255,.7);background:rgba(255,255,255,.08);font-size: calc(7px * var(--font-scale, 1))}.memory-overview>footer.pending{color:rgba(255,255,255,.82);background:rgba(255,226,241,.11)}.memory-overview>footer b{min-width:21px;height:21px;display:grid;place-items:center;padding:0 6px;border-radius:999px;color:#718c83;background:rgba(244,255,251,.88);font-size: calc(7px * var(--font-scale, 1))}.memory-overview>footer.pending b{color:#9a6f91;background:rgba(255,244,251,.92)}
.memory-search{height:46px;display:flex;align-items:center;gap:9px;margin-top:13px;padding:0 12px;border:1px solid rgba(255,255,255,.84);border-radius:16px;color:#9b94a5;background:rgba(255,255,255,.61);box-shadow:0 9px 26px rgba(75,70,103,.06);backdrop-filter:blur(16px)}.memory-search input{min-width:0;flex:1;padding:0;border:0;outline:0;color:var(--ink);background:transparent;font-size: calc(11px * var(--font-scale, 1))}.memory-search input::-webkit-search-cancel-button{display:none}.memory-search button{width:29px;height:29px;display:grid;place-items:center;padding:0;border:0;border-radius:10px;color:#9c95a5;background:rgba(109,101,130,.06)}
.memory-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:11px 0 15px;padding:4px;border-radius:16px;background:rgba(111,103,136,.065)}.memory-tabs button{min-width:0;height:38px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 6px;border:0;border-radius:12px;color:#8c8696;background:transparent;font-size: calc(9px * var(--font-scale, 1));font-weight:700}.memory-tabs button b{min-width:18px;height:18px;display:grid;place-items:center;padding:0 5px;border-radius:999px;color:#9a93a3;background:rgba(255,255,255,.65);font-size: calc(7px * var(--font-scale, 1))}.memory-tabs button.active{color:#655d75;background:rgba(255,255,255,.87);box-shadow:0 7px 18px rgba(86,79,112,.09)}.memory-tabs button.active b{color:#fff;background:linear-gradient(135deg,#ca88ac,#829bc7)}
.memory-error{margin:0 0 11px;padding:10px 12px;border-radius:13px;color:#aa5970;background:rgba(221,112,139,.1);font-size: calc(9px * var(--font-scale, 1));line-height:1.5;text-align:center}
.memory-stream{display:grid;gap:11px;padding-bottom:8px}.memory-stream>.empty-state{min-height:330px}.memory-card{position:relative;overflow:hidden;padding:14px;border:1px solid rgba(255,255,255,.86);border-radius:24px 24px 24px 9px;background:linear-gradient(145deg,rgba(255,255,255,.78),rgba(249,249,252,.57));box-shadow:0 15px 38px rgba(75,69,99,.085);backdrop-filter:blur(18px)}.memory-card::before{position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(#b6d4ea,#dba6c0);content:"";opacity:.7}.memory-card.candidate{border-color:rgba(var(--pink-rgb),.2);background:linear-gradient(145deg,rgba(255,252,254,.9),rgba(247,248,253,.66));box-shadow:0 17px 42px rgba(115,83,111,.11)}
.memory-card header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.memory-symbol{width:36px;height:36px;display:grid;place-items:center;border:1px solid rgba(var(--blue-rgb),.18);border-radius:13px;color:#779bc0;background:linear-gradient(145deg,rgba(var(--blue-rgb),.11),rgba(255,255,255,.55))}.candidate .memory-symbol{color:#ad7397;border-color:rgba(var(--pink-rgb),.2);background:linear-gradient(145deg,rgba(var(--pink-rgb),.13),rgba(255,255,255,.58))}.memory-heading{min-width:0;display:grid;gap:3px}.memory-heading strong{font-size: calc(10px * var(--font-scale, 1))}.memory-heading span{overflow:hidden;color:var(--muted);font-size: calc(7px * var(--font-scale, 1));text-overflow:ellipsis;white-space:nowrap}.memory-card header em{padding:4px 7px;border-radius:999px;color:#6f9b8b;background:rgba(97,180,146,.1);font-size: calc(7px * var(--font-scale, 1));font-style:normal;font-weight:700}.memory-card.candidate header em{color:#a66e90;background:rgba(var(--pink-rgb),.11)}
.memory-card h2{margin:13px 2px 0;color:#4b4657;font-size: calc(13px * var(--font-scale, 1));font-weight:650;line-height:1.7;letter-spacing:-.01em}.memory-card blockquote{margin:12px 0 0;padding:10px 11px;border:0;border-radius:14px;color:#817a89;background:rgba(116,108,137,.05)}.memory-card blockquote span{display:block;margin-bottom:5px;color:#a17c98;font-size: calc(7px * var(--font-scale, 1));font-weight:700;letter-spacing:.08em}.memory-card blockquote p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;margin:0;font-size: calc(9px * var(--font-scale, 1));line-height:1.65}
.memory-card footer{margin-top:12px}.confidence-copy{display:flex;align-items:center;justify-content:space-between;color:#9a94a3;font-size: calc(7px * var(--font-scale, 1))}.confidence-copy b{color:#817a8b;font-size: calc(8px * var(--font-scale, 1))}.confidence-track{height:3px;overflow:hidden;margin-top:5px;border-radius:99px;background:rgba(109,101,130,.07)}.confidence-track i{height:100%;display:block;border-radius:inherit;background:linear-gradient(90deg,rgba(var(--pink-rgb),.72),rgba(var(--blue-rgb),.8))}
.memory-actions{display:grid;grid-template-columns:.8fr 1.2fr;gap:7px;margin-top:13px}.memory-actions button{height:39px;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:13px;color:#9b6d7b;background:rgba(var(--pink-rgb),.09);font-size: calc(9px * var(--font-scale, 1));font-weight:700}.memory-actions button:last-child{color:#fff;background:linear-gradient(120deg,#c986ad,#8798c5 58%,#76a8cf);box-shadow:0 10px 22px rgba(126,105,155,.19)}.memory-actions button:disabled{opacity:.55}
</style>
