<script setup lang="ts">
import { computed, ref } from "vue";
import { Cloud, LogOut, RefreshCw, Server, ShieldCheck, Smartphone } from "@lucide/vue";
import { useRouter } from "vue-router";
import AppShell from "../components/AppShell.vue";
import ConnectionPill from "../components/ConnectionPill.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const data = useDataStore();
const refreshing = ref(false);
const aiState = ref<{hasApiKey:boolean;model?:string}|null>(null);
const displayName = computed(() => session.user.value?.displayName || session.user.value?.username || "当前账号");

async function refresh() {
  refreshing.value = true;
  try { await Promise.all([data.refreshAll(), session.requireApi().aiConfig().then((value)=>{aiState.value=value;})]); }
  finally { refreshing.value = false; }
}
async function logout() { data.stopSync(); await session.logout(); await router.replace("/login"); }
void session.requireApi().aiConfig().then((value)=>{aiState.value=value;}).catch(()=>undefined);
</script>

<template>
  <AppShell title="连接与设置" kicker="THIS DEVICE · ANDROID">
    <template #header><ConnectionPill/></template>
    <section class="account-banner">
      <ProfileAvatar :name="displayName" :src="String(data.profile.value.avatarDataUrl||'')" size="medium"/>
      <div><strong>{{displayName}}</strong><span>@{{session.user.value?.username}}</span></div>
      <ShieldCheck :size="21"/>
    </section>
    <div class="section-label"><h2>这台手机</h2></div>
    <section class="settings-list">
      <article><i><Server :size="19"/></i><div><strong>电脑端 Hub</strong><span>{{session.serverUrl.value}}</span></div></article>
      <article><i><Cloud :size="19"/></i><div><strong>实时同步</strong><span>{{data.syncState.value==='online'?'已连接，修改会自动同步':'正在等待电脑端连接'}}</span></div></article>
      <article><i><Smartphone :size="19"/></i><div><strong>本机凭证</strong><span>由 Android Keystore 加密保护</span></div></article>
    </section>
    <div class="section-label"><h2>AI 接入</h2></div>
    <section class="ai-strip"><div><span>{{aiState?.hasApiKey?'已经就绪':'尚未配置'}}</span><strong>{{aiState?.model||'在电脑端配置模型'}}</strong></div><b :class="{ready:aiState?.hasApiKey}"/></section>
    <button class="refresh-button" :disabled="refreshing" @click="refresh"><RefreshCw :size="18" :class="{spin:refreshing}"/>{{refreshing?'正在同步…':'立即重新同步'}}</button>
    <button class="logout-button" @click="logout"><LogOut :size="18"/>退出这个账号</button>
    <p class="settings-note">退出后会清除手机上的登录凭证和同步游标，不会删除电脑里的任何数据。</p>
  </AppShell>
</template>

<style scoped>
.account-banner{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:13px;padding:20px;border:1px solid rgba(255,255,255,.83);border-radius:28px 28px 28px 10px;background:rgba(255,255,255,.68);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.account-banner>div{display:grid;gap:4px}.account-banner strong{font-size:15px}.account-banner span{color:#9a94a4;font-size:10px}.account-banner>svg{color:#74a58f}
.settings-list{overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:10px 27px 27px 10px;background:rgba(255,255,255,.59);box-shadow:0 16px 44px rgba(75,70,103,.09);backdrop-filter:blur(18px)}.settings-list article{min-height:74px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:13px;padding:13px 17px;border-bottom:1px solid var(--line)}.settings-list article:last-child{border:0}.settings-list i{width:40px;height:40px;display:grid;place-items:center;border-radius:14px;color:#7d9ec1;background:linear-gradient(145deg,rgba(var(--pink-rgb),.1),rgba(var(--blue-rgb),.14))}.settings-list div{min-width:0;display:grid;gap:5px}.settings-list strong{font-size:12px}.settings-list span{overflow:hidden;text-overflow:ellipsis;color:#9993a3;font-size:9px;white-space:nowrap}
.ai-strip{min-height:91px;display:flex;align-items:center;justify-content:space-between;padding:20px 22px;border-radius:27px 10px 27px 27px;color:#fff;background:linear-gradient(118deg,#8f83a3,#858eb5 56%,#75a7cb);box-shadow:0 18px 42px rgba(93,88,131,.2)}.ai-strip>div{display:grid;gap:6px}.ai-strip span{font-size:9px;letter-spacing:.12em;opacity:.72}.ai-strip strong{font-size:14px}.ai-strip b{width:10px;height:10px;border-radius:50%;background:#d98798;box-shadow:0 0 0 6px rgba(255,255,255,.1)}.ai-strip b.ready{background:#82d3ad}
.refresh-button,.logout-button{width:100%;height:50px;display:flex;align-items:center;justify-content:center;gap:9px;border-radius:16px;font-size:11px;font-weight:700}.refresh-button{margin-top:25px;border:1px solid var(--line);color:#687897;background:rgba(255,255,255,.68)}.logout-button{margin-top:10px;border:0;color:#ad6175;background:rgba(217,118,143,.09)}.settings-note{margin:13px 24px 0;color:#a19baa;font-size:9px;line-height:1.6;text-align:center}
</style>
