<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef } from "vue";
import {
  Check,
  ChevronRight,
  Cloud,
  Link2,
  LogOut,
  Pencil,
  RefreshCw,
  ScanLine,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Type,
  X,
  ZoomIn,
  ZoomOut
} from "@lucide/vue";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint
} from "@capacitor/barcode-scanner";
import { useRouter } from "vue-router";
import AppShell from "../components/AppShell.vue";
import ConnectionPill from "../components/ConnectionPill.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { DEFAULT_FONT_SCALE, useInterfaceSettings } from "../lib/interface-settings";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const data = useDataStore();
const interfaceSettings = useInterfaceSettings();
const refreshing = ref(false);
const connectionOpen = ref(false);
const connectionMode = ref<"address" | "pair">("address");
const connectionUrl = ref("");
const pairingCode = ref("");
const connectionError = ref("");
const connectionNotice = ref("");
const scanning = ref(false);
const reconnecting = ref(false);
const interfaceOpen = ref(false);
const fontScaleError = ref("");
const editing = ref(false);
const saving = ref(false);
const saveError = ref("");
const avatarInput = ref<HTMLInputElement | null>(null);
const cropCanvas = ref<HTMLCanvasElement | null>(null);
const cropImage = shallowRef<HTMLImageElement | null>(null);
const cropOpen = ref(false);
const cropZoom = ref(100);
const avatarSaving = ref(false);
const avatarError = ref("");
const crop = reactive({ baseScale: 1, offsetX: 0, offsetY: 0 });
const aiState = ref<{hasApiKey:boolean;model?:string}|null>(null);
const form = reactive({ displayName: "", preferredName: "", occupation: "", bio: "" });
let cropDrag: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;

const displayName = computed(() => String(
  data.profile.value.displayName
  || session.user.value?.displayName
  || session.user.value?.username
  || "当前账号"
));
const preferredName = computed(() => String(data.profile.value.preferredName || ""));
const occupation = computed(() => String(data.profile.value.occupation || ""));
const bio = computed(() => String(data.profile.value.bio || ""));
const avatar = computed(() => String(data.profile.value.avatarDataUrl || ""));
const syncDescription = computed(() => data.syncState.value === "online"
  ? "电脑与手机正在实时同步"
  : data.syncState.value === "syncing"
    ? "正在读取最新内容"
    : data.syncState.value === "error"
      ? "连接暂时中断，点击重新同步"
      : "正在等待电脑端连接");

function previewFontScale(event: Event) {
  interfaceSettings.applyFontScale((event.target as HTMLInputElement).value);
  fontScaleError.value = "";
}

async function persistFontScale() {
  try {
    await interfaceSettings.saveFontScale(interfaceSettings.fontScale.value);
    fontScaleError.value = "";
  } catch {
    fontScaleError.value = "字体大小暂时没有保存成功。";
  }
}

function resetFontScale() {
  interfaceSettings.applyFontScale(DEFAULT_FONT_SCALE);
  void persistFontScale();
}

function closeInterfaceSettings() {
  void persistFontScale();
  interfaceOpen.value = false;
}

function openEditor() {
  form.displayName = displayName.value;
  form.preferredName = preferredName.value;
  form.occupation = occupation.value;
  form.bio = bio.value;
  saveError.value = "";
  editing.value = true;
}

function chooseAvatar() {
  if (!avatarSaving.value) avatarInput.value?.click();
}

function currentCropScale() {
  return crop.baseScale * (cropZoom.value / 100);
}

function clampCrop() {
  const canvas = cropCanvas.value;
  const image = cropImage.value;
  if (!canvas || !image) return;
  const width = image.naturalWidth * currentCropScale();
  const height = image.naturalHeight * currentCropScale();
  crop.offsetX = Math.min(0, Math.max(canvas.width - width, crop.offsetX));
  crop.offsetY = Math.min(0, Math.max(canvas.height - height, crop.offsetY));
}

function drawCrop() {
  const canvas = cropCanvas.value;
  const image = cropImage.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !image || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    crop.offsetX,
    crop.offsetY,
    image.naturalWidth * currentCropScale(),
    image.naturalHeight * currentCropScale()
  );
}

function initializeCrop() {
  const canvas = cropCanvas.value;
  const image = cropImage.value;
  if (!canvas || !image) return;
  cropZoom.value = 100;
  crop.baseScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  crop.offsetX = (canvas.width - image.naturalWidth * crop.baseScale) / 2;
  crop.offsetY = (canvas.height - image.naturalHeight * crop.baseScale) / 2;
  drawCrop();
}

async function handleAvatarFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  avatarError.value = "";
  if (!file.type.startsWith("image/")) {
    avatarError.value = "请选择一张图片。";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    avatarError.value = "图片太大了，请选择 15 MB 以内的图片。";
    return;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片无法读取，请换一张试试。"));
      image.src = objectUrl;
    });
    cropImage.value = image;
    cropOpen.value = true;
    await nextTick();
    initializeCrop();
  } catch (reason) {
    avatarError.value = (reason as Error).message || "图片无法读取，请换一张试试。";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function changeCropZoom(event: Event) {
  const canvas = cropCanvas.value;
  const image = cropImage.value;
  if (!canvas || !image) return;
  const previousScale = currentCropScale();
  const imageCenterX = (canvas.width / 2 - crop.offsetX) / previousScale;
  const imageCenterY = (canvas.height / 2 - crop.offsetY) / previousScale;
  cropZoom.value = Number((event.target as HTMLInputElement).value);
  const nextScale = currentCropScale();
  crop.offsetX = canvas.width / 2 - imageCenterX * nextScale;
  crop.offsetY = canvas.height / 2 - imageCenterY * nextScale;
  clampCrop();
  drawCrop();
}

function startCropDrag(event: PointerEvent) {
  if (!cropCanvas.value) return;
  cropCanvas.value.setPointerCapture(event.pointerId);
  cropDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: crop.offsetX, offsetY: crop.offsetY };
}

function moveCrop(event: PointerEvent) {
  const canvas = cropCanvas.value;
  if (!canvas || !cropDrag || cropDrag.pointerId !== event.pointerId) return;
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  crop.offsetX = cropDrag.offsetX + (event.clientX - cropDrag.x) * scale;
  crop.offsetY = cropDrag.offsetY + (event.clientY - cropDrag.y) * scale;
  clampCrop();
  drawCrop();
}

function endCropDrag(event: PointerEvent) {
  if (cropDrag?.pointerId === event.pointerId) cropDrag = null;
}

function cancelCrop() {
  if (avatarSaving.value) return;
  cropOpen.value = false;
  cropImage.value = null;
  cropDrag = null;
}

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(",")[1] || "";
  return Math.ceil(encoded.length * 3 / 4);
}

function renderAvatar(size: number, quality: number) {
  const source = cropCanvas.value;
  const output = document.createElement("canvas");
  if (!source) return "";
  output.width = size;
  output.height = size;
  output.getContext("2d")?.drawImage(source, 0, 0, size, size);
  return output.toDataURL("image/webp", quality);
}

async function confirmAvatar() {
  if (avatarSaving.value || !cropImage.value) return;
  avatarSaving.value = true;
  avatarError.value = "";
  try {
    let avatarDataUrl = "";
    for (const size of [512, 448, 384]) {
      for (const quality of [0.88, 0.76, 0.64, 0.52]) {
        avatarDataUrl = renderAvatar(size, quality);
        if (avatarDataUrl && dataUrlBytes(avatarDataUrl) <= 700 * 1024) break;
      }
      if (avatarDataUrl && dataUrlBytes(avatarDataUrl) <= 700 * 1024) break;
    }
    if (!avatarDataUrl || dataUrlBytes(avatarDataUrl) > 700 * 1024) throw new Error("头像压缩失败，请换一张图片试试。");
    await data.updateProfile({ avatarDataUrl });
    cropOpen.value = false;
    cropImage.value = null;
  } catch (reason) {
    avatarError.value = (reason as Error).message || "头像暂时没有保存成功。";
  } finally {
    avatarSaving.value = false;
  }
}

async function saveProfile() {
  if (saving.value || !form.displayName.trim()) return;
  saving.value = true;
  saveError.value = "";
  try {
    await data.updateProfile({
      displayName: form.displayName.trim(),
      preferredName: form.preferredName.trim(),
      occupation: form.occupation.trim(),
      bio: form.bio.trim()
    });
    editing.value = false;
  } catch (reason) {
    saveError.value = (reason as Error).message || "个人资料暂时没有保存成功。";
  } finally {
    saving.value = false;
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    await Promise.all([
      data.refreshAll(),
      session.requireApi().aiConfig().then((value) => { aiState.value = value; })
    ]);
  } finally {
    refreshing.value = false;
  }
}

function openConnectionSettings() {
  connectionUrl.value = session.serverUrl.value;
  pairingCode.value = "";
  connectionMode.value = "address";
  connectionError.value = "";
  connectionOpen.value = true;
}

function closeConnectionSettings() {
  if (!reconnecting.value && !scanning.value) connectionOpen.value = false;
}

async function scanHubCode() {
  if (scanning.value || reconnecting.value) return;
  scanning.value = true;
  connectionError.value = "";
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      scanInstructions: "扫描 AetherX Hub 地址或一次性配对码",
      scanButton: false,
      cancelButtonAccessibilityLabel: "取消扫描",
      torchButtonOnAccessibilityLabel: "关闭手电筒",
      torchButtonOffAccessibilityLabel: "打开手电筒",
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING }
    });
    const code = String(result.ScanResult || "").trim();
    if (!code) return;
    if (/^https?:\/\//i.test(code)) {
      connectionUrl.value = code.replace(/\/+$/, "");
      connectionMode.value = "address";
    } else {
      pairingCode.value = code;
      connectionMode.value = "pair";
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "没有识别到有效的连接二维码。";
    if (!/cancel|取消/i.test(message)) connectionError.value = message;
  } finally {
    scanning.value = false;
  }
}

async function applyHubConnection() {
  if (reconnecting.value) return;
  reconnecting.value = true;
  connectionError.value = "";
  connectionNotice.value = "";
  try {
    if (connectionMode.value === "address") {
      await session.reconnect(connectionUrl.value);
    } else {
      if (!pairingCode.value.trim()) throw new Error("请扫描或粘贴电脑端生成的配对码。 ");
      await session.pair(pairingCode.value);
    }
    const connectedUrl = session.serverUrl.value;
    connectionNotice.value = `已连接 ${connectedUrl}，正在后台恢复同步`;
    connectionOpen.value = false;
    void data.reconnectHub().catch(() => {
      connectionNotice.value = `已连接 ${connectedUrl}，同步正在自动重试`;
    });
    void session.requireApi().aiConfig().then((value) => { aiState.value = value; }).catch(() => undefined);
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : "没有成功重新连接 Hub。";
  } finally {
    reconnecting.value = false;
  }
}

async function logout() {
  data.stopSync();
  await session.logout();
  await router.replace("/login");
}

void session.requireApi().aiConfig().then((value) => { aiState.value = value; }).catch(() => undefined);
</script>

<template>
  <AppShell title="" headerless>
    <section class="profile-hero">
      <i class="hero-glow hero-glow-pink" aria-hidden="true" />
      <i class="hero-glow hero-glow-blue" aria-hidden="true" />
      <div class="hero-status"><ConnectionPill /></div>

      <div class="profile-identity">
        <button class="avatar-frame" type="button" aria-label="更换头像" :disabled="avatarSaving" @click="chooseAvatar">
          <ProfileAvatar :name="displayName" :src="avatar" size="large" />
        </button>
        <input ref="avatarInput" class="avatar-input" type="file" accept="image/png,image/jpeg,image/webp" @change="handleAvatarFile" />
        <div class="profile-copy">
          <span>PERSONAL SPACE</span>
          <h1>{{ displayName }}</h1>
          <p>{{ bio || occupation || '这是属于你的 AetherX 私人空间。' }}</p>
        </div>
      </div>

      <div class="profile-meta">
        <span v-if="avatarSaving"><Sparkles :size="12" />正在保存新头像…</span>
        <span v-else-if="avatarError" class="avatar-error">{{ avatarError }}</span>
        <span v-else-if="preferredName"><Sparkles :size="12" />小玄会称呼你为 {{ preferredName }}</span>
        <span v-else><Sparkles :size="12" />和小玄共同生活的你</span>
        <button type="button" @click="openEditor"><Pencil :size="13" />编辑资料</button>
      </div>
    </section>

    <div class="section-heading"><div><span>CONNECTION</span><h2>连接与设置</h2></div><ShieldCheck :size="18" /></div>
    <section class="settings-list">
      <button class="hub-connection-row" type="button" @click="openConnectionSettings">
        <i><Server :size="18"/></i>
        <div><strong>电脑端 Hub</strong><span>{{ session.serverUrl.value }}</span></div>
        <b>管理</b>
      </button>
      <article>
        <i><Cloud :size="18"/></i>
        <div><strong>实时同步</strong><span>{{ syncDescription }}</span></div>
        <b :class="{ warning: data.syncState.value === 'error' }">{{ data.syncState.value === 'online' ? '正常' : '检查' }}</b>
      </article>
      <article>
        <i><Sparkles :size="18"/></i>
        <div><strong>AI 接入</strong><span>{{ aiState?.model || '在电脑端配置使用的模型' }}</span></div>
        <b :class="{ warning: !aiState?.hasApiKey }">{{ aiState?.hasApiKey ? '就绪' : '未配置' }}</b>
      </article>
    </section>
    <p v-if="connectionNotice" class="connection-notice"><Check :size="13" />{{ connectionNotice }}</p>

    <button class="interface-settings-entry" type="button" @click="interfaceOpen = true">
      <i><Settings2 :size="18" /></i>
      <span><strong>应用设置</strong><small>字体大小与界面显示</small></span>
      <b>{{ interfaceSettings.fontScale.value }}%</b>
      <ChevronRight :size="17" />
    </button>

    <button class="refresh-button" type="button" :disabled="refreshing" @click="refresh">
      <RefreshCw :size="17" :class="{spin:refreshing}"/>{{ refreshing ? '正在重新同步…' : '重新同步全部内容' }}
    </button>
    <button class="logout-button" type="button" @click="logout"><LogOut :size="17"/>退出这个账号</button>
    <p class="settings-note">退出只会清除这台手机上的登录凭证，不会删除电脑端保存的任何数据。</p>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="connectionOpen" class="sheet-backdrop" @click.self="closeConnectionSettings">
        <form class="connection-sheet" role="dialog" aria-modal="true" aria-label="重新连接 Hub" @submit.prevent="applyHubConnection">
          <div class="sheet-handle" />
          <header>
            <div><span>HUB CONNECTION</span><h2>重新连接 Hub</h2></div>
            <button type="button" aria-label="关闭连接设置" :disabled="reconnecting || scanning" @click="closeConnectionSettings"><X :size="18" /></button>
          </header>
          <p class="connection-intro">切换局域网或 Tailscale 地址时不必退出账号；如果电脑端换过数据或凭证，再使用新的配对码。</p>
          <div class="connection-tabs">
            <button type="button" :class="{ active: connectionMode === 'address' }" @click="connectionMode = 'address'; connectionError = ''">地址重连</button>
            <button type="button" :class="{ active: connectionMode === 'pair' }" @click="connectionMode = 'pair'; connectionError = ''">重新配对</button>
          </div>
          <label v-if="connectionMode === 'address'" class="connection-field">
            <span>Hub 地址</span>
            <div><Server :size="17" /><input v-model="connectionUrl" inputmode="url" autocomplete="url" placeholder="https://你的设备.ts.net:4318" /></div>
            <small>会先验证 Hub 和当前账号，失败时原连接保持不变。</small>
          </label>
          <label v-else class="connection-field pairing-code-field">
            <span>一次性配对码</span>
            <textarea v-model="pairingCode" rows="4" placeholder="aetherx://pair?…" />
            <small>提交后仍需回到电脑端确认这台手机。</small>
          </label>
          <button class="scan-hub-button" type="button" :disabled="scanning || reconnecting" @click="scanHubCode">
            <ScanLine :size="19" /><span><strong>{{ scanning ? '正在打开相机…' : '扫描电脑二维码' }}</strong><small>自动识别 Hub 地址或配对码</small></span>
          </button>
          <p v-if="connectionError" class="connection-error">{{ connectionError }}</p>
          <button class="apply-connection" type="submit" :disabled="reconnecting || scanning || (connectionMode === 'address' ? !connectionUrl.trim() : !pairingCode.trim())">
            <Link2 :size="17" />{{ reconnecting ? (connectionMode === 'pair' ? '等待电脑确认…' : '正在验证 Hub…') : connectionMode === 'address' ? '验证并重新连接' : '申请重新配对' }}
          </button>
        </form>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="editing" class="sheet-backdrop" @click.self="editing = false">
        <form class="profile-editor" @submit.prevent="saveProfile">
          <div class="sheet-handle" />
          <header><div><span>PERSONAL PROFILE</span><h2>编辑个人资料</h2></div><button type="button" aria-label="关闭" @click="editing = false"><X :size="18"/></button></header>
          <div class="editor-fields">
            <label><span>显示名称</span><input v-model="form.displayName" maxlength="100" required /></label>
            <label><span>希望小玄怎么称呼你</span><input v-model="form.preferredName" maxlength="100" placeholder="例如：洛尼" /></label>
            <label><span>职业 / 当前身份</span><input v-model="form.occupation" maxlength="200" placeholder="可选" /></label>
            <label><span>关于我</span><textarea v-model="form.bio" maxlength="2000" rows="3" placeholder="写一点想让小玄了解的你…" /></label>
          </div>
          <p v-if="saveError" class="editor-error">{{ saveError }}</p>
          <button class="save-profile" type="submit" :disabled="saving || !form.displayName.trim()"><Check :size="17"/>{{ saving ? '正在保存…' : '保存个人资料' }}</button>
        </form>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="interfaceOpen" class="sheet-backdrop" @click.self="closeInterfaceSettings">
        <section class="interface-settings-sheet" role="dialog" aria-modal="true" aria-label="应用设置">
          <div class="sheet-handle" />
          <header>
            <div><span>APP SETTINGS</span><h2>应用设置</h2></div>
            <button type="button" aria-label="关闭设置" @click="closeInterfaceSettings"><X :size="18" /></button>
          </header>

          <article class="font-size-card">
            <div class="font-setting-head">
              <i><Type :size="19" /></i>
              <div><strong>全局字体大小</strong><span>立即应用到手机端的所有页面</span></div>
              <b>{{ interfaceSettings.fontScale.value }}%</b>
            </div>
            <div class="font-preview" aria-hidden="true">
              <span>预览</span>
              <strong>让每一段文字都刚刚好</strong>
              <small>清晰舒适，也保留界面的呼吸感。</small>
            </div>
            <label class="font-scale-control">
              <span>小</span>
              <input
                type="range"
                min="85"
                max="125"
                step="5"
                :value="interfaceSettings.fontScale.value"
                aria-label="全局字体大小"
                @input="previewFontScale"
                @change="persistFontScale"
              />
              <span>大</span>
            </label>
            <div class="font-scale-footer">
              <small>仅调整文字，不会放大卡片和按钮。</small>
              <button type="button" @click="resetFontScale">恢复默认</button>
            </div>
            <p v-if="fontScaleError" class="font-scale-error">{{ fontScaleError }}</p>
          </article>
        </section>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="cropOpen" class="crop-backdrop" @click.self="cancelCrop">
        <section class="avatar-cropper" role="dialog" aria-modal="true" aria-label="裁剪头像">
          <header>
            <div><span>AVATAR CROP</span><h2>裁剪头像</h2></div>
            <button type="button" aria-label="关闭裁剪" :disabled="avatarSaving" @click="cancelCrop"><X :size="18" /></button>
          </header>
          <div class="crop-stage">
            <canvas
              ref="cropCanvas"
              width="600"
              height="600"
              @pointerdown="startCropDrag"
              @pointermove="moveCrop"
              @pointerup="endCropDrag"
              @pointercancel="endCropDrag"
            />
            <i class="crop-guide" aria-hidden="true" />
          </div>
          <p>拖动画面调整位置，滑动缩放到喜欢的构图。</p>
          <label class="crop-zoom">
            <ZoomOut :size="17" />
            <input type="range" min="100" max="250" step="1" :value="cropZoom" aria-label="缩放头像" @input="changeCropZoom" />
            <ZoomIn :size="18" />
          </label>
          <p v-if="avatarError" class="crop-error">{{ avatarError }}</p>
          <div class="crop-actions">
            <button type="button" :disabled="avatarSaving" @click="cancelCrop">取消</button>
            <button type="button" :disabled="avatarSaving" @click="confirmAvatar"><Check :size="16" />{{ avatarSaving ? '正在上传…' : '确认并上传' }}</button>
          </div>
        </section>
        </div>
      </Transition>
    </Teleport>
  </AppShell>
</template>

<style scoped>
.profile-hero{position:relative;min-height:211px;overflow:hidden;margin-top:calc(env(safe-area-inset-top) + 14px);padding:21px 17px 15px;border:1px solid rgba(255,255,255,.86);border-radius:34px 34px 34px 12px;background:radial-gradient(circle at 4% 108%,rgba(var(--pink-rgb),.2),transparent 43%),radial-gradient(circle at 100% 0%,rgba(var(--blue-rgb),.22),transparent 48%),linear-gradient(132deg,rgba(255,250,253,.94),rgba(243,248,253,.78));box-shadow:inset 0 1px rgba(255,255,255,.96),0 23px 56px rgba(81,70,105,.14),0 8px 28px rgba(var(--pink-rgb),.055);backdrop-filter:blur(24px) saturate(150%)}
.hero-glow{position:absolute;border-radius:50%;pointer-events:none}.hero-glow-pink{width:170px;height:170px;right:-100px;bottom:-112px;background:radial-gradient(circle,rgba(var(--pink-rgb),.24),transparent 69%)}.hero-glow-blue{width:175px;height:175px;top:-118px;left:-85px;border:1px solid rgba(var(--blue-rgb),.15);box-shadow:0 0 0 23px rgba(var(--blue-rgb),.028)}.hero-status{position:absolute;z-index:2;top:15px;right:16px}.hero-status :deep(.connection-pill){min-height:26px;padding:0 8px;font-size: calc(8px * var(--font-scale, 1));background:rgba(255,255,255,.5)}
.profile-identity{position:relative;z-index:1;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:16px;margin-top:16px}.avatar-frame{position:relative;display:block;padding:4px;border:1px solid rgba(var(--pink-rgb),.2);border-radius:30px;color:inherit;background:rgba(255,255,255,.46);box-shadow:inset 0 1px rgba(255,255,255,.82),0 11px 25px rgba(93,78,116,.12)}.avatar-frame:disabled{opacity:.65}.avatar-frame :deep(.avatar-large){width:82px;height:82px;border-radius:26px;box-shadow:none}.avatar-input{display:none}.profile-copy{min-width:0}.profile-copy>span{color:#9e789a;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.profile-copy h1{overflow:hidden;margin:5px 0 0;color:#454152;font-size: calc(27px * var(--font-scale, 1));letter-spacing:-.055em;text-overflow:ellipsis;white-space:nowrap}.profile-copy p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin:7px 0 0;color:#898393;font-size: calc(9px * var(--font-scale, 1));line-height:1.6}
.profile-meta{position:relative;z-index:1;min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:15px;padding:0 4px 0 10px;border-radius:14px;background:rgba(112,104,135,.045)}.profile-meta>span{min-width:0;display:flex;align-items:center;gap:5px;overflow:hidden;color:#8e8797;font-size: calc(8px * var(--font-scale, 1));text-overflow:ellipsis;white-space:nowrap}.profile-meta>button{height:31px;flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:0 10px;border:1px solid rgba(255,255,255,.75);border-radius:11px;color:#806c82;background:linear-gradient(125deg,rgba(var(--pink-rgb),.12),rgba(var(--blue-rgb),.14));font-size: calc(8px * var(--font-scale, 1));font-weight:700}
.section-heading{display:flex;align-items:flex-end;justify-content:space-between;margin:25px 4px 11px}.section-heading>div{display:grid;gap:3px}.section-heading span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.section-heading h2{margin:0;color:#514d5d;font-size: calc(16px * var(--font-scale, 1))}.section-heading>svg{color:#7ca48f}
.settings-list{overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:23px 23px 23px 9px;background:rgba(255,255,255,.59);box-shadow:0 15px 42px rgba(75,70,103,.085);backdrop-filter:blur(18px)}.settings-list article,.settings-list>button{width:100%;min-height:68px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;padding:11px 13px;border:0;border-bottom:1px solid rgba(106,98,129,.07);color:inherit;background:transparent;text-align:left}.settings-list article:last-child{border:0}.settings-list i{width:37px;height:37px;display:grid;place-items:center;border-radius:13px;color:#7d9ec1;background:linear-gradient(145deg,rgba(var(--pink-rgb),.1),rgba(var(--blue-rgb),.14))}.settings-list div{min-width:0;display:grid;gap:4px}.settings-list strong{font-size: calc(10px * var(--font-scale, 1))}.settings-list span{overflow:hidden;color:#9993a3;font-size: calc(7px * var(--font-scale, 1));text-overflow:ellipsis;white-space:nowrap}.settings-list b{padding:4px 7px;border-radius:999px;color:#65927f;background:rgba(96,180,145,.09);font-size: calc(7px * var(--font-scale, 1))}.settings-list b.warning{color:#a56e8f;background:rgba(var(--pink-rgb),.1)}.hub-connection-row:active{background:rgba(var(--blue-rgb),.055)}.connection-notice{display:flex;align-items:center;justify-content:center;gap:5px;margin:9px 12px 0;color:#65927f;font-size:calc(8px * var(--font-scale, 1))}
.interface-settings-entry{width:100%;min-height:64px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:11px;margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.82);border-radius:19px 19px 19px 8px;color:#70697d;background:linear-gradient(140deg,rgba(255,255,255,.67),rgba(246,248,252,.5));box-shadow:0 12px 32px rgba(75,70,103,.07);text-align:left;backdrop-filter:blur(16px)}.interface-settings-entry>i{width:37px;height:37px;display:grid;place-items:center;border-radius:13px;color:#987aa0;background:linear-gradient(145deg,rgba(var(--pink-rgb),.13),rgba(var(--blue-rgb),.12))}.interface-settings-entry>span{min-width:0;display:grid;gap:4px}.interface-settings-entry strong{font-size:calc(10px * var(--font-scale, 1))}.interface-settings-entry small{color:#9a94a3;font-size:calc(7px * var(--font-scale, 1))}.interface-settings-entry>b{padding:4px 7px;border-radius:999px;color:#7187a2;background:rgba(var(--blue-rgb),.1);font-size:calc(7px * var(--font-scale, 1))}.interface-settings-entry>svg{color:#aaa3b0}
.refresh-button,.logout-button{width:100%;height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:15px;font-size: calc(9px * var(--font-scale, 1));font-weight:700}.refresh-button{margin-top:17px;border:1px solid rgba(255,255,255,.82);color:#687897;background:rgba(255,255,255,.64)}.logout-button{margin-top:8px;border:0;color:#ad6175;background:rgba(217,118,143,.085)}.refresh-button:disabled{opacity:.55}.settings-note{margin:11px 22px 0;color:#a19baa;font-size: calc(7px * var(--font-scale, 1));line-height:1.6;text-align:center}
.sheet-backdrop{position:fixed;z-index:50;inset:0;display:flex;align-items:flex-end;background:rgba(42,39,59,.23);backdrop-filter:blur(6px)}.profile-editor{width:100%;max-height:88dvh;overflow:auto;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:rgba(251,250,253,.97);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.profile-editor header{display:flex;align-items:center;justify-content:space-between}.profile-editor header span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.profile-editor h2{margin:3px 0 0;font-size: calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.profile-editor header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.editor-fields{display:grid;gap:12px;margin-top:18px}.editor-fields label{display:grid;gap:6px}.editor-fields label>span{color:#70697d;font-size: calc(9px * var(--font-scale, 1));font-weight:700}.editor-fields input,.editor-fields textarea{width:100%;border:1px solid rgba(112,104,137,.13);border-radius:14px;outline:0;color:var(--ink);background:rgba(255,255,255,.78);font-size: calc(11px * var(--font-scale, 1))}.editor-fields input{height:44px;padding:0 12px}.editor-fields textarea{min-height:84px;padding:11px 12px;line-height:1.55;resize:none}.editor-fields input:focus,.editor-fields textarea:focus{border-color:rgba(var(--pink-rgb),.42);box-shadow:0 0 0 4px rgba(var(--pink-rgb),.07)}.editor-error{margin:11px 0 0;color:#aa5970;font-size: calc(8px * var(--font-scale, 1));text-align:center}.save-profile{width:100%;height:47px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:16px;border:0;border-radius:15px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size: calc(10px * var(--font-scale, 1));font-weight:700}.save-profile:disabled{opacity:.55}
.connection-sheet{width:100%;max-height:88dvh;overflow:auto;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 95% 5%,rgba(var(--blue-rgb),.15),transparent 31%),radial-gradient(circle at 2% 85%,rgba(var(--pink-rgb),.12),transparent 34%),rgba(251,250,253,.98);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.connection-sheet header{display:flex;align-items:center;justify-content:space-between}.connection-sheet header span{color:#8198b1;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.connection-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.connection-sheet header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.connection-intro{margin:14px 2px 0;color:#928b9a;font-size:calc(8px * var(--font-scale, 1));line-height:1.65}.connection-tabs{display:grid;grid-template-columns:1fr 1fr;margin-top:15px;padding:4px;border-radius:14px;background:rgba(112,104,136,.07)}.connection-tabs button{height:38px;border:0;border-radius:11px;color:#918a9a;background:transparent;font-size:calc(9px * var(--font-scale, 1));font-weight:700}.connection-tabs button.active{color:#5f5a6d;background:rgba(255,255,255,.92);box-shadow:0 7px 18px rgba(86,79,112,.1)}.connection-field{display:grid;gap:7px;margin-top:15px}.connection-field>span{color:#70697d;font-size:calc(9px * var(--font-scale, 1));font-weight:700}.connection-field>div{height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;border:1px solid rgba(112,104,137,.13);border-radius:15px;background:rgba(255,255,255,.75)}.connection-field>div:focus-within{border-color:rgba(var(--blue-rgb),.4);box-shadow:0 0 0 4px rgba(var(--blue-rgb),.07)}.connection-field svg{flex:0 0 auto;color:#8b9db2}.connection-field input{min-width:0;flex:1;padding:0;border:0;outline:0;background:transparent;font-size:calc(10px * var(--font-scale, 1))}.connection-field textarea{width:100%;min-height:92px;padding:11px 12px;border:1px solid rgba(112,104,137,.13);border-radius:15px;outline:0;background:rgba(255,255,255,.75);font-size:calc(9px * var(--font-scale, 1));line-height:1.5;resize:none}.connection-field small{color:#aaa3b0;font-size:calc(7px * var(--font-scale, 1));line-height:1.5}.scan-hub-button{width:100%;min-height:59px;display:flex;align-items:center;gap:11px;margin-top:14px;padding:10px 13px;border:1px solid rgba(var(--blue-rgb),.16);border-radius:16px;color:#7187a2;background:linear-gradient(125deg,rgba(var(--pink-rgb),.075),rgba(var(--blue-rgb),.1));text-align:left}.scan-hub-button>span{display:grid;gap:3px}.scan-hub-button strong{font-size:calc(9px * var(--font-scale, 1))}.scan-hub-button small{color:#9891a1;font-size:calc(7px * var(--font-scale, 1))}.connection-error{margin:11px 2px 0;color:#ad6175;font-size:calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}.apply-connection{width:100%;height:47px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:14px;border:0;border-radius:15px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size:calc(10px * var(--font-scale, 1));font-weight:700}.apply-connection:disabled,.scan-hub-button:disabled,.connection-sheet header button:disabled{opacity:.55}
.interface-settings-sheet{width:100%;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 92% 5%,rgba(var(--blue-rgb),.13),transparent 31%),radial-gradient(circle at 4% 80%,rgba(var(--pink-rgb),.12),transparent 35%),rgba(251,250,253,.98);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.interface-settings-sheet header{display:flex;align-items:center;justify-content:space-between}.interface-settings-sheet header span{color:#a07a9e;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.interface-settings-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.interface-settings-sheet header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.font-size-card{margin-top:18px;padding:16px;border:1px solid rgba(255,255,255,.82);border-radius:23px 23px 23px 9px;background:rgba(255,255,255,.65);box-shadow:0 15px 38px rgba(75,70,103,.09);backdrop-filter:blur(18px)}.font-setting-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px}.font-setting-head>i{width:39px;height:39px;display:grid;place-items:center;border-radius:14px;color:#987aa0;background:linear-gradient(145deg,rgba(var(--pink-rgb),.14),rgba(var(--blue-rgb),.14))}.font-setting-head>div{display:grid;gap:4px}.font-setting-head strong{color:#575160;font-size:calc(11px * var(--font-scale, 1))}.font-setting-head span{color:#9992a2;font-size:calc(7px * var(--font-scale, 1))}.font-setting-head>b{padding:5px 8px;border-radius:999px;color:#fff;background:linear-gradient(120deg,#c986ad,#849ac6);font-size:calc(8px * var(--font-scale, 1))}.font-preview{display:grid;gap:5px;margin-top:15px;padding:14px;border:1px solid rgba(116,108,137,.07);border-radius:16px;background:linear-gradient(135deg,rgba(var(--pink-rgb),.055),rgba(var(--blue-rgb),.065))}.font-preview>span{color:#a07a9e;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.12em}.font-preview>strong{color:#56505f;font-size:calc(13px * var(--font-scale, 1))}.font-preview>small{color:#918a99;font-size:calc(8px * var(--font-scale, 1))}.font-scale-control{height:47px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;margin-top:8px;color:#9891a1;font-size:calc(8px * var(--font-scale, 1))}.font-scale-control input{width:100%;accent-color:#9b87b5}.font-scale-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.font-scale-footer small{color:#aaa3b0;font-size:calc(7px * var(--font-scale, 1))}.font-scale-footer button{padding:6px 8px;border:0;border-radius:9px;color:#87718d;background:rgba(var(--pink-rgb),.09);font-size:calc(7px * var(--font-scale, 1));font-weight:700}.font-scale-error{margin:10px 0 0;color:#aa5970;font-size:calc(8px * var(--font-scale, 1));text-align:center}
.crop-backdrop{position:fixed;z-index:70;inset:0;display:grid;place-items:center;padding:calc(18px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom));background:rgba(40,37,56,.34);backdrop-filter:blur(9px)}.avatar-cropper{width:min(100%,390px);padding:18px;border:1px solid rgba(255,255,255,.78);border-radius:28px;background:linear-gradient(145deg,rgba(255,252,254,.98),rgba(243,247,252,.98));box-shadow:0 28px 80px rgba(50,45,69,.3)}.avatar-cropper header{display:flex;align-items:center;justify-content:space-between}.avatar-cropper header span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.avatar-cropper h2{margin:3px 0 0;color:#4d4859;font-size: calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.avatar-cropper header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.crop-stage{position:relative;width:min(74vw,292px);overflow:hidden;aspect-ratio:1;margin:18px auto 0;border-radius:28px;background:#dedbe5;box-shadow:inset 0 0 0 1px rgba(77,70,98,.1),0 17px 35px rgba(75,68,97,.17)}.crop-stage canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}.crop-stage canvas:active{cursor:grabbing}.crop-guide{position:absolute;inset:10px;border:1px solid rgba(255,255,255,.76);border-radius:21px;box-shadow:0 0 0 1px rgba(68,61,86,.08);pointer-events:none}.avatar-cropper>p{margin:12px 0 0;color:#918a9b;font-size: calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}.crop-zoom{height:44px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:8px;padding:0 5px;color:#8a8295}.crop-zoom input{width:100%;accent-color:#a785b3}.crop-error{color:#aa5970!important}.crop-actions{display:grid;grid-template-columns:1fr 1.45fr;gap:9px;margin-top:12px}.crop-actions button{height:45px;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:14px;color:#797283;background:rgba(105,97,131,.08);font-size: calc(9px * var(--font-scale, 1));font-weight:700}.crop-actions button:last-child{color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0)}.crop-actions button:disabled,.avatar-cropper header button:disabled{opacity:.55}
</style>
