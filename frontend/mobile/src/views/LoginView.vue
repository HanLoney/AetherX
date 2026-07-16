<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Eye, EyeOff, Link2, LockKeyhole, Server, UserPlus, UserRound } from "@lucide/vue";
import type { AuthConfig } from "../lib/api";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const serverUrl = ref(import.meta.env.VITE_AETHERX_SERVER_URL || "http://127.0.0.1:4318");
const username = ref("");
const displayName = ref("");
const password = ref("");
const registrationSecret = ref("");
const showPassword = ref(false);
const mode = ref<"login" | "register" | "pair">("login");
const pairingCode = ref("");
const authConfig = ref<AuthConfig | null>(null);
const localError = ref("");
const registrationAvailable = computed(() => authConfig.value?.registrationAvailable !== false);
const errorMessage = computed(() => localError.value || session.error.value);

async function inspectServer() {
  localError.value = "";
  try {
    authConfig.value = await session.inspectRegistration(serverUrl.value);
    if (!authConfig.value.registrationAvailable && mode.value === "register") mode.value = "login";
    return true;
  } catch (cause) {
    authConfig.value = null;
    localError.value = cause instanceof Error ? cause.message : "连接不到这台 AetherX Hub。";
    return false;
  }
}

async function selectMode(nextMode: typeof mode.value) {
  if (nextMode === "register" && !(await inspectServer())) return;
  if (nextMode === "register" && !registrationAvailable.value) {
    localError.value = "这台服务器暂时没有开放新账号注册。";
    return;
  }
  localError.value = "";
  mode.value = nextMode;
}

async function submit() {
  if (mode.value === "pair") {
    if (!pairingCode.value.trim()) return;
    try { await session.pair(pairingCode.value); await router.replace("/home"); } catch { /* store 呈现 */ }
    return;
  }
  if (!username.value.trim() || !password.value) return;
  try {
    if (mode.value === "register") {
      if (!(await inspectServer()) || !registrationAvailable.value) return;
      await session.register({
        serverUrl: serverUrl.value,
        username: username.value.trim(),
        displayName: displayName.value.trim(),
        password: password.value,
        registrationSecret: registrationSecret.value
      });
    } else {
      await session.login({ serverUrl: serverUrl.value, username: username.value.trim(), password: password.value });
    }
    await router.replace("/home");
  } catch { /* 错误由 store 呈现 */ }
}

onMounted(() => void inspectServer());
</script>

<template>
  <main class="login-page">
    <div class="login-orbit" aria-hidden="true"><i /><i /><b /></div>
    <section class="login-story">
      <span class="eyebrow">PRIVATE DIGITAL SPACE</span>
      <h1>回到只属于<br />你们的空间</h1>
      <p>电脑守护完整记忆，手机负责随时陪在你身边。</p>
    </section>
    <form class="login-sheet" @submit.prevent="submit">
      <header>
        <span class="eyebrow">WELCOME BACK</span>
        <h2>欢迎回来</h2>
        <p>连接你的 AetherX Hub</p>
      </header>
      <div class="mode-tabs">
        <button type="button" :class="{active:mode==='login'}" @click="selectMode('login')">账号登录</button>
        <button type="button" :class="{active:mode==='register'}" :disabled="!registrationAvailable" @click="selectMode('register')">创建账号</button>
        <button type="button" :class="{active:mode==='pair'}" @click="selectMode('pair')">配对电脑</button>
      </div>
      <div v-if="mode!=='pair'" class="login-fields">
        <div class="field icon-field">
          <label for="server">电脑端地址</label>
          <div><Server :size="18" /><input id="server" v-model="serverUrl" inputmode="url" autocomplete="url" @change="inspectServer" /></div>
        </div>
        <div v-if="mode==='register'" class="field icon-field">
          <label for="displayName">怎么称呼你</label>
          <div><UserPlus :size="18" /><input id="displayName" v-model="displayName" autocomplete="name" placeholder="显示名称（可选）" /></div>
        </div>
        <div class="field icon-field">
          <label for="username">账号名</label>
          <div><UserRound :size="18" /><input id="username" v-model="username" autocomplete="username" placeholder="输入账号名" /></div>
        </div>
        <div class="field icon-field">
          <label for="password">密码</label>
          <div>
            <LockKeyhole :size="18" />
            <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="mode==='register'?'new-password':'current-password'" :placeholder="mode==='register'?'至少 10 个字符':'输入密码'" />
            <button type="button" aria-label="显示或隐藏密码" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" /></button>
          </div>
        </div>
        <div v-if="mode==='register' && authConfig?.requiresRegistrationSecret" class="field icon-field">
          <label for="registrationSecret">注册口令</label>
          <div><LockKeyhole :size="18" /><input id="registrationSecret" v-model="registrationSecret" type="password" autocomplete="off" placeholder="由服务器管理员提供" /></div>
        </div>
      </div>
      <div v-else class="login-fields pairing-fields">
        <div class="pairing-note"><Link2 :size="19"/><span><strong>粘贴电脑端生成的连接码</strong><small>提交后，请回到电脑端确认这台手机。</small></span></div>
        <div class="field"><label for="pairingCode">一次性连接码</label><textarea id="pairingCode" v-model="pairingCode" rows="4" placeholder="aetherx://pair?…" /></div>
      </div>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
      <button class="primary-button login-button" type="submit" :disabled="session.busy.value || (mode==='pair' ? !pairingCode.trim() : !username.trim() || !password)">
        <span>{{ session.busy.value ? (mode==='pair'?'等待电脑确认…':mode==='register'?'正在创建…':'正在连接…') : (mode==='pair'?'申请配对':mode==='register'?'创建并进入':'进入 AetherX') }}</span><ArrowRight :size="18" />
      </button>
      <footer>登录凭证只保存在这台手机的系统安全区中</footer>
    </form>
  </main>
</template>

<style scoped>
.login-page { position: relative; min-height: 100dvh; overflow: hidden; padding: max(44px, env(safe-area-inset-top)) 20px calc(22px + env(safe-area-inset-bottom)); background: radial-gradient(circle at 90% 15%, rgba(171,210,239,.3), transparent 34%), radial-gradient(circle at 0% 70%, rgba(239,184,214,.28), transparent 35%); }
.login-story { max-width: 520px; margin: 70px auto 34px; }
.login-story h1 { margin: 14px 0 18px; font-family: Georgia, "Noto Serif SC", serif; font-size: clamp(38px, 12vw, 58px); line-height: 1.14; letter-spacing: -.07em; }
.login-story p { margin: 0; color: var(--soft-ink); font-size: 13px; line-height: 1.8; }
.login-orbit { position: absolute; top: 42px; left: 28px; width: 68px; height: 68px; }
.login-orbit i, .login-orbit b { position: absolute; border: 1px solid rgba(185,130,170,.32); border-radius: 44% 56% 58% 42%; transform: rotate(28deg); }
.login-orbit i:first-child { inset: 0; background: linear-gradient(145deg,rgba(235,180,211,.25),rgba(153,197,232,.22)); }
.login-orbit i:nth-child(2) { inset: 13px; transform: rotate(60deg); }
.login-orbit b { inset: 25px; border: 0; border-radius: 50%; background: linear-gradient(135deg,var(--pink),var(--blue)); box-shadow: 0 8px 24px rgba(164,127,176,.32); }
.login-sheet { max-width: 520px; margin: 0 auto; padding: 30px 24px 23px; border: 1px solid rgba(255,255,255,.82); border-radius: 32px; background: rgba(255,255,255,.76); box-shadow: 0 32px 80px rgba(81,74,111,.15); backdrop-filter: blur(26px) saturate(130%); }
.login-sheet header h2 { margin: 7px 0 5px; font-size: 28px; letter-spacing: -.05em; }
.login-sheet header p { margin: 0; color: var(--muted); font-size: 12px; }
.mode-tabs{display:grid;grid-template-columns:repeat(3,1fr);margin:24px 0 0;padding:4px;border-radius:15px;background:rgba(118,110,141,.07)}.mode-tabs button{height:38px;border:0;border-radius:11px;color:#8b8597;background:transparent;font-size:10px;font-weight:700}.mode-tabs button.active{color:#544f6c;background:rgba(255,255,255,.92);box-shadow:0 7px 18px rgba(86,79,112,.1)}.mode-tabs button:disabled{opacity:.38}
.login-fields { display: grid; gap: 15px; margin: 27px 0 17px; }
.icon-field > div { min-height: 51px; display: flex; align-items: center; gap: 11px; padding: 0 14px; border: 1px solid var(--line); border-radius: 16px; background: rgba(250,249,252,.74); }
.icon-field > div:focus-within { border-color: rgba(var(--pink-rgb),.48); background: white; box-shadow: 0 0 0 4px rgba(var(--pink-rgb),.09); }
.icon-field svg { flex: 0 0 auto; color: #a29bad; }
.icon-field input { min-width: 0; min-height: auto; flex: 1; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.icon-field button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; color: #9b7597; background: none; }
.login-button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 11px; margin-top: 16px; }
.login-sheet footer { margin-top: 17px; color: #a29cac; font-size: 9px; text-align: center; }
.pairing-fields{margin-bottom:17px}.pairing-note{display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid rgba(var(--blue-rgb),.18);border-radius:14px;color:#7c7191;background:linear-gradient(120deg,rgba(235,244,252,.75),rgba(252,239,247,.68))}.pairing-note>span{display:grid;gap:3px}.pairing-note strong{font-size:10px}.pairing-note small{color:#9791a1;font-size:9px}.pairing-fields textarea{min-height:94px;font-size:10px;line-height:1.55}
@media (min-width: 760px) { .login-page { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 60px; padding-left: 8vw; padding-right: 8vw; } .login-story { margin: 0; } .login-sheet { width: 100%; margin: 0; } }
</style>
