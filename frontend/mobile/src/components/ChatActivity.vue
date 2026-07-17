<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  LoaderCircle,
  ShieldAlert,
  Sparkles,
  Wrench
} from "@lucide/vue";
import type { ChatMessage } from "../lib/api";

const props = defineProps<{ message: ChatMessage }>();
const emit = defineEmits<{ decide: [approved: boolean] }>();

const expanded = ref(Boolean(props.message.expanded || ["waiting", "error", "denied"].includes(props.message.status || "")));
watch(() => props.message.status, (status) => {
  if (status === "waiting" || status === "error") expanded.value = true;
});
const isMemory = computed(() => props.message.role === "memory");
const title = computed(() => {
  if (props.message.title) return props.message.title;
  if (isMemory.value) return memoryKindLabels[props.message.kind || ""] || "记忆变化";
  return "工具调用";
});
const statusLabel = computed(() => props.message.statusText || statusLabels[props.message.status || ""] || "已记录");
const activityItems = computed(() => Array.isArray(props.message.items) ? props.message.items : []);
const hasDetails = computed(() => Boolean(
  props.message.detail
  || activityItems.value.length
  || props.message.journal?.items?.length
  || props.message.image?.source
));
const StatusIcon = computed(() => {
  if (props.message.status === "success") return CheckCircle2;
  if (props.message.status === "error" || props.message.status === "denied") return AlertCircle;
  if (props.message.status === "waiting") return ShieldAlert;
  if (props.message.status === "running") return LoaderCircle;
  return CircleDashed;
});

const statusLabels: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  waiting: "等待确认",
  success: "执行成功",
  error: "执行失败",
  denied: "已拒绝",
  skipped: "已跳过"
};

const memoryKindLabels: Record<string, string> = {
  recall: "本轮参考的个人信息",
  candidate: "新发现的候选记忆",
  confirmed: "已自动确认的新记忆",
  profile: "用户画像已更新",
  preference: "偏好已更新",
  merged: "已合并相似记忆",
  assistant: "人格画像发生变化",
  growth: "人格成长记录",
  shared: "新增共同记忆"
};
</script>

<template>
  <section class="activity-card" :class="[message.role, message.status, message.risk]">
    <button class="activity-head" type="button" :aria-expanded="expanded" @click="hasDetails && (expanded = !expanded)">
      <span class="activity-symbol">
        <Brain v-if="isMemory" :size="17" />
        <Wrench v-else :size="17" />
      </span>
      <span class="activity-heading">
        <strong>{{ title }}</strong>
        <span class="activity-meta">
          <span v-if="!isMemory" class="status" :class="message.status">
            <component :is="StatusIcon" :size="12" :class="{ spinning: message.status === 'running' }" />
            {{ statusLabel }}
          </span>
          <span v-if="message.risk === 'write'" class="risk">会修改数据</span>
          <span v-else-if="message.risk === 'destructive'" class="risk destructive">高风险操作</span>
          <span v-if="isMemory && activityItems.length">{{ activityItems.length }} 条</span>
        </span>
      </span>
      <ChevronDown v-if="hasDetails" class="chevron" :class="{ expanded }" :size="16" />
    </button>

    <div v-if="hasDetails && expanded" class="activity-detail">
      <p v-if="message.detail" class="detail-text">{{ message.detail }}</p>

      <ul v-if="activityItems.length" class="memory-items">
        <li v-for="(item, index) in activityItems" :key="item.id || index">
          <Sparkles :size="13" />
          <span>{{ item.content || item.title || item.reason || '记忆已更新' }}</span>
        </li>
      </ul>

      <ul v-if="message.journal?.items?.length" class="journal-items">
        <li v-for="(item, index) in message.journal.items" :key="`${item.periodKey || ''}-${index}`">
          <span>{{ item.title || '手记' }}</span>
          <small>{{ item.periodKey || item.type || '' }}</small>
        </li>
      </ul>

      <img v-if="message.image?.source" class="activity-image" :src="message.image.source" alt="工具生成的画面" />

      <div v-if="message.status === 'waiting'" class="approval-actions">
        <button type="button" class="deny" @click="emit('decide', false)">拒绝</button>
        <button type="button" class="approve" @click="emit('decide', true)">允许执行</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.activity-card { width: min(88%, 570px); margin: 2px auto 18px; overflow: hidden; border: 1px solid rgba(127,118,151,.14); border-radius: 18px; color: #5c5669; background: rgba(255,255,255,.66); box-shadow: 0 11px 32px rgba(69,64,91,.07); backdrop-filter: blur(18px); }
.activity-card.tool.success { border-color: rgba(94,177,143,.25); background: linear-gradient(135deg,rgba(245,253,249,.82),rgba(255,255,255,.72)); }
.activity-card.tool.error, .activity-card.tool.denied { border-color: rgba(211,105,130,.25); background: linear-gradient(135deg,rgba(255,246,248,.85),rgba(255,255,255,.72)); }
.activity-card.tool.waiting { border-color: rgba(221,170,85,.3); background: linear-gradient(135deg,rgba(255,250,239,.88),rgba(255,255,255,.72)); }
.activity-card.memory { border-color: rgba(164,126,199,.22); background: linear-gradient(135deg,rgba(250,246,255,.82),rgba(247,251,255,.72)); }
.activity-head { width: 100%; min-height: 60px; display: flex; align-items: center; gap: 11px; padding: 11px 13px; border: 0; color: inherit; background: transparent; text-align: left; }
.activity-symbol { width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 12px; color: #758cab; background: rgba(225,237,248,.8); }
.memory .activity-symbol { color: #9a72aa; background: rgba(240,225,243,.72); }
.activity-heading { min-width: 0; display: grid; gap: 5px; flex: 1; }
.activity-heading strong { overflow: hidden; color: #4b4658; font-size: 12px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.activity-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; color: #9992a3; font-size: 9px; }
.status { display: inline-flex; align-items: center; gap: 4px; color: #8c8796; }
.status.success { color: #4eaa84; }.status.error,.status.denied { color: #c35e78; }.status.waiting { color: #bd8938; }
.risk { padding: 2px 6px; border-radius: 99px; color: #ad7d31; background: rgba(244,220,168,.35); }.risk.destructive { color: #b9536c; background: rgba(244,190,203,.32); }
.chevron { flex: 0 0 auto; color: #aaa3b3; transition: transform .22s ease; }.chevron.expanded { transform: rotate(180deg); }
.activity-detail { padding: 0 13px 13px 58px; border-top: 1px solid rgba(128,119,151,.1); }
.detail-text { margin: 11px 0 0; color: #7b7486; font-size: 10px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-items,.journal-items { display: grid; gap: 7px; margin: 10px 0 0; padding: 0; list-style: none; }
.memory-items li { display: flex; align-items: flex-start; gap: 7px; color: #736c80; font-size: 10px; line-height: 1.55; }.memory-items svg { flex: 0 0 auto; margin-top: 2px; color: #a87bb6; }
.journal-items li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 10px; color: #696273; background: rgba(245,241,247,.7); font-size: 10px; }.journal-items small { color: #aaa2b0; }
.activity-image { display: block; width: 100%; max-height: 320px; margin-top: 11px; border-radius: 12px; object-fit: contain; background: rgba(239,235,243,.55); }
.approval-actions { display: grid; grid-template-columns: 1fr 1.35fr; gap: 8px; margin-top: 12px; }
.approval-actions button { min-height: 40px; border-radius: 12px; font-size: 10px; font-weight: 750; }
.approval-actions .deny { border: 1px solid rgba(159,144,164,.2); color: #766f7e; background: rgba(255,255,255,.72); }
.approval-actions .approve { border: 0; color: #fff; background: linear-gradient(135deg,#cb88ad,#7ea6ce); box-shadow: 0 8px 18px rgba(130,111,160,.18); }
.spinning { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
</style>
