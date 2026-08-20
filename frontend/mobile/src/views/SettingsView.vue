<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef } from "vue";
import {
  AlertTriangle,
  Check,
  Blocks,
  ChevronRight,
  Cloud,
  Archive,
  Download,
  Link2,
  LogOut,
  Pencil,
  RefreshCw,
  ScanLine,
  Server,
  Smartphone,
  Settings2,
  ShieldCheck,
  Sparkles,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut
} from "@lucide/vue";
import { Browser } from "@capacitor/browser";
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
import { useModuleStore } from "../stores/modules";
import { useLocalHub } from "../lib/local-hub";
import { pairAndroidLocalHub } from "../lib/hub-pairing";
import { runCompletePairing } from "../lib/complete-pairing";

const router = useRouter();
const session = useSessionStore();
const data = useDataStore();
const modules = useModuleStore();
const localHub = useLocalHub();
const interfaceSettings = useInterfaceSettings();
const refreshing = ref(false);
const hubManagementOpen = ref(false);
const connectionOpen = ref(false);
const connectionMode = ref<"address" | "pair">("pair");
const connectionUrl = ref("");
const pairingCode = ref("");
const connectionError = ref("");
const connectionNotice = ref("");
const scanning = ref(false);
const reconnecting = ref(false);
const localHubPairingOpen = ref(false);
const localHubPairingCode = ref("");
const localHubPairingBusy = ref(false);
const localHubPairingState = ref("");
const localHubPairingError = ref("");
const localHubSwitching = ref(false);
const localHubSwitchError = ref("");
const forcedTakeoverOpen = ref(false);
const forcedTakeoverConfirmed = ref(false);
const localHubSyncing = ref(false);
const localHubSyncError = ref("");
const interfaceOpen = ref(false);
const archiveOpen = ref(false);
const archivePassword = ref("");
const archiveBusy = ref(false);
const archiveNotice = ref("");
const archiveError = ref("");
const archiveInput = ref<HTMLInputElement | null>(null);
const archiveFile = shallowRef<File | null>(null);
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
const moduleError = ref("");
const crop = reactive({ baseScale: 1, offsetX: 0, offsetY: 0 });
const aiState = ref<{hasApiKey:boolean;model?:string}|null>(null);
const form = reactive({ displayName: "", preferredName: "", occupation: "", bio: "" });
let cropDrag: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;
let hubStatusTimer: number | null = null;

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
const archiveNeedsDesktopHub = computed(() => session.serverUrl.value === "capacitor://local-hub");
const isLocalHubActive = computed(() =>
  session.serverUrl.value === "capacitor://local-hub" || localHub.status.value?.role === "active"
);
const currentHubTitle = computed(() => isLocalHubActive.value ? "手机 Hub" : "电脑 Hub");
const currentHubDescription = computed(() => {
  if (isLocalHubActive.value) {
    return localHub.status.value?.state === "forced_active"
      ? "手机正在临时接管，电脑恢复后会先核对数据"
      : "聊天与数据由这台手机处理，电脑 Hub 保持同步";
  }
  return "聊天与数据由电脑处理，手机 Hub 保存副本并待命";
});
const currentHubBadge = computed(() => {
  if (localHub.status.value?.state === "forced_active") return "临时接管";
  if (data.syncState.value === "error" && !isLocalHubActive.value) return "通道重连中";
  return "当前使用";
});
const localHubDescription = computed(() => {
  const state = localHub.status.value;
  if (!localHub.available) return "仅 Android 安装包提供";
  if (!state?.running) return localHub.error.value || "正在准备本机数据仓";
  if (!state.configured) return "本机数据仓已启动，等待与电脑 Hub 配对";
  if (state.bootstrap?.status !== "completed" || !state.integrity) {
    return "全量副本未完成 · 请重新配对迁入";
  }
  if (state.state === "forced_active") return "手机已临时接管，正在等待电脑 Hub 上线确认";
  const records = `${state.documentCount} 条记录`;
  return state.role === "active" ? `当前由手机承载 · ${records}` : `本机副本待命 · ${records}`;
});
const localHubBootstrapReady = computed(() =>
  localHub.status.value?.bootstrap?.status === "completed" &&
  Boolean(localHub.status.value?.integrity)
);
const localHubBadge = computed(() => {
  const state = localHub.status.value;
  if (state?.state === "forced_active") return "接管中";
  if (state?.role === "active") return "当前";
  if (!state?.configured) return "待配对";
  return localHubBootstrapReady.value ? "待命" : "待恢复";
});
const hubSynchronization = computed(() => localHub.status.value?.synchronization || null);
const hubSyncProgress = computed(() => {
  const sync = hubSynchronization.value;
  if (localHubSyncing.value && sync?.state !== "syncing") return 3;
  if (sync?.state === "syncing" || sync?.state === "synced") return Math.max(0, Math.min(100, Number(sync.progress || 0)));
  const state = localHub.status.value;
  if (!state?.configured) return 0;
  if (localHubBootstrapReady.value) return sync?.state === "error" ? Math.max(0, Number(sync.progress || 0)) : 0;
  const total = Math.max(0, Number(state.mediaTotalBytes || 0));
  const received = Math.max(0, Math.min(total, Number(state.mediaBytes || 0)));
  if (state.bootstrap?.status === "restored") return 92;
  if (state.bootstrap?.status === "waiting_blobs") return Math.round(35 + (total > 0 ? received / total : 0) * 50);
  return 15;
});
const hubSyncTone = computed(() => {
  if (!localHub.status.value?.configured || !localHubBootstrapReady.value) return "preparing";
  if (localHubSyncing.value) return "syncing";
  return hubSynchronization.value?.state || "idle";
});
const hubSyncLabel = computed(() => {
  if (!localHub.status.value?.configured) return "未建立同步";
  if (!localHubBootstrapReady.value) return `副本准备中 ${hubSyncProgress.value}%`;
  if (hubSynchronization.value?.state === "syncing" || localHubSyncing.value) return `同步中 ${hubSyncProgress.value}%`;
  if (hubSynchronization.value?.state === "synced") return "已同步";
  if (hubSynchronization.value?.state === "error") return "同步失败";
  return "等待首次同步";
});
const hubSyncMessage = computed(() => {
  if (!localHub.status.value?.configured) return "先在连接管理中完成手机 Hub 配对";
  if (!localHubBootstrapReady.value) return localHubDescription.value;
  if (hubSynchronization.value?.message) return readableLocalHubError(hubSynchronization.value.message);
  return "点击立即同步，确认电脑 Hub 与手机 Hub 的数据完全一致";
});

function readableLocalHubError(value: unknown) {
  const message = String(value || "");
  if (message.includes("PEER_AUTH_INVALID")) {
    return "安全凭据已失效，请扫描电脑端的一体化配对码重新建立信任；本机历史不会删除";
  }
  return message;
}
const desktopHubSyncLabel = computed(() => {
  if (hubSyncTone.value === "syncing") return "同步中";
  if (hubSyncTone.value === "synced") return "已同步";
  if (hubSyncTone.value === "error") return isLocalHubActive.value ? "待重试" : "连接异常";
  if (hubSyncTone.value === "preparing") return "数据源";
  return isLocalHubActive.value ? "同步端" : "承载中";
});
const phoneHubSyncLabel = computed(() => {
  if (hubSyncTone.value === "syncing") return "同步中";
  if (hubSyncTone.value === "synced") return "已同步";
  if (hubSyncTone.value === "error") return "待重试";
  if (hubSyncTone.value === "preparing") return localHub.status.value?.configured ? `${hubSyncProgress.value}%` : "未配对";
  return isLocalHubActive.value ? "承载中" : "待同步";
});

async function pollHubStatus() {
  if (document.visibilityState !== "visible" || router.currentRoute.value.path !== "/settings") return;
  await localHub.refresh().catch(() => undefined);
}

async function openBatteryOptimizationSettings() {
  localHubSyncError.value = "";
  try {
    await localHub.openBatteryOptimizationSettings();
  } catch (cause) {
    localHubSyncError.value = cause instanceof Error ? cause.message : "无法打开系统后台运行设置。";
  }
}

onMounted(() => {
  void pollHubStatus();
  hubStatusTimer = window.setInterval(() => { void pollHubStatus(); }, 1_200);
});

onUnmounted(() => {
  if (hubStatusTimer !== null) window.clearInterval(hubStatusTimer);
  hubStatusTimer = null;
});

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

function openArchiveSettings() {
  archiveNotice.value = archiveNeedsDesktopHub.value
    ? "当前由手机 Hub 独立运行。请先切回已连接的电脑 Hub，再导出或恢复兼容 .aetherx 完整存档。"
    : "";
  archiveError.value = "";
  archiveFile.value = null;
  archiveOpen.value = true;
}

function closeArchiveSettings() {
  if (archiveBusy.value) return;
  archiveOpen.value = false;
  archivePassword.value = "";
  archiveFile.value = null;
  archiveNotice.value = "";
  archiveError.value = "";
}

function validateArchivePassword() {
  if (archivePassword.value.length >= 8) return true;
  archiveError.value = "存档密码至少需要 8 个字符。";
  return false;
}

async function exportFullArchive() {
  if (archiveNeedsDesktopHub.value) return;
  if (!validateArchivePassword()) return;
  archiveBusy.value = true;
  archiveError.value = "";
  archiveNotice.value = "正在加密并整理完整存档……";
  try {
    const api = session.requireApi();
    const result = await api.createArchiveExport(archivePassword.value);
    await Browser.open({ url: api.archiveDownloadUrl(result.downloadPath) });
    archiveNotice.value = "已交给系统浏览器下载，请妥善保存存档和密码。";
  } catch (error) {
    archiveError.value = (error as Error).message || "完整存档导出失败。";
    archiveNotice.value = "";
  } finally {
    archiveBusy.value = false;
  }
}

function chooseArchiveFile() {
  if (!archiveBusy.value && !archiveNeedsDesktopHub.value) archiveInput.value?.click();
}

function handleArchiveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  archiveFile.value = file;
  archiveError.value = file && !file.name.toLowerCase().endsWith(".aetherx")
    ? "请选择扩展名为 .aetherx 的完整存档。"
    : "";
  archiveNotice.value = "";
  input.value = "";
}

async function restoreFullArchive() {
  if (archiveNeedsDesktopHub.value) return;
  if (!validateArchivePassword()) return;
  if (!archiveFile.value || !archiveFile.value.name.toLowerCase().endsWith(".aetherx")) {
    archiveError.value = "请先选择要恢复的 .aetherx 存档。";
    return;
  }
  archiveBusy.value = true;
  archiveError.value = "";
  archiveNotice.value = "正在校验并完整恢复，期间请不要关闭应用……";
  try {
    const result = await session.requireApi().restoreArchive(archiveFile.value, archivePassword.value);
    await data.resetAfterArchiveRestore(result.resetCursor);
    archiveFile.value = null;
    archiveNotice.value = "完整恢复成功，聊天、记忆与媒体已经切换到存档状态。";
  } catch (error) {
    archiveError.value = (error as Error).message || "完整恢复失败，现有数据没有变化。";
    archiveNotice.value = "";
  } finally {
    archiveBusy.value = false;
  }
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
  connectionMode.value = "pair";
  connectionError.value = "";
  connectionOpen.value = true;
}

function openDesktopHubSettings() {
  hubManagementOpen.value = false;
  openConnectionSettings();
}

function openPhoneHubSettings() {
  hubManagementOpen.value = false;
  openLocalHubPairing();
}

async function scanDesktopLoginCode() {
  connectionOpen.value = true;
  connectionMode.value = "pair";
  connectionError.value = "";
  await scanHubCode();
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
    const desktopLogin = parseDesktopLoginCode(code);
    if (desktopLogin) {
      connectionNotice.value = "正在由手机 Hub 授权电脑登录…";
      await localHub.authorizeDesktopLogin(desktopLogin);
      connectionNotice.value = "电脑登录已授权，请回到电脑继续";
    } else if (/^https?:\/\//i.test(code)) {
      connectionUrl.value = code.replace(/\/+$/, "");
      connectionMode.value = "address";
    } else {
      pairingCode.value = code;
      connectionMode.value = "pair";
    }
  } catch (cause) {
    const message = desktopLoginErrorMessage(cause);
    if (!/cancel|取消/i.test(message)) connectionError.value = message;
  } finally {
    scanning.value = false;
  }
}

function desktopLoginErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause || "");
  if (message.includes("LOCAL_HUB_NOT_ACTIVE")) {
    return "当前不是手机 Hub，请先切换到手机 Hub，再扫描电脑登录码。";
  }
  if (message.includes("DESKTOP_LOGIN_COMPUTER_UNREACHABLE")) {
    return "手机暂时连接不到这台电脑，请确认两台设备处于同一网络后重试。";
  }
  if (message.includes("DESKTOP_LOGIN_CODE_INVALID") || message.includes("CHALLENGE_EXPIRED")) {
    return "电脑登录码已经过期，请在电脑端重新生成。";
  }
  if (message.includes("PEER_AUTH_INVALID")) {
    return "手机 Hub 的安全凭据已失效，请扫描电脑登录页的新二维码自动恢复。";
  }
  return message || "没有识别到有效的连接二维码。";
}

function parseDesktopLoginCode(code: string) {
  try {
    const url = new URL(code);
    if (url.protocol !== "aetherx:" || url.hostname !== "desktop-login") return null;
    const challengeId = String(url.searchParams.get("id") || "").trim();
    const secret = String(url.searchParams.get("secret") || "").trim();
    const expiresAt = Number(url.searchParams.get("expiresAt"));
    const endpoints = url.searchParams.getAll("e")
      .map((endpoint) => endpoint.trim().replace(/\/+$/, ""))
      .filter((endpoint) => /^https?:\/\//i.test(endpoint));
    if (!challengeId || secret.length < 32 || !Number.isFinite(expiresAt) || endpoints.length === 0) {
      throw new Error("电脑登录二维码不完整，请在电脑端重新生成。");
    }
    return { challengeId, secret, expiresAt, endpoints };
  } catch (cause) {
    if (/^aetherx:\/\/desktop-login/i.test(code)) {
      throw cause instanceof Error ? cause : new Error("电脑登录二维码无效。");
    }
    return null;
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
      const completed = await runCompletePairing(pairingCode.value, {
        pairClient: (clientCode) => session.pair(clientCode),
        pairHub: (hubCode) => pairAndroidLocalHub(
          hubCode,
          localHub,
          (state) => { connectionNotice.value = state; }
        ),
        onState: (state) => { connectionNotice.value = state; }
      });
      if (!completed) await session.pair(pairingCode.value);
      if (completed) await localHub.refresh();
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

function openLocalHubPairing() {
  localHubPairingCode.value = "";
  localHubPairingState.value = "";
  localHubPairingError.value = "";
  localHubPairingOpen.value = true;
}

async function scanLocalHubCode() {
  if (scanning.value || localHubPairingBusy.value) return;
  scanning.value = true;
  localHubPairingError.value = "";
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: "扫描电脑端生成的手机 Local Hub 配对码",
      scanButton: false,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING }
    });
    if (result.ScanResult) localHubPairingCode.value = result.ScanResult;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "没有读取到二维码。";
    if (!/cancel|取消/i.test(message)) localHubPairingError.value = message;
  } finally {
    scanning.value = false;
  }
}

async function pairLocalHub() {
  if (localHubPairingBusy.value || !localHubPairingCode.value.trim()) return;
  localHubPairingBusy.value = true;
  localHubPairingError.value = "";
  try {
    await pairAndroidLocalHub(
      localHubPairingCode.value,
      localHub,
      (state) => { localHubPairingState.value = state; }
    );
    await localHub.refresh();
    localHubPairingState.value = "手机 Hub 已保存首份结构化副本";
    window.setTimeout(() => { localHubPairingOpen.value = false; }, 900);
  } catch (cause) {
    localHubPairingState.value = "";
    localHubPairingError.value = cause instanceof Error ? cause.message : "手机 Hub 没有完成配对。";
  } finally {
    localHubPairingBusy.value = false;
  }
}

async function switchToLocalHub() {
  if (localHubSwitching.value) return;
  localHubSwitching.value = true;
  localHubSwitchError.value = "";
  connectionNotice.value = "";
  try {
    await session.activateLocalHub();
    connectionNotice.value = "已安全切换到手机 Hub，电脑关闭后仍可继续使用";
    await Promise.all([
      modules.hydrate(true).catch(() => undefined),
      session.requireApi().aiConfig().then((value) => { aiState.value = value; }).catch(() => undefined)
    ]);
  } catch (cause) {
    localHubSwitchError.value = cause instanceof Error ? cause.message : "没有成功切换到手机 Hub。";
  } finally {
    localHubSwitching.value = false;
  }
}

async function switchToDesktopHub() {
  if (localHubSwitching.value) return;
  localHubSwitching.value = true;
  localHubSwitchError.value = "";
  connectionNotice.value = "";
  try {
    await session.activateDesktopHub();
    connectionNotice.value = "已安全切换到电脑 Hub，手机副本会继续待命同步";
    await modules.hydrate(true).catch(() => undefined);
  } catch (cause) {
    localHubSwitchError.value = cause instanceof Error ? cause.message : "没有成功切换到电脑 Hub。";
  } finally {
    localHubSwitching.value = false;
  }
}

function openForcedTakeover() {
  forcedTakeoverConfirmed.value = false;
  localHubSwitchError.value = "";
  forcedTakeoverOpen.value = true;
}

async function confirmForcedTakeover() {
  if (!forcedTakeoverConfirmed.value || localHubSwitching.value) return;
  localHubSwitching.value = true;
  localHubSwitchError.value = "";
  connectionNotice.value = "";
  try {
    await session.forceActivateLocalHub();
    forcedTakeoverOpen.value = false;
    connectionNotice.value = "手机 Hub 已接管；电脑恢复连接后会先核对分歧，再继续同步";
    await Promise.all([
      modules.hydrate(true).catch(() => undefined),
      session.requireApi().aiConfig().then((value) => { aiState.value = value; }).catch(() => undefined)
    ]);
  } catch (cause) {
    localHubSwitchError.value = cause instanceof Error ? cause.message : "手机 Hub 强制接管失败。";
  } finally {
    localHubSwitching.value = false;
  }
}

async function synchronizeLocalHub() {
  if (localHubSyncing.value || localHubSwitching.value) return;
  localHubSyncing.value = true;
  localHubSyncError.value = "";
  connectionNotice.value = "";
  try {
    const before = localHub.status.value || await localHub.refresh();
    if (!before?.configured || before.bootstrap?.status !== "completed") {
      throw new Error("手机 Hub 尚未完成全量迁入，暂时不能执行双向同步。");
    }
    const result = await localHub.synchronize();
    const changed = before.role === "active"
      ? Number(result.pushed || 0)
      : Number(result.applied || 0);
    connectionNotice.value = before.role === "active"
      ? `已同步到电脑 Hub${changed ? ` · 推送 ${changed} 项变更` : " · 两端已一致"}`
      : `已同步到手机 Hub${changed ? ` · 接收 ${changed} 项变更` : " · 两端已一致"}`;
  } catch (cause) {
    localHubSyncError.value = cause instanceof Error ? cause.message : "双 Hub 同步没有完成。";
  } finally {
    localHubSyncing.value = false;
  }
}

async function logout() {
  data.stopSync();
  await session.logout();
  await router.replace("/login");
}

async function toggleModule(id: string, enabled: boolean) {
  moduleError.value = "";
  try {
    await modules.setEnabled(id, enabled);
    await data.refreshAll();
  } catch (error) {
    moduleError.value = (error as Error).message || "模块状态没有保存成功。";
  }
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

    <div class="section-heading"><div><span>ACTIVE HUB</span><h2>当前 Hub</h2></div><ShieldCheck :size="18" /></div>
    <section class="current-hub-card" :class="{ mobile: isLocalHubActive }">
      <div class="current-hub-head">
        <span><i />当前连接</span>
        <b :class="{ warning: currentHubBadge === '通道重连中' }">{{ currentHubBadge }}</b>
      </div>
      <div class="current-hub-main">
        <i class="current-hub-icon"><Smartphone v-if="isLocalHubActive" :size="25" /><Server v-else :size="25" /></i>
        <div><h3>{{ currentHubTitle }}</h3><p>{{ currentHubDescription }}</p></div>
      </div>
      <div class="hub-route" aria-label="电脑 Hub 与手机 Hub 的当前状态">
        <div :class="{ active: !isLocalHubActive }"><Server :size="18" /><span>电脑 Hub</span><b>{{ desktopHubSyncLabel }}</b></div>
        <i><span /><Link2 :size="14" /><span /></i>
        <div :class="{ active: isLocalHubActive }"><Smartphone :size="18" /><span>手机 Hub</span><b>{{ phoneHubSyncLabel }}</b></div>
      </div>
      <div class="hub-replication-status" :class="hubSyncTone">
        <div><span><Cloud :size="14" />双 Hub 同步</span><b>{{ hubSyncLabel }}</b></div>
        <p>{{ hubSyncMessage }}</p>
        <i role="progressbar" :aria-valuenow="hubSyncProgress" aria-valuemin="0" aria-valuemax="100"><b :style="{ width: `${hubSyncProgress}%` }" /></i>
      </div>
      <div v-if="localHub.status.value?.configured && localHubBootstrapReady" class="hub-action-row">
        <button
          class="hub-switch-button"
          type="button"
          :disabled="localHubSwitching || localHubSyncing"
          @click="isLocalHubActive ? switchToDesktopHub() : switchToLocalHub()"
        >
          <Server v-if="isLocalHubActive" :size="17" /><Smartphone v-else :size="17" />
          {{ localHubSwitching ? '正在校验并切换…' : `切换到${isLocalHubActive ? '电脑' : '手机'} Hub` }}
        </button>
        <button class="hub-sync-button" type="button" :disabled="localHubSyncing || localHubSwitching" @click="synchronizeLocalHub">
          <RefreshCw :size="17" :class="{ spin: localHubSyncing }" />{{ localHubSyncing ? '同步中…' : '立即同步' }}
        </button>
      </div>
      <button
        v-if="localHub.status.value?.configured && localHub.status.value?.batteryOptimizationExempt === false"
        class="hub-background-warning"
        type="button"
        @click="openBatteryOptimizationSettings"
      >
        <AlertTriangle :size="16" />
        <span><strong>允许手机 Hub 后台运行</strong><small>关闭 AetherX 与 Tailscale 的电池优化，息屏后才能持续接收切换与同步请求</small></span>
        <ChevronRight :size="15" />
      </button>
      <button class="hub-management-entry" type="button" @click="hubManagementOpen = true">
        <span>连接管理</span><small>地址、配对与故障处理</small><ChevronRight :size="16" />
      </button>
      <button
        v-if="localHub.available && localHub.status.value?.configured && localHub.status.value?.role === 'active'"
        class="desktop-login-scan-entry"
        type="button"
        :disabled="scanning || reconnecting"
        @click="scanDesktopLoginCode"
      >
        <ScanLine :size="17" />
        <span><strong>扫码登录电脑</strong><small>用当前手机 Hub 直接授权电脑进入</small></span>
        <ChevronRight :size="16" />
      </button>
    </section>
    <p v-if="connectionNotice" class="connection-notice"><Check :size="13" />{{ connectionNotice }}</p>
    <p v-if="localHubSwitchError" class="connection-error">{{ localHubSwitchError }}</p>
    <p v-if="localHubSyncError" class="connection-error">{{ localHubSyncError }}</p>

    <div class="section-heading module-heading"><div><span>CAPABILITIES</span><h2>功能模块</h2></div><Blocks :size="18" /></div>
    <section class="module-control-list">
      <label v-for="module in modules.modules.value" :key="module.id" :class="{ core: module.core, disabled: !module.enabled }">
        <span><strong>{{ module.name }}</strong><small>{{ module.description }}</small></span>
        <input
          type="checkbox"
          :checked="module.enabled"
          :disabled="module.core || modules.loading.value"
          @change="toggleModule(module.id, ($event.target as HTMLInputElement).checked)"
        />
        <i aria-hidden="true"><b /></i>
      </label>
    </section>
    <p v-if="moduleError" class="module-error">{{ moduleError }}</p>

    <div class="section-heading compact-heading"><div><span>SETTINGS</span><h2>更多设置</h2></div><Settings2 :size="18" /></div>
    <section class="settings-list">
      <article>
        <i><Sparkles :size="18"/></i>
        <div><strong>AI 接入</strong><span>{{ aiState?.model || '跟随当前 Hub 的模型配置' }}</span></div>
        <b :class="{ warning: !aiState?.hasApiKey }">{{ aiState?.hasApiKey ? '就绪' : '未配置' }}</b>
      </article>
    </section>

    <button class="interface-settings-entry" type="button" @click="interfaceOpen = true">
      <i><Settings2 :size="18" /></i>
      <span><strong>应用设置</strong><small>字体大小与界面显示</small></span>
      <b>{{ interfaceSettings.fontScale.value }}%</b>
      <ChevronRight :size="17" />
    </button>

    <button class="archive-settings-entry" type="button" @click="openArchiveSettings">
      <i><Archive :size="18" /></i>
      <span><strong>完整存档</strong><small>导出全部数据，或把当前账号完整恢复到存档状态</small></span>
      <b>仅完整恢复</b>
      <ChevronRight :size="17" />
    </button>

    <button class="refresh-button" type="button" :disabled="refreshing" @click="refresh">
      <RefreshCw :size="17" :class="{spin:refreshing}"/>{{ refreshing ? '正在重新同步…' : '重新同步全部内容' }}
    </button>
    <button class="logout-button" type="button" @click="logout"><LogOut :size="17"/>退出这个账号</button>
    <p class="settings-note">退出只会清除这台手机上的登录凭证，不会删除电脑端保存的任何数据。</p>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="hubManagementOpen" class="sheet-backdrop" @click.self="hubManagementOpen = false">
          <section class="hub-management-sheet" role="dialog" aria-modal="true" aria-label="连接管理">
            <div class="sheet-handle" />
            <header>
              <div><span>HUB MANAGEMENT</span><h2>连接管理</h2></div>
              <button type="button" aria-label="关闭连接管理" @click="hubManagementOpen = false"><X :size="18" /></button>
            </header>
            <p class="connection-intro">这里只放低频的连接配置。日常查看和切换 Hub，直接使用上方“当前 Hub”卡片。</p>
            <div class="settings-list hub-management-list">
              <button class="hub-connection-row" type="button" @click="openDesktopHubSettings">
                <i><Server :size="18"/></i>
                <div><strong>电脑 Hub</strong><span>{{ session.serverUrl.value }}</span></div>
                <b>{{ isLocalHubActive ? '同步端' : '当前' }}</b>
              </button>
              <button class="hub-connection-row" type="button" @click="openPhoneHubSettings">
                <i><Smartphone :size="18"/></i>
                <div><strong>手机 Hub</strong><span>{{ localHubDescription }}</span></div>
                <b :class="{ warning: !localHub.status.value?.configured || !localHubBootstrapReady }">{{ localHubBadge }}</b>
              </button>
            </div>
            <button
              v-if="localHub.status.value?.role === 'standby' && localHubBootstrapReady"
              class="hub-force-entry"
              type="button"
              :disabled="localHubSwitching || localHubSyncing"
              @click="hubManagementOpen = false; openForcedTakeover()"
            >
              <AlertTriangle :size="14" />电脑 Hub 无法连接？进入强制接管
            </button>
          </section>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="connectionOpen" class="sheet-backdrop" @click.self="closeConnectionSettings">
        <form class="connection-sheet" role="dialog" aria-modal="true" aria-label="重新连接 Hub" @submit.prevent="applyHubConnection">
          <div class="sheet-handle" />
          <header>
            <div><span>HUB CONNECTION</span><h2>重新连接 Hub</h2></div>
            <button type="button" aria-label="关闭连接设置" :disabled="reconnecting || scanning" @click="closeConnectionSettings"><X :size="18" /></button>
          </header>
          <p class="connection-intro">扫描电脑端二维码后会自动检测局域网与 Anywhere，并选择当前可用的连接。</p>
          <div class="connection-tabs">
            <button type="button" :class="{ active: connectionMode === 'pair' }" @click="connectionMode = 'pair'; connectionError = ''">扫码自动连接</button>
            <button type="button" :class="{ active: connectionMode === 'address' }" @click="connectionMode = 'address'; connectionError = ''">手动地址（高级）</button>
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
        <div v-if="localHubPairingOpen" class="sheet-backdrop" @click.self="!localHubPairingBusy && (localHubPairingOpen = false)">
          <form class="connection-sheet" role="dialog" aria-modal="true" aria-label="配置手机 Local Hub" @submit.prevent="pairLocalHub">
            <div class="sheet-handle" />
            <header>
              <div><span>ANDROID LOCAL HUB</span><h2>把副本留在手机里</h2></div>
              <button type="button" aria-label="关闭" :disabled="localHubPairingBusy" @click="localHubPairingOpen = false"><X :size="18" /></button>
            </header>
            <p class="connection-intro">在电脑端“连接手机”里选择“把手机设为备用 Hub”，确认后会把结构化数据完整复制到本机数据仓。</p>
            <label class="connection-field pairing-code-field">
              <span>手机 Hub 配对码</span>
              <textarea v-model="localHubPairingCode" rows="4" placeholder="aetherx://hub-pair?…" />
              <small>配对密钥和同步密钥只会进入 Android Keystore，不写入网页缓存。</small>
            </label>
            <button class="scan-hub-button" type="button" :disabled="scanning || localHubPairingBusy" @click="scanLocalHubCode">
              <ScanLine :size="19" /><span><strong>{{ scanning ? '正在打开相机…' : '扫描手机 Hub 二维码' }}</strong><small>从电脑端建立受信任副本通道</small></span>
            </button>
            <p v-if="localHubPairingState" class="connection-notice"><RefreshCw :size="13" :class="{ spin: localHubPairingBusy }" />{{ localHubPairingState }}</p>
            <p v-if="localHubPairingError" class="connection-error">{{ localHubPairingError }}</p>
            <button class="apply-connection" type="submit" :disabled="localHubPairingBusy || !localHubPairingCode.trim()">
              <Link2 :size="17" />{{ localHubPairingBusy ? '正在建立手机副本…' : '配对并复制到手机' }}
            </button>
          </form>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="forcedTakeoverOpen" class="sheet-backdrop" @click.self="!localHubSwitching && (forcedTakeoverOpen = false)">
          <section class="takeover-sheet" role="dialog" aria-modal="true" aria-label="强制接管手机 Hub">
            <div class="sheet-handle" />
            <header>
              <div><span>FORCED TAKEOVER</span><h2>由手机临时接管</h2></div>
              <button type="button" aria-label="关闭" :disabled="localHubSwitching" @click="forcedTakeoverOpen = false"><X :size="18" /></button>
            </header>
            <div class="takeover-warning">
              <i><AlertTriangle :size="22" /></i>
              <div><strong>仅在电脑 Hub 确实无法恢复时使用</strong><p>手机会提升 Hub 代次并立即成为唯一写入端。电脑重新上线后，旧代未同步写入会被隔离，不会自动覆盖手机数据。</p></div>
            </div>
            <label class="takeover-confirm">
              <input v-model="forcedTakeoverConfirmed" type="checkbox" />
              <span>我确认电脑 Hub 当前离线，并理解可能需要手动处理分歧记录</span>
            </label>
            <button class="takeover-submit" type="button" :disabled="localHubSwitching || !forcedTakeoverConfirmed" @click="confirmForcedTakeover">
              <Smartphone :size="17" />{{ localHubSwitching ? '正在保存证据并接管…' : '确认由手机 Hub 接管' }}
            </button>
          </section>
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
        <div v-if="archiveOpen" class="sheet-backdrop" @click.self="closeArchiveSettings">
        <section class="archive-settings-sheet" role="dialog" aria-modal="true" aria-label="完整存档">
          <div class="sheet-handle" />
          <header>
            <div><span>FULL ARCHIVE</span><h2>完整存档</h2></div>
            <button type="button" aria-label="关闭完整存档" :disabled="archiveBusy" @click="closeArchiveSettings"><X :size="18" /></button>
          </header>

          <div class="archive-hero">
            <i><Archive :size="24" /></i>
            <div><strong>把小玄完整地带回来</strong><span>聊天、记忆、成长、手记、相册、AI 设置与原始媒体会作为一个整体保存和恢复。</span></div>
          </div>

          <label class="archive-password">
            <span>存档密码</span>
            <input v-model="archivePassword" type="password" minlength="8" maxlength="256" autocomplete="new-password" placeholder="至少 8 个字符" :disabled="archiveBusy || archiveNeedsDesktopHub" />
            <small>密码只用于加密存档。忘记后无法恢复，请单独妥善保存。</small>
          </label>

          <button class="archive-export-button" type="button" :disabled="archiveBusy || archiveNeedsDesktopHub" @click="exportFullArchive">
            <Download :size="18" /><span><strong>导出完整存档</strong><small>生成加密的 .aetherx 文件并交给系统下载</small></span>
          </button>

          <div class="archive-restore-card">
            <div><strong>完整恢复</strong><span>不会合并；当前账号的 AI 数据会整套替换为存档内容。</span></div>
            <input ref="archiveInput" class="archive-file-input" type="file" accept=".aetherx,application/vnd.aetherx.archive" @change="handleArchiveFile" />
            <button class="archive-file-button" type="button" :disabled="archiveBusy || archiveNeedsDesktopHub" @click="chooseArchiveFile">
              <Upload :size="17" />{{ archiveFile?.name || '选择 .aetherx 存档' }}
            </button>
            <p>登录密码、当前登录状态与已配对设备会保留；恢复前 Hub 会自动备份现有数据。</p>
            <button class="archive-restore-button" type="button" :disabled="archiveBusy || archiveNeedsDesktopHub || !archiveFile" @click="restoreFullArchive">
              {{ archiveBusy ? '正在处理存档……' : '确认完整恢复' }}
            </button>
          </div>

          <p v-if="archiveNotice" class="archive-notice"><Check :size="13" />{{ archiveNotice }}</p>
          <p v-if="archiveError" class="archive-error">{{ archiveError }}</p>
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
.current-hub-card{position:relative;overflow:hidden;padding:16px;border:1px solid rgba(255,255,255,.88);border-radius:27px 27px 27px 10px;background:radial-gradient(circle at 100% 0,rgba(var(--blue-rgb),.17),transparent 36%),linear-gradient(145deg,rgba(255,255,255,.82),rgba(244,248,253,.62));box-shadow:0 20px 52px rgba(71,75,105,.12);backdrop-filter:blur(22px)}.current-hub-card.mobile{background:radial-gradient(circle at 0 100%,rgba(var(--pink-rgb),.17),transparent 38%),linear-gradient(145deg,rgba(255,255,255,.83),rgba(252,246,250,.64))}.current-hub-head{display:flex;align-items:center;justify-content:space-between}.current-hub-head>span{display:flex;align-items:center;gap:6px;color:#7e7889;font-size:calc(8px * var(--font-scale,1));font-weight:800}.current-hub-head>span i{width:7px;height:7px;border-radius:50%;background:#5cb88f;box-shadow:0 0 0 5px rgba(92,184,143,.11)}.current-hub-head>b{padding:5px 9px;border-radius:999px;color:#fff;background:#659c84;font-size:calc(7px * var(--font-scale,1))}.current-hub-head>b.warning{background:#bd7890}.current-hub-main{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:13px;margin-top:15px}.current-hub-icon{width:51px;height:51px;display:grid;place-items:center;border-radius:18px;color:#678cab;background:rgba(255,255,255,.74);box-shadow:0 11px 28px rgba(69,79,105,.11)}.mobile .current-hub-icon{color:#a27395}.current-hub-main h3{margin:0;color:#454151;font-size:calc(21px * var(--font-scale,1));letter-spacing:-.035em}.current-hub-main p{margin:5px 0 0;color:#8e8796;font-size:calc(8px * var(--font-scale,1));line-height:1.55}.hub-route{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-top:17px;padding:11px;border:1px solid rgba(109,103,132,.07);border-radius:18px;background:rgba(255,255,255,.5)}.hub-route>div{min-width:0;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:2px 7px;color:#aaa4b0}.hub-route>div>span{overflow:hidden;color:#746e7d;font-size:calc(8px * var(--font-scale,1));font-weight:700;text-overflow:ellipsis;white-space:nowrap}.hub-route>div>b{grid-column:2;color:#aaa4b0;font-size:calc(6px * var(--font-scale,1));font-weight:600}.hub-route>div.active{color:#668e7b}.hub-route>div.active>b{color:#63947c}.hub-route>i{display:flex;align-items:center;color:#a9a3b0}.hub-route>i span{width:10px;height:1px;background:rgba(126,119,143,.25)}.hub-sync-state{display:flex;align-items:center;gap:6px;margin:12px 2px 0;color:#8d8795;font-size:calc(7px * var(--font-scale,1))}.hub-sync-state svg{color:#7797b5}.hub-action-row{display:grid;grid-template-columns:1.35fr .85fr;gap:9px;margin-top:15px}.hub-action-row button{min-width:0;height:46px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:15px;font-size:calc(8px * var(--font-scale,1));font-weight:800}.hub-sync-button{border:1px solid rgba(var(--blue-rgb),.18);color:#67829d;background:rgba(255,255,255,.62)}.hub-switch-button{border:0;color:#fff;background:linear-gradient(115deg,#bc88a8,#838fb8 56%,#709bc0);box-shadow:0 9px 20px rgba(114,116,154,.17)}.hub-action-row button:disabled{opacity:.52}.hub-management-entry{width:100%;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:7px;margin-top:10px;padding:9px 3px 0;border:0;border-top:1px solid rgba(112,105,133,.08);color:#736d7c;background:transparent;text-align:left}.hub-management-entry>span{font-size:calc(8px * var(--font-scale,1));font-weight:700}.hub-management-entry>small{color:#aaa3b0;font-size:calc(7px * var(--font-scale,1));}.hub-management-entry>svg{color:#aaa3b0}
.hub-background-warning{width:100%;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;margin-top:11px;padding:10px 11px;border:1px solid rgba(190,132,83,.18);border-radius:15px;color:#9c704d;background:rgba(255,246,230,.62);text-align:left}.hub-background-warning>span{display:grid;gap:2px}.hub-background-warning strong{font-size:calc(8px * var(--font-scale,1))}.hub-background-warning small{color:#a78d78;font-size:calc(7px * var(--font-scale,1));line-height:1.4}.hub-background-warning>svg:last-child{color:#b79272}
.settings-list{overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:23px 23px 23px 9px;background:rgba(255,255,255,.59);box-shadow:0 15px 42px rgba(75,70,103,.085);backdrop-filter:blur(18px)}.settings-list article,.settings-list>button{width:100%;min-height:68px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;padding:11px 13px;border:0;border-bottom:1px solid rgba(106,98,129,.07);color:inherit;background:transparent;text-align:left}.settings-list article:last-child,.settings-list>button:last-child{border:0}.settings-list i{width:37px;height:37px;display:grid;place-items:center;border-radius:13px;color:#7d9ec1;background:linear-gradient(145deg,rgba(var(--pink-rgb),.1),rgba(var(--blue-rgb),.14))}.settings-list div{min-width:0;display:grid;gap:4px}.settings-list strong{font-size: calc(10px * var(--font-scale, 1))}.settings-list span{overflow:hidden;color:#9993a3;font-size: calc(7px * var(--font-scale, 1));text-overflow:ellipsis;white-space:nowrap}.settings-list b{padding:4px 7px;border-radius:999px;color:#65927f;background:rgba(96,180,145,.09);font-size: calc(7px * var(--font-scale, 1))}.settings-list b.warning{color:#a56e8f;background:rgba(var(--pink-rgb),.1)}.hub-connection-row:active{background:rgba(var(--blue-rgb),.055)}.connection-notice{display:flex;align-items:center;justify-content:center;gap:5px;margin:9px 12px 0;color:#65927f;font-size:calc(8px * var(--font-scale, 1))}.compact-heading+.settings-list{border-radius:19px 19px 19px 8px;box-shadow:0 12px 32px rgba(75,70,103,.065)}
.hub-force-entry{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;padding:7px;border:0;color:#a67b83;background:transparent;font-size:calc(7px * var(--font-scale,1));font-weight:700}.hub-force-entry:disabled{opacity:.45}
.module-heading{margin-top:22px}.compact-heading{margin-top:20px}.module-control-list{overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:23px 23px 23px 9px;background:rgba(255,255,255,.59);box-shadow:0 15px 42px rgba(75,70,103,.075);backdrop-filter:blur(18px)}.module-control-list label{position:relative;min-height:68px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:13px;padding:12px 14px;border-bottom:1px solid rgba(106,98,129,.07);transition:opacity .18s ease}.module-control-list label:last-child{border-bottom:0}.module-control-list label.disabled{opacity:.62}.module-control-list label>span{min-width:0;display:grid;gap:4px}.module-control-list strong{color:#4f4a5b;font-size:calc(10px * var(--font-scale,1))}.module-control-list small{overflow:hidden;color:#9993a3;font-size:calc(7px * var(--font-scale,1));line-height:1.45;text-overflow:ellipsis;white-space:nowrap}.module-control-list input{position:absolute;opacity:0;pointer-events:none}.module-control-list label>i{position:relative;width:39px;height:23px;border-radius:999px;background:rgba(133,127,151,.18);box-shadow:inset 0 0 0 1px rgba(108,101,130,.08);transition:background .2s ease}.module-control-list label>i b{position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 3px 8px rgba(75,67,95,.2);transition:transform .22s cubic-bezier(.2,.9,.25,1.15)}.module-control-list input:checked+i{background:linear-gradient(135deg,#cb8dac,#7fa8d0)}.module-control-list input:checked+i b{transform:translateX(16px)}.module-control-list label.core>i{opacity:.55}.module-error{margin:9px 12px 0;color:#ad6175;font-size:calc(8px * var(--font-scale,1));text-align:center}
.interface-settings-entry{width:100%;min-height:64px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:11px;margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.82);border-radius:19px 19px 19px 8px;color:#70697d;background:linear-gradient(140deg,rgba(255,255,255,.67),rgba(246,248,252,.5));box-shadow:0 12px 32px rgba(75,70,103,.07);text-align:left;backdrop-filter:blur(16px)}.interface-settings-entry>i{width:37px;height:37px;display:grid;place-items:center;border-radius:13px;color:#987aa0;background:linear-gradient(145deg,rgba(var(--pink-rgb),.13),rgba(var(--blue-rgb),.12))}.interface-settings-entry>span{min-width:0;display:grid;gap:4px}.interface-settings-entry strong{font-size:calc(10px * var(--font-scale, 1))}.interface-settings-entry small{color:#9a94a3;font-size:calc(7px * var(--font-scale, 1))}.interface-settings-entry>b{padding:4px 7px;border-radius:999px;color:#7187a2;background:rgba(var(--blue-rgb),.1);font-size:calc(7px * var(--font-scale, 1))}.interface-settings-entry>svg{color:#aaa3b0}
.archive-settings-entry{width:100%;min-height:64px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:11px;margin-top:9px;padding:10px 12px;border:1px solid rgba(255,255,255,.82);border-radius:19px 19px 8px 19px;color:#70697d;background:linear-gradient(140deg,rgba(247,250,255,.72),rgba(255,247,252,.56));box-shadow:0 12px 32px rgba(75,70,103,.07);text-align:left;backdrop-filter:blur(16px)}.archive-settings-entry>i{width:37px;height:37px;display:grid;place-items:center;border-radius:13px;color:#718fac;background:linear-gradient(145deg,rgba(var(--blue-rgb),.16),rgba(var(--pink-rgb),.1))}.archive-settings-entry>span{min-width:0;display:grid;gap:4px}.archive-settings-entry strong{font-size:calc(10px * var(--font-scale, 1))}.archive-settings-entry small{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:#9a94a3;font-size:calc(7px * var(--font-scale, 1));line-height:1.4}.archive-settings-entry>b{padding:4px 7px;border-radius:999px;color:#89768d;background:rgba(var(--pink-rgb),.09);font-size:calc(7px * var(--font-scale, 1));white-space:nowrap}.archive-settings-entry>svg{color:#aaa3b0}
.refresh-button,.logout-button{width:100%;height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:15px;font-size: calc(9px * var(--font-scale, 1));font-weight:700}.refresh-button{margin-top:17px;border:1px solid rgba(255,255,255,.82);color:#687897;background:rgba(255,255,255,.64)}.logout-button{margin-top:8px;border:0;color:#ad6175;background:rgba(217,118,143,.085)}.refresh-button:disabled{opacity:.55}.settings-note{margin:11px 22px 0;color:#a19baa;font-size: calc(7px * var(--font-scale, 1));line-height:1.6;text-align:center}
.sheet-backdrop{position:fixed;z-index:50;inset:0;display:flex;align-items:flex-end;background:rgba(42,39,59,.23);backdrop-filter:blur(6px)}.profile-editor{width:100%;max-height:88dvh;overflow:auto;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:rgba(251,250,253,.97);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.profile-editor header{display:flex;align-items:center;justify-content:space-between}.profile-editor header span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.profile-editor h2{margin:3px 0 0;font-size: calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.profile-editor header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.editor-fields{display:grid;gap:12px;margin-top:18px}.editor-fields label{display:grid;gap:6px}.editor-fields label>span{color:#70697d;font-size: calc(9px * var(--font-scale, 1));font-weight:700}.editor-fields input,.editor-fields textarea{width:100%;border:1px solid rgba(112,104,137,.13);border-radius:14px;outline:0;color:var(--ink);background:rgba(255,255,255,.78);font-size: calc(11px * var(--font-scale, 1))}.editor-fields input{height:44px;padding:0 12px}.editor-fields textarea{min-height:84px;padding:11px 12px;line-height:1.55;resize:none}.editor-fields input:focus,.editor-fields textarea:focus{border-color:rgba(var(--pink-rgb),.42);box-shadow:0 0 0 4px rgba(var(--pink-rgb),.07)}.editor-error{margin:11px 0 0;color:#aa5970;font-size: calc(8px * var(--font-scale, 1));text-align:center}.save-profile{width:100%;height:47px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:16px;border:0;border-radius:15px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size: calc(10px * var(--font-scale, 1));font-weight:700}.save-profile:disabled{opacity:.55}
.connection-sheet{width:100%;max-height:88dvh;overflow:auto;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 95% 5%,rgba(var(--blue-rgb),.15),transparent 31%),radial-gradient(circle at 2% 85%,rgba(var(--pink-rgb),.12),transparent 34%),rgba(251,250,253,.98);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.connection-sheet header{display:flex;align-items:center;justify-content:space-between}.connection-sheet header span{color:#8198b1;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.connection-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.connection-sheet header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.connection-intro{margin:14px 2px 0;color:#928b9a;font-size:calc(8px * var(--font-scale, 1));line-height:1.65}.connection-tabs{display:grid;grid-template-columns:1fr 1fr;margin-top:15px;padding:4px;border-radius:14px;background:rgba(112,104,136,.07)}.connection-tabs button{height:38px;border:0;border-radius:11px;color:#918a9a;background:transparent;font-size:calc(9px * var(--font-scale, 1));font-weight:700}.connection-tabs button.active{color:#5f5a6d;background:rgba(255,255,255,.92);box-shadow:0 7px 18px rgba(86,79,112,.1)}.connection-field{display:grid;gap:7px;margin-top:15px}.connection-field>span{color:#70697d;font-size:calc(9px * var(--font-scale, 1));font-weight:700}.connection-field>div{height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;border:1px solid rgba(112,104,137,.13);border-radius:15px;background:rgba(255,255,255,.75)}.connection-field>div:focus-within{border-color:rgba(var(--blue-rgb),.4);box-shadow:0 0 0 4px rgba(var(--blue-rgb),.07)}.connection-field svg{flex:0 0 auto;color:#8b9db2}.connection-field input{min-width:0;flex:1;padding:0;border:0;outline:0;background:transparent;font-size:calc(10px * var(--font-scale, 1))}.connection-field textarea{width:100%;min-height:92px;padding:11px 12px;border:1px solid rgba(112,104,137,.13);border-radius:15px;outline:0;background:rgba(255,255,255,.75);font-size:calc(9px * var(--font-scale, 1));line-height:1.5;resize:none}.connection-field small{color:#aaa3b0;font-size:calc(7px * var(--font-scale, 1));line-height:1.5}.scan-hub-button{width:100%;min-height:59px;display:flex;align-items:center;gap:11px;margin-top:14px;padding:10px 13px;border:1px solid rgba(var(--blue-rgb),.16);border-radius:16px;color:#7187a2;background:linear-gradient(125deg,rgba(var(--pink-rgb),.075),rgba(var(--blue-rgb),.1));text-align:left}.scan-hub-button>span{display:grid;gap:3px}.scan-hub-button strong{font-size:calc(9px * var(--font-scale, 1))}.scan-hub-button small{color:#9891a1;font-size:calc(7px * var(--font-scale, 1))}.connection-error{margin:11px 2px 0;color:#ad6175;font-size:calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}.apply-connection{width:100%;height:47px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:14px;border:0;border-radius:15px;color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0);font-size:calc(10px * var(--font-scale, 1));font-weight:700}.apply-connection:disabled,.scan-hub-button:disabled,.connection-sheet header button:disabled{opacity:.55}
.hub-management-sheet{width:100%;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 94% 4%,rgba(var(--blue-rgb),.15),transparent 33%),rgba(251,250,253,.985);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.hub-management-sheet header{display:flex;align-items:center;justify-content:space-between}.hub-management-sheet header span{color:#8198b1;font-size:calc(7px * var(--font-scale,1));font-weight:800;letter-spacing:.16em}.hub-management-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale,1));letter-spacing:-.045em}.hub-management-sheet header button{width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.hub-management-list{margin-top:15px;background:rgba(255,255,255,.66);box-shadow:0 13px 35px rgba(75,70,103,.08)}
.takeover-sheet{width:100%;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 92% 4%,rgba(210,132,117,.16),transparent 34%),rgba(252,249,249,.985);box-shadow:0 -22px 70px rgba(82,57,61,.24)}.takeover-sheet header{display:flex;align-items:center;justify-content:space-between}.takeover-sheet header span{color:#b27676;font-size:calc(7px * var(--font-scale,1));font-weight:800;letter-spacing:.16em}.takeover-sheet h2{margin:3px 0 0;color:#55494c;font-size:calc(21px * var(--font-scale,1));letter-spacing:-.045em}.takeover-sheet header button{width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:13px;color:#817578;background:rgba(122,93,99,.07)}.takeover-warning{display:grid;grid-template-columns:auto 1fr;gap:12px;margin-top:17px;padding:15px;border:1px solid rgba(183,105,91,.16);border-radius:20px 20px 8px 20px;background:rgba(255,244,241,.72)}.takeover-warning>i{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;color:#b56e60;background:rgba(255,255,255,.72)}.takeover-warning strong{color:#695457;font-size:calc(10px * var(--font-scale,1))}.takeover-warning p{margin:6px 0 0;color:#9b7f82;font-size:calc(8px * var(--font-scale,1));line-height:1.6}.takeover-confirm{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:9px;margin-top:15px;padding:12px;border-radius:14px;background:rgba(116,92,98,.055);color:#77666a;font-size:calc(8px * var(--font-scale,1));line-height:1.55}.takeover-confirm input{width:17px;height:17px;margin-top:1px;accent-color:#b86f6b}.takeover-submit{width:100%;height:47px;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:14px;border:0;border-radius:15px;color:#fff;background:linear-gradient(120deg,#bd706a,#a97982 56%,#8c899f);font-size:calc(10px * var(--font-scale,1));font-weight:800}.takeover-submit:disabled,.takeover-sheet header button:disabled{opacity:.48}
.interface-settings-sheet{width:100%;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 92% 5%,rgba(var(--blue-rgb),.13),transparent 31%),radial-gradient(circle at 4% 80%,rgba(var(--pink-rgb),.12),transparent 35%),rgba(251,250,253,.98);box-shadow:0 -22px 70px rgba(67,62,91,.2)}.interface-settings-sheet header{display:flex;align-items:center;justify-content:space-between}.interface-settings-sheet header span{color:#a07a9e;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.interface-settings-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.interface-settings-sheet header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.font-size-card{margin-top:18px;padding:16px;border:1px solid rgba(255,255,255,.82);border-radius:23px 23px 23px 9px;background:rgba(255,255,255,.65);box-shadow:0 15px 38px rgba(75,70,103,.09);backdrop-filter:blur(18px)}.font-setting-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px}.font-setting-head>i{width:39px;height:39px;display:grid;place-items:center;border-radius:14px;color:#987aa0;background:linear-gradient(145deg,rgba(var(--pink-rgb),.14),rgba(var(--blue-rgb),.14))}.font-setting-head>div{display:grid;gap:4px}.font-setting-head strong{color:#575160;font-size:calc(11px * var(--font-scale, 1))}.font-setting-head span{color:#9992a2;font-size:calc(7px * var(--font-scale, 1))}.font-setting-head>b{padding:5px 8px;border-radius:999px;color:#fff;background:linear-gradient(120deg,#c986ad,#849ac6);font-size:calc(8px * var(--font-scale, 1))}.font-preview{display:grid;gap:5px;margin-top:15px;padding:14px;border:1px solid rgba(116,108,137,.07);border-radius:16px;background:linear-gradient(135deg,rgba(var(--pink-rgb),.055),rgba(var(--blue-rgb),.065))}.font-preview>span{color:#a07a9e;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.12em}.font-preview>strong{color:#56505f;font-size:calc(13px * var(--font-scale, 1))}.font-preview>small{color:#918a99;font-size:calc(8px * var(--font-scale, 1))}.font-scale-control{height:47px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;margin-top:8px;color:#9891a1;font-size:calc(8px * var(--font-scale, 1))}.font-scale-control input{width:100%;accent-color:#9b87b5}.font-scale-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.font-scale-footer small{color:#aaa3b0;font-size:calc(7px * var(--font-scale, 1))}.font-scale-footer button{padding:6px 8px;border:0;border-radius:9px;color:#87718d;background:rgba(var(--pink-rgb),.09);font-size:calc(7px * var(--font-scale, 1));font-weight:700}.font-scale-error{margin:10px 0 0;color:#aa5970;font-size:calc(8px * var(--font-scale, 1));text-align:center}
.archive-settings-sheet{width:100%;max-height:92dvh;overflow:auto;padding:12px 18px calc(22px + env(safe-area-inset-bottom));border-radius:29px 29px 0 0;background:radial-gradient(circle at 92% 5%,rgba(var(--blue-rgb),.16),transparent 31%),radial-gradient(circle at 4% 86%,rgba(var(--pink-rgb),.13),transparent 35%),rgba(251,250,253,.985);box-shadow:0 -22px 70px rgba(67,62,91,.22)}.archive-settings-sheet header{display:flex;align-items:center;justify-content:space-between}.archive-settings-sheet header span{color:#7e98b3;font-size:calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.archive-settings-sheet h2{margin:3px 0 0;color:#4d4859;font-size:calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.archive-settings-sheet header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.archive-hero{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:13px;margin-top:16px;padding:15px;border:1px solid rgba(255,255,255,.8);border-radius:21px 21px 21px 8px;background:linear-gradient(135deg,rgba(var(--blue-rgb),.11),rgba(var(--pink-rgb),.075));box-shadow:0 13px 35px rgba(75,70,103,.08)}.archive-hero>i{width:45px;height:45px;display:grid;place-items:center;border-radius:15px;color:#718eac;background:rgba(255,255,255,.64)}.archive-hero>div{display:grid;gap:5px}.archive-hero strong{color:#56505f;font-size:calc(11px * var(--font-scale, 1))}.archive-hero span{color:#928b9a;font-size:calc(8px * var(--font-scale, 1));line-height:1.55}.archive-password{display:grid;gap:7px;margin-top:15px}.archive-password>span{color:#70697d;font-size:calc(9px * var(--font-scale, 1));font-weight:700}.archive-password input{height:45px;padding:0 12px;border:1px solid rgba(112,104,137,.13);border-radius:14px;outline:0;background:rgba(255,255,255,.78);font-size:calc(10px * var(--font-scale, 1))}.archive-password input:focus{border-color:rgba(var(--blue-rgb),.4);box-shadow:0 0 0 4px rgba(var(--blue-rgb),.07)}.archive-password small{color:#aaa3b0;font-size:calc(7px * var(--font-scale, 1));line-height:1.5}.archive-export-button{width:100%;min-height:57px;display:flex;align-items:center;gap:11px;margin-top:14px;padding:10px 13px;border:1px solid rgba(var(--blue-rgb),.14);border-radius:16px;color:#7187a2;background:rgba(var(--blue-rgb),.075);text-align:left}.archive-export-button>span{display:grid;gap:3px}.archive-export-button strong{font-size:calc(9px * var(--font-scale, 1))}.archive-export-button small{color:#9992a2;font-size:calc(7px * var(--font-scale, 1))}.archive-restore-card{margin-top:12px;padding:15px;border:1px solid rgba(var(--pink-rgb),.13);border-radius:20px 20px 8px 20px;background:rgba(255,249,252,.72)}.archive-restore-card>div{display:grid;gap:4px}.archive-restore-card strong{color:#655661;font-size:calc(10px * var(--font-scale, 1))}.archive-restore-card span,.archive-restore-card>p{color:#9d8790;font-size:calc(7px * var(--font-scale, 1));line-height:1.55}.archive-file-input{display:none}.archive-file-button{width:100%;min-height:43px;display:flex;align-items:center;justify-content:center;gap:7px;overflow:hidden;margin-top:11px;padding:0 12px;border:1px dashed rgba(123,146,178,.3);border-radius:13px;color:#71829a;background:rgba(255,255,255,.58);font-size:calc(8px * var(--font-scale, 1));font-weight:700;text-overflow:ellipsis;white-space:nowrap}.archive-restore-card>p{margin:10px 1px 0}.archive-restore-button{width:100%;height:46px;margin-top:11px;border:0;border-radius:14px;color:#fff;background:linear-gradient(115deg,#c77d9f,#8a8fb9 58%,#729ec4);font-size:calc(9px * var(--font-scale, 1));font-weight:800}.archive-export-button:disabled,.archive-file-button:disabled,.archive-restore-button:disabled,.archive-settings-sheet header button:disabled{opacity:.5}.archive-notice{display:flex;align-items:flex-start;gap:5px;margin:11px 2px 0;color:#5f9078;font-size:calc(8px * var(--font-scale, 1));line-height:1.5}.archive-notice svg{flex:0 0 auto;margin-top:1px}.archive-error{margin:11px 2px 0;color:#ad6175;font-size:calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}
.crop-backdrop{position:fixed;z-index:70;inset:0;display:grid;place-items:center;padding:calc(18px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom));background:rgba(40,37,56,.34);backdrop-filter:blur(9px)}.avatar-cropper{width:min(100%,390px);padding:18px;border:1px solid rgba(255,255,255,.78);border-radius:28px;background:linear-gradient(145deg,rgba(255,252,254,.98),rgba(243,247,252,.98));box-shadow:0 28px 80px rgba(50,45,69,.3)}.avatar-cropper header{display:flex;align-items:center;justify-content:space-between}.avatar-cropper header span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.avatar-cropper h2{margin:3px 0 0;color:#4d4859;font-size: calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.avatar-cropper header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.crop-stage{position:relative;width:min(74vw,292px);overflow:hidden;aspect-ratio:1;margin:18px auto 0;border-radius:28px;background:#dedbe5;box-shadow:inset 0 0 0 1px rgba(77,70,98,.1),0 17px 35px rgba(75,68,97,.17)}.crop-stage canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}.crop-stage canvas:active{cursor:grabbing}.crop-guide{position:absolute;inset:10px;border:1px solid rgba(255,255,255,.76);border-radius:21px;box-shadow:0 0 0 1px rgba(68,61,86,.08);pointer-events:none}.avatar-cropper>p{margin:12px 0 0;color:#918a9b;font-size: calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}.crop-zoom{height:44px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:8px;padding:0 5px;color:#8a8295}.crop-zoom input{width:100%;accent-color:#a785b3}.crop-error{color:#aa5970!important}.crop-actions{display:grid;grid-template-columns:1fr 1.45fr;gap:9px;margin-top:12px}.crop-actions button{height:45px;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:14px;color:#797283;background:rgba(105,97,131,.08);font-size: calc(9px * var(--font-scale, 1));font-weight:700}.crop-actions button:last-child{color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0)}.crop-actions button:disabled,.avatar-cropper header button:disabled{opacity:.55}
.hub-replication-status{margin-top:12px;padding:11px 12px;border:1px solid rgba(112,105,133,.08);border-radius:15px;background:rgba(255,255,255,.48)}.hub-replication-status>div{display:flex;align-items:center;justify-content:space-between;gap:10px}.hub-replication-status>div span{display:flex;align-items:center;gap:6px;color:#777181;font-size:calc(8px * var(--font-scale,1));font-weight:800}.hub-replication-status>div svg{color:#7897b4}.hub-replication-status>div b{color:#71907f;font-size:calc(8px * var(--font-scale,1))}.hub-replication-status.syncing>div b{color:#718aaa}.hub-replication-status.error>div b{color:#b06f84}.hub-replication-status p{margin:6px 0 0;color:#97909f;font-size:calc(7px * var(--font-scale,1));line-height:1.45}.hub-replication-status>i{height:4px;display:block;overflow:hidden;margin-top:9px;border-radius:999px;background:rgba(113,107,134,.1)}.hub-replication-status>i b{height:100%;display:block;border-radius:inherit;background:linear-gradient(90deg,#79a6c8,#9e8fbd 55%,#ca8cac);transition:width .35s ease}.hub-replication-status.synced>i b{background:linear-gradient(90deg,#7eb69c,#70a58c)}.hub-replication-status.error>i b{background:#c98295}
.desktop-login-scan-entry{width:100%;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;margin-top:10px;padding:11px 12px;border:1px solid rgba(102,157,132,.2);border-radius:15px;color:#638d78;background:linear-gradient(120deg,rgba(239,252,245,.88),rgba(240,248,253,.72));text-align:left}.desktop-login-scan-entry>span{display:grid;gap:3px}.desktop-login-scan-entry strong{font-size:calc(9px * var(--font-scale,1))}.desktop-login-scan-entry small{color:#91a098;font-size:calc(7px * var(--font-scale,1))}.desktop-login-scan-entry>svg:last-child{color:#8ca89a}.desktop-login-scan-entry:disabled{opacity:.55}
</style>
