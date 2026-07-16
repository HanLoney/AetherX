<script setup lang="ts">
import { computed, ref } from "vue";
import { BrainCircuit, Check, Heart, Lightbulb, Search, Trash2, UsersRound } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EmptyState from "../components/EmptyState.vue";
import type { Memory } from "../lib/api";
import { useDataStore } from "../stores/data";

const data = useDataStore();
const query = ref("");
const filter = ref<"all"|"active"|"candidate">("all");
const visible = computed(() => data.memories.value.filter((memory) => {
  const status = filter.value === "all" || memory.status === filter.value;
  const text = `${memory.content} ${memory.sourceExcerpt}`.toLocaleLowerCase();
  return status && (!query.value.trim() || text.includes(query.value.trim().toLocaleLowerCase()));
}));

function domainIcon(memory: Memory) {
  if (/relationship|关系|情感|emotion/.test(memory.domain)) return Heart;
  if (/people|人际|shared/.test(memory.domain)) return UsersRound;
  if (/preference|偏好/.test(memory.domain)) return Lightbulb;
  return BrainCircuit;
}
function confidence(value: number) { return `${Math.round(value * 100)}%`; }
</script>

<template>
  <AppShell title="记忆中心" kicker="MEMORY ARCHIVE · 私人档案">
    <div class="memory-search"><Search :size="17"/><input v-model="query" placeholder="在记忆里寻找…"/></div>
    <div class="memory-tabs"><button v-for="item in [{id:'all',label:'全部'},{id:'active',label:'已经确认'},{id:'candidate',label:'等待确认'}]" :key="item.id" :class="{active:filter===item.id}" @click="filter=item.id as typeof filter">{{item.label}}</button></div>
    <section class="archive">
      <header><span>PRIVATE RECORDS</span><b>{{visible.length}} 份</b></header>
      <EmptyState v-if="!visible.length" title="没有找到这份记忆" description="换一个词试试，或者等新的故事慢慢写进来。" />
      <article v-for="memory in visible" :key="memory.id" :class="['memory-entry',memory.status]">
        <div class="memory-symbol"><component :is="domainIcon(memory)" :size="21"/></div>
        <div class="memory-body">
          <span class="memory-meta">{{memory.domain}} · {{memory.type}} · 置信度 {{confidence(memory.confidence)}}</span>
          <h2>{{memory.content}}</h2>
          <blockquote v-if="memory.sourceExcerpt">来源原话：“{{memory.sourceExcerpt}}”</blockquote>
          <div v-if="memory.status==='candidate'" class="memory-actions"><button @click="data.confirmMemory(memory.id)"><Check :size="15"/>确认</button><button @click="data.removeMemory(memory.id)"><Trash2 :size="15"/>删除</button></div>
        </div>
      </article>
    </section>
  </AppShell>
</template>

<style scoped>
.memory-search{height:49px;display:flex;align-items:center;gap:10px;padding:0 15px;border:1px solid rgba(255,255,255,.85);border-radius:17px;background:rgba(255,255,255,.66);box-shadow:0 12px 35px rgba(75,70,103,.08);backdrop-filter:blur(18px)}.memory-search svg{color:#9b94a5}.memory-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--ink);font-size:12px}
.memory-tabs{display:flex;gap:7px;margin:13px 0 18px;overflow:auto;scrollbar-width:none}.memory-tabs button{flex:0 0 auto;height:34px;padding:0 13px;border:1px solid var(--line);border-radius:999px;color:#8d8798;background:rgba(255,255,255,.45);font-size:10px;font-weight:700}.memory-tabs button.active{color:#fff;border-color:transparent;background:linear-gradient(120deg,#ca88ac,#849ac6)}
.archive{position:relative;min-height:480px;overflow:hidden;padding:22px 17px 36px;border:1px solid rgba(255,255,255,.82);border-radius:10px 34px 34px 10px;background:repeating-linear-gradient(to bottom,rgba(255,253,251,.75) 0,rgba(255,253,251,.75) 48px,rgba(113,146,176,.08) 49px,rgba(255,253,251,.75) 50px);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.archive::before{content:"";position:absolute;inset:0 auto 0 0;width:7px;background:linear-gradient(#e9a6c4,#b19aca,#83b7df);opacity:.6}.archive>header{display:flex;align-items:center;justify-content:space-between;padding:0 4px 18px 10px;color:#a09aa9;font-size:9px;font-weight:800;letter-spacing:.16em}.archive>header b{font-family:Georgia,serif;font-size:11px;font-weight:500;letter-spacing:0}
.memory-entry{position:relative;display:grid;grid-template-columns:auto 1fr;gap:13px;padding:20px 4px 20px 10px;border-top:1px solid rgba(106,98,129,.1)}.memory-symbol{width:43px;height:43px;display:grid;place-items:center;border:1px solid rgba(var(--blue-rgb),.25);border-radius:50%;color:#77a2cc;background:rgba(245,250,255,.7)}.candidate .memory-symbol{color:#c07ca4;border-color:rgba(var(--pink-rgb),.27);background:rgba(255,246,251,.7)}.memory-body{min-width:0}.memory-meta{color:#9c96a7;font-size:9px}.memory-body h2{margin:6px 0 0;color:#4a4656;font-size:13px;line-height:1.65;letter-spacing:-.01em}.memory-body blockquote{margin:10px 0 0;padding:8px 10px;border-left:3px solid rgba(var(--pink-rgb),.38);color:#8e8798;background:rgba(255,255,255,.38);font-size:9px;line-height:1.55}.memory-actions{display:flex;gap:8px;margin-top:12px}.memory-actions button{height:32px;display:flex;align-items:center;gap:5px;padding:0 11px;border:0;border-radius:11px;color:#6b7791;background:rgba(var(--blue-rgb),.1);font-size:9px;font-weight:700}.memory-actions button:last-child{color:#a96b7b;background:rgba(var(--pink-rgb),.1)}
</style>
