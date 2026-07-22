<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Plus, Trash2, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EmptyState from "../components/EmptyState.vue";
import { useDataStore } from "../stores/data";

const data = useDataStore();
const filter = ref<"active" | "completed">("active");
const editorOpen = ref(false);
const text = ref("");
const date = ref(toLocalInput(Date.now()));
const endDate = ref(toLocalInput(Date.now() + 3_600_000));
const saving = ref(false);
const error = ref("");
const visible = computed(() => data.todos.value.filter((todo) => filter.value === "completed" ? todo.completed : !todo.completed));

async function createTodo() {
  if (!text.value.trim()) return;
  saving.value = true; error.value = "";
  try {
    await data.addTodo({ text: text.value.trim(), startAt: new Date(date.value).getTime(), endAt: new Date(endDate.value).getTime() });
    text.value = ""; editorOpen.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "待办没有保存成功。"; }
  finally { saving.value = false; }
}

function toLocalInput(value: number) {
  const local = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function dateLabel(value: number) { return new Intl.DateTimeFormat("zh-CN", { month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false }).format(value); }
</script>

<template>
  <AppShell title="日历待办" kicker="把生活放在看得见的地方">
    <template #header><button class="add-button" @click="editorOpen = true"><Plus :size="20" /></button></template>
    <div class="todo-tabs"><button :class="{active:filter==='active'}" @click="filter='active'">正在进行 <b>{{ data.activeTodos.value.length }}</b></button><button :class="{active:filter==='completed'}" @click="filter='completed'">已经完成</button></div>
    <section class="todo-sheet">
      <EmptyState v-if="!visible.length" :title="filter === 'active' ? '眼前没有待办' : '还没有完成记录'" :description="filter === 'active' ? '空出来的时间也值得被好好享受。' : '做完的事情会安静地留在这里。'" />
      <article v-for="todo in visible" :key="todo.id" class="todo-row" :class="{done:todo.completed}">
        <button class="check-button" @click="data.toggleTodo(todo)"><Check :size="15" /></button>
        <div><strong>{{ todo.text }}</strong><time>{{ dateLabel(todo.startAt) }}</time></div>
        <button class="delete-button" aria-label="删除" @click="data.removeTodo(todo.id)"><Trash2 :size="16" /></button>
      </article>
    </section>
    <Transition name="fade"><div v-if="editorOpen" class="sheet-backdrop" @click.self="editorOpen=false"><form class="bottom-sheet" @submit.prevent="createTodo"><div class="sheet-handle"/><div class="sheet-title"><h2>记下一件事</h2><button type="button" class="icon-button" @click="editorOpen=false"><X :size="18"/></button></div><div class="editor-fields"><div class="field"><label>要做什么</label><textarea v-model="text" autofocus placeholder="简短写下这件事…" /></div><div class="field"><label>开始</label><input v-model="date" type="datetime-local" /></div><div class="field"><label>结束</label><input v-model="endDate" type="datetime-local" /></div></div><p v-if="error" class="error-banner">{{error}}</p><button class="primary-button save-todo" :disabled="saving||!text.trim()">{{saving?'保存中…':'放进日程'}}</button></form></div></Transition>
  </AppShell>
</template>

<style scoped>
.add-button{width:45px;height:45px;display:grid;place-items:center;border:0;border-radius:16px;color:#fff;background:linear-gradient(135deg,#d08caf,#78a9d3);box-shadow:0 10px 25px rgba(130,111,160,.22)}
.todo-tabs{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;border-radius:18px;background:rgba(111,103,136,.07)}.todo-tabs button{height:42px;border:0;border-radius:14px;color:#8b8597;background:transparent;font-size: calc(11px * var(--font-scale, 1));font-weight:700}.todo-tabs button.active{color:#58526c;background:rgba(255,255,255,.86);box-shadow:0 8px 20px rgba(86,79,112,.09)}.todo-tabs b{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:5px;border-radius:10px;color:#fff;background:linear-gradient(135deg,var(--pink),var(--blue));font-size: calc(9px * var(--font-scale, 1))}
.todo-sheet{position:relative;min-height:420px;margin-top:18px;padding:8px 19px 20px;border:1px solid rgba(255,255,255,.82);border-radius:12px 34px 34px 12px;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.72) 0,rgba(255,255,255,.72) 46px,rgba(112,147,180,.09) 47px,rgba(255,255,255,.72) 48px);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.todo-sheet::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;border-radius:8px;background:linear-gradient(var(--pink),var(--blue));opacity:.55}
.todo-row{min-height:72px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:13px;border-bottom:1px solid rgba(105,98,130,.09)}.todo-row>div{min-width:0;display:grid;gap:5px}.todo-row strong{overflow:hidden;text-overflow:ellipsis;color:#4c4859;font-size: calc(13px * var(--font-scale, 1))}.todo-row time{color:#9892a2;font-family:Georgia,serif;font-size: calc(10px * var(--font-scale, 1))}.check-button{width:29px;height:29px;display:grid;place-items:center;border:1px solid rgba(var(--blue-rgb),.35);border-radius:50%;color:transparent;background:rgba(255,255,255,.62)}.done .check-button{color:#fff;border:0;background:linear-gradient(135deg,var(--pink),var(--blue))}.done strong{text-decoration:line-through;color:#a19baa}.delete-button{width:35px;height:35px;display:grid;place-items:center;border:0;color:#b5afbb;background:transparent}.editor-fields{display:grid;gap:15px}.save-todo{width:100%;margin-top:19px}
</style>
