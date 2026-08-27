<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Eye, EyeOff, Link2, LockKeyhole, ScanLine, Server, UserPlus, UserRound } from "@lucide/vue";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint
} from "@capacitor/barcode-scanner";
import type { AuthConfig } from "../lib/api";
import { runCompletePairing } from "../lib/complete-pairing";
import { pairAndroidLocalHub } from "../lib/hub-pairing";
import { useLocalHub } from "../lib/local-hub";
import {
  PAIRING_DEEP_LINK_EVENT,
  takePendingPairingCode
} from "../lib/pairing-deep-link";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const localHub = useLocalHub();
const serverUrl = ref(import.meta.env.VITE_AETHERX_SERVER_URL || "http://127.0.0.1:4318");
const username = ref("");
const displayName = ref("");
const password = ref("");
const registrationSecret = ref("");
const showPassword = ref(false);
const mode = ref<"login" | "register" | "pair" | "reset">("login");
const pairingCode = ref("");
const authConfig = ref<AuthConfig | null>(null);
const cloudBuild = import.meta.env.VITE_AETHERX_EDITION === "cloud";
const emailIdentity = computed(() => cloudBuild || authConfig.value?.loginIdentifier === "email");
const awaitingVerification = ref(false);
const verificationToken = ref("");
const verificationNotice = ref("如果这是新账号，验证邮件会发送到该邮箱；如果邮箱已经注册，请直接返回登录。");
const pendingEmail = ref("");
const pendingPassword = ref("");
const resetRequested = ref(false);
const resetToken = ref("");
const resetPassword = ref("");
const localError = ref("");
const scanning = ref(false);
const completePairingBusy = ref(false);
const completePairingState = ref("");
const lastCompletedPairingCode = ref("");
const registrationAvailable = computed(() => authConfig.value?.registrationAvailable !== false);
const errorMessage = computed(() => localError.value || session.error.value);
const submitDisabled = computed(() => {
  if (session.busy.value || completePairingBusy.value) return true;
  if (awaitingVerification.value) return !verificationToken.value.trim();
  if (mode.value === "reset") {
    return resetRequested.value
      ? !resetToken.value.trim() || resetPassword.value.length < 10
      : !username.value.trim();
  }
  if (mode.value === "pair") return !pairingCode.value.trim();
  return !username.value.trim() || !password.value;
});

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
  if (awaitingVerification.value) {
    const token = extractVerificationToken(verificationToken.value);
    if (!token) return;
    try {
      await session.verifyEmail({ serverUrl: serverUrl.value, token });
      await router.replace("/home");
    } catch { /* 错误由 store 呈现 */ }
    return;
  }
  if (mode.value === "pair") {
    if (!pairingCode.value.trim()) return;
    try { await connectWithPairingCode(pairingCode.value); } catch { /* store 呈现 */ }
    return;
  }
  if (mode.value === "reset") {
    localError.value = "";
    try {
      if (!resetRequested.value) {
        await session.requestPasswordReset({
          serverUrl: serverUrl.value,
          email: username.value.trim()
        });
        resetRequested.value = true;
        localError.value = "如果邮箱已注册并完成验证，重置邮件已经发送。";
      } else {
        const token = extractVerificationToken(resetToken.value);
        await session.resetPassword({
          serverUrl: serverUrl.value,
          token,
          password: resetPassword.value
        });
        mode.value = "login";
        resetRequested.value = false;
        resetToken.value = "";
        resetPassword.value = "";
        password.value = "";
        localError.value = "密码已经更新，请使用新密码登录。";
      }
    } catch (cause) {
      localError.value = cause instanceof Error ? cause.message : "密码重置没有完成。";
    }
    return;
  }
  if (!username.value.trim() || !password.value) return;
  try {
    if (mode.value === "register") {
      if (!(await inspectServer()) || !registrationAvailable.value) return;
      const result = await session.register({
        serverUrl: serverUrl.value,
        ...(emailIdentity.value
          ? { email: username.value.trim() }
          : { username: username.value.trim() }),
        displayName: displayName.value.trim(),
        password: password.value,
        registrationSecret: registrationSecret.value
      });
      if (result.verificationRequired) {
        if (emailIdentity.value) {
          try {
            await session.login({
              serverUrl: serverUrl.value,
              email: username.value.trim(),
              password: password.value
            });
            await router.replace("/home");
            return;
          } catch {
            session.clearError();
          }
        }
        awaitingVerification.value = true;
        pendingEmail.value = username.value.trim();
        pendingPassword.value = password.value;
        verificationNotice.value = "如果这是新账号，验证邮件会发送到该邮箱；如果邮箱已经注册，请返回登录。为保护账号隐私，页面不会提示邮箱是否已注册。";
        return;
      }
    } else {
      await session.login({
        serverUrl: serverUrl.value,
        ...(emailIdentity.value
          ? { email: username.value.trim() }
          : { username: username.value.trim() }),
        password: password.value
      });
    }
    await router.replace("/home");
  } catch { /* 错误由 store 呈现 */ }
}

async function resendVerification() {
  if (!pendingEmail.value || !pendingPassword.value) return;
  localError.value = "";
  try {
    await session.resendEmailVerification({
      serverUrl: serverUrl.value,
      email: pendingEmail.value,
      password: pendingPassword.value
    });
    verificationNotice.value = "如果账号尚未验证且凭据正确，新的验证邮件会发送到该邮箱；已验证账号请直接返回登录。";
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "验证邮件暂时没有发送成功。";
  }
}

function returnToEmailLogin() {
  awaitingVerification.value = false;
  verificationToken.value = "";
  pendingEmail.value = "";
  pendingPassword.value = "";
  localError.value = "";
  session.clearError();
  mode.value = "login";
}

function openPasswordReset() {
  localError.value = "";
  resetRequested.value = false;
  resetToken.value = "";
  resetPassword.value = "";
  mode.value = "reset";
}

function closePasswordReset() {
  localError.value = "";
  mode.value = "login";
  resetRequested.value = false;
}

function extractVerificationToken(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(raw).searchParams.get("token") || raw; } catch { return raw; }
}

async function connectWithPairingCode(code: string) {
  const normalizedCode = code.trim();
  pairingCode.value = normalizedCode;
  localError.value = "";
  if (normalizedCode && normalizedCode === lastCompletedPairingCode.value) {
    await router.replace("/home");
    return;
  }
  completePairingBusy.value = true;
  completePairingState.value = "";
  try {
    const completed = await runCompletePairing(normalizedCode, {
      pairClient: (clientCode) => session.pair(clientCode),
      pairHub: (hubCode) => pairAndroidLocalHub(
        hubCode,
        localHub,
        (state) => { completePairingState.value = state; }
      ),
      onState: (state) => { completePairingState.value = state; }
    });
    if (!completed) await session.pair(normalizedCode);
    if (completed) {
      lastCompletedPairingCode.value = normalizedCode;
      await localHub.refresh();
    }
    await router.replace("/home");
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "没有完成一体化配对。";
    throw cause;
  } finally {
    completePairingBusy.value = false;
  }
}

async function scanPairingCode() {
  if (scanning.value || session.busy.value || completePairingBusy.value) return;
  localError.value = "";
  scanning.value = true;
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      scanInstructions: "扫描 AetherX 配对二维码或远程 Hub 地址",
      scanButton: false,
      cancelButtonAccessibilityLabel: "取消扫描",
      torchButtonOnAccessibilityLabel: "关闭手电筒",
      torchButtonOffAccessibilityLabel: "打开手电筒",
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING }
    });
    const code = String(result.ScanResult || "").trim();
    if (!code) return;
    if (/^https?:\/\//i.test(code)) {
      serverUrl.value = code.replace(/\/+$/, "");
      mode.value = "login";
      pairingCode.value = "";
      await inspectServer();
      return;
    }
    await connectWithPairingCode(code);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "没有识别到有效的配对二维码。";
    if (!/cancel|取消/i.test(message)) localError.value = message;
  } finally {
    scanning.value = false;
  }
}

function handlePairingDeepLink(event: Event) {
  const code = String((event as CustomEvent<{ code?: string }>).detail?.code || "").trim();
  if (!code || completePairingBusy.value || session.busy.value) return;
  takePendingPairingCode();
  mode.value = "pair";
  void connectWithPairingCode(code).catch(() => undefined);
}

onMounted(() => {
  window.addEventListener(PAIRING_DEEP_LINK_EVENT, handlePairingDeepLink);
  const code = takePendingPairingCode();
  if (code) {
    mode.value = "pair";
    void connectWithPairingCode(code).catch(() => undefined);
  } else {
    void inspectServer();
  }
});
onBeforeUnmount(() => window.removeEventListener(PAIRING_DEEP_LINK_EVENT, handlePairingDeepLink));
</script>

<template>
  <main class="login-page">
    <form class="login-sheet" @submit.prevent="submit">
      <header class="login-brand">
        <span class="login-mark" aria-hidden="true"><i /><b /></span>
        <h1>AetherX</h1>
      </header>
      <div v-if="!awaitingVerification && mode !== 'reset'" class="mode-tabs" :class="{'email-tabs':emailIdentity}">
        <button type="button" :class="{active:mode==='login'}" @click="selectMode('login')">账号登录</button>
        <button type="button" :class="{active:mode==='register'}" :disabled="!registrationAvailable" @click="selectMode('register')">创建账号</button>
        <button v-if="!emailIdentity" type="button" :class="{active:mode==='pair'}" @click="selectMode('pair')">配对电脑</button>
      </div>
      <div v-if="awaitingVerification" class="login-fields verification-fields">
        <div class="pairing-note"><Link2 :size="19"/><span><strong>验证你的邮箱</strong><small>{{ verificationNotice }}</small></span></div>
        <div class="field icon-field">
          <label for="verificationToken">验证令牌</label>
          <div><LockKeyhole :size="18" /><input id="verificationToken" v-model="verificationToken" autocomplete="one-time-code" placeholder="粘贴邮件链接或验证令牌" /></div>
        </div>
        <div class="verification-actions">
          <button class="resend-verification" type="button" @click="resendVerification">重新发送验证邮件</button>
          <button class="resend-verification" type="button" @click="returnToEmailLogin">返回账号登录</button>
        </div>
      </div>
      <div v-else-if="mode==='reset'" class="login-fields verification-fields">
        <div class="pairing-note"><LockKeyhole :size="19"/><span><strong>找回登录密码</strong><small>{{ resetRequested ? '粘贴邮件中的链接或令牌，并设置新密码。' : '填写注册邮箱；无论账号是否存在，页面都会显示相同结果。' }}</small></span></div>
        <div v-if="!resetRequested" class="field icon-field">
          <label for="resetEmail">邮箱</label>
          <div><UserRound :size="18" /><input id="resetEmail" v-model="username" type="email" autocomplete="email" placeholder="输入注册邮箱" /></div>
        </div>
        <template v-else>
          <div class="field icon-field">
            <label for="resetToken">重置令牌</label>
            <div><LockKeyhole :size="18" /><input id="resetToken" v-model="resetToken" autocomplete="one-time-code" placeholder="粘贴邮件链接或重置令牌" /></div>
          </div>
          <div class="field icon-field">
            <label for="resetPassword">新密码</label>
            <div><LockKeyhole :size="18" /><input id="resetPassword" v-model="resetPassword" type="password" autocomplete="new-password" placeholder="至少 10 个字符" /></div>
          </div>
        </template>
        <button class="resend-verification" type="button" @click="closePasswordReset">返回登录</button>
      </div>
      <div v-else-if="mode!=='pair'" class="login-fields">
        <div v-if="!cloudBuild" class="field icon-field">
          <label for="server">电脑端地址</label>
          <div><Server :size="18" /><input id="server" v-model="serverUrl" inputmode="url" autocomplete="url" @change="inspectServer" /></div>
        </div>
        <div v-if="mode==='register'" class="field icon-field">
          <label for="displayName">怎么称呼你</label>
          <div><UserPlus :size="18" /><input id="displayName" v-model="displayName" autocomplete="name" placeholder="显示名称（可选）" /></div>
        </div>
        <div class="field icon-field">
          <label for="username">{{ emailIdentity ? "邮箱" : "账号名" }}</label>
          <div><UserRound :size="18" /><input id="username" v-model="username" :type="emailIdentity?'email':'text'" :autocomplete="emailIdentity?'email':'username'" :placeholder="emailIdentity?'输入邮箱地址':'输入账号名'" /></div>
        </div>
        <button v-if="emailIdentity && mode==='login'" class="forgot-password" type="button" @click="openPasswordReset">忘记密码？</button>
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
        <div class="pairing-note"><Link2 :size="19"/><span><strong>连接电脑端 AetherX</strong><small>{{ completePairingState || "一体化配对码可同时连接客户端并建立备用 Hub。" }}</small></span></div>
        <button class="scan-pairing-button" type="button" :disabled="scanning || session.busy.value || completePairingBusy" @click="scanPairingCode">
          <ScanLine :size="21" />
          <span><strong>{{ completePairingBusy ? "正在完成双重配对…" : scanning ? "正在打开相机…" : "扫描电脑二维码" }}</strong><small>一次扫描可同时配对客户端与手机 Hub</small></span>
        </button>
        <div class="pairing-divider"><span>或者手动粘贴</span></div>
        <div class="field"><label for="pairingCode">一次性连接码</label><textarea id="pairingCode" v-model="pairingCode" rows="4" placeholder="aetherx://pair?…" /></div>
      </div>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
      <button class="primary-button login-button" type="submit" :disabled="submitDisabled">
        <span>{{ session.busy.value ? (awaitingVerification?'正在验证…':mode==='reset'?'正在处理…':mode==='pair'?'等待电脑确认…':mode==='register'?'正在创建…':'正在连接…') : (awaitingVerification?'完成邮箱验证':mode==='reset'?(resetRequested?'更新密码':'发送重置邮件'):mode==='pair'?'申请配对':mode==='register'?'创建并进入':'进入 AetherX') }}</span><ArrowRight :size="18" />
      </button>
      <footer>登录凭证只保存在这台手机的系统安全区中</footer>
    </form>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: max(24px, env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  background:
    radial-gradient(circle at 88% 8%, rgba(171,210,239,.34), transparent 34%),
    radial-gradient(circle at 2% 88%, rgba(239,184,214,.3), transparent 38%),
    linear-gradient(155deg, #fdfafd, #f5f8fc);
}
.login-sheet { width: min(100%, 460px); margin: min(7vh, 56px) auto 0; padding: 23px 20px 20px; border: 1px solid rgba(255,255,255,.86); border-radius: 28px; background: rgba(255,255,255,.78); box-shadow: 0 24px 64px rgba(81,74,111,.14); backdrop-filter: blur(26px) saturate(130%); }
.login-brand { display: flex; align-items: center; justify-content: center; gap: 11px; }
.login-brand h1 { margin: 0; color: #4f4a5f; font-size: calc(27px * var(--font-scale, 1)); line-height: 1; letter-spacing: -.045em; }
.login-mark { position: relative; width: 34px; height: 34px; flex: 0 0 auto; transform: rotate(-8deg); }
.login-mark i, .login-mark b { position: absolute; border-radius: 43% 57% 55% 45%; }
.login-mark i { inset: 0; border: 1px solid rgba(157,132,174,.28); background: linear-gradient(145deg,rgba(235,180,211,.38),rgba(153,197,232,.34)); transform: rotate(28deg); }
.login-mark b { inset: 10px; background: linear-gradient(135deg,var(--pink),var(--blue)); box-shadow: 0 5px 14px rgba(145,118,171,.25); }
.mode-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:20px 0 0;padding:4px;border-radius:15px;background:rgba(118,110,141,.07)}.mode-tabs button{min-width:0;height:38px;padding:0 4px;border:0;border-radius:11px;color:#8b8597;background:transparent;font-size:calc(10px * var(--font-scale,1));font-weight:700;white-space:nowrap}.mode-tabs button.active{color:#544f6c;background:rgba(255,255,255,.92);box-shadow:0 7px 18px rgba(86,79,112,.1)}.mode-tabs button:disabled{opacity:.38}
.mode-tabs.email-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.resend-verification{min-height:40px;border:1px solid rgba(var(--blue-rgb),.2);border-radius:13px;color:#6d7891;background:rgba(255,255,255,.82);font-weight:700}
.verification-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.verification-actions .resend-verification{min-width:0;padding:8px;font-size:calc(9px * var(--font-scale,1))}
.forgot-password{justify-self:end;margin-top:-6px;padding:2px 0;border:0;color:#817593;background:transparent;font-size:calc(9px * var(--font-scale,1));font-weight:700}
.login-fields { display: grid; gap: 13px; margin: 21px 0 15px; }
.icon-field > div { min-height: 51px; display: flex; align-items: center; gap: 11px; padding: 0 14px; border: 1px solid var(--line); border-radius: 16px; background: rgba(250,249,252,.74); }
.icon-field > div:focus-within { border-color: rgba(var(--pink-rgb),.48); background: white; box-shadow: 0 0 0 4px rgba(var(--pink-rgb),.09); }
.icon-field svg { flex: 0 0 auto; color: #a29bad; }
.icon-field input { min-width: 0; min-height: auto; flex: 1; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.icon-field button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; color: #9b7597; background: none; }
.login-button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 11px; margin-top: 16px; }
.login-sheet footer { margin-top: 15px; color: #a29cac; font-size: calc(9px * var(--font-scale, 1)); text-align: center; }
.pairing-fields{margin-bottom:17px}.pairing-note{display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid rgba(var(--blue-rgb),.18);border-radius:14px;color:#7c7191;background:linear-gradient(120deg,rgba(235,244,252,.75),rgba(252,239,247,.68))}.pairing-note>span{display:grid;gap:3px}.pairing-note strong{font-size: calc(10px * var(--font-scale, 1))}.pairing-note small{color:#9791a1;font-size: calc(9px * var(--font-scale, 1))}.pairing-fields textarea{min-height:94px;font-size: calc(10px * var(--font-scale, 1));line-height:1.55}
.scan-pairing-button{min-height:70px;display:flex;align-items:center;gap:13px;padding:13px 15px;border:1px solid rgba(var(--pink-rgb),.22);border-radius:17px;color:#fff;background:linear-gradient(135deg,rgba(197,130,178,.96),rgba(113,167,217,.96));box-shadow:0 14px 30px rgba(126,126,181,.2);text-align:left}.scan-pairing-button>svg{flex:0 0 auto}.scan-pairing-button>span{display:grid;gap:4px}.scan-pairing-button strong{font-size: calc(12px * var(--font-scale, 1))}.scan-pairing-button small{color:rgba(255,255,255,.78);font-size: calc(9px * var(--font-scale, 1))}.scan-pairing-button:disabled{opacity:.58}.pairing-divider{display:flex;align-items:center;gap:10px;color:#aaa4b1;font-size: calc(8px * var(--font-scale, 1))}.pairing-divider::before,.pairing-divider::after{height:1px;flex:1;background:rgba(122,115,143,.12);content:""}
@media (max-height: 620px) { .login-sheet { margin-top: 0; } }
@media (min-width: 760px) { .login-sheet { margin-top: min(10vh, 82px); } }
</style>
