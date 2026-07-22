<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef } from "vue";
import { Check, X, ZoomIn, ZoomOut } from "@lucide/vue";

const props = withDefaults(defineProps<{ saving?: boolean; error?: string; subject?: string }>(), {
  saving: false,
  error: "",
  subject: "头像"
});
const emit = defineEmits<{ confirm: [dataUrl: string]; clearError: [] }>();

const input = ref<HTMLInputElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const image = shallowRef<HTMLImageElement | null>(null);
const open = ref(false);
const zoom = ref(100);
const localError = ref("");
const crop = reactive({ baseScale: 1, offsetX: 0, offsetY: 0 });
const visibleError = computed(() => localError.value || props.error);
let drag: { pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;

function choose() {
  if (props.saving) return;
  localError.value = "";
  emit("clearError");
  input.value?.click();
}

function scale() {
  return crop.baseScale * zoom.value / 100;
}

function clamp() {
  const target = canvas.value;
  const source = image.value;
  if (!target || !source) return;
  const width = source.naturalWidth * scale();
  const height = source.naturalHeight * scale();
  crop.offsetX = Math.min(0, Math.max(target.width - width, crop.offsetX));
  crop.offsetY = Math.min(0, Math.max(target.height - height, crop.offsetY));
}

function draw() {
  const target = canvas.value;
  const source = image.value;
  const context = target?.getContext("2d");
  if (!target || !source || !context) return;
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, crop.offsetX, crop.offsetY, source.naturalWidth * scale(), source.naturalHeight * scale());
}

function initialize() {
  const target = canvas.value;
  const source = image.value;
  if (!target || !source) return;
  zoom.value = 100;
  crop.baseScale = Math.max(target.width / source.naturalWidth, target.height / source.naturalHeight);
  crop.offsetX = (target.width - source.naturalWidth * crop.baseScale) / 2;
  crop.offsetY = (target.height - source.naturalHeight * crop.baseScale) / 2;
  draw();
}

async function selectFile(event: Event) {
  const picker = event.target as HTMLInputElement;
  const file = picker.files?.[0];
  picker.value = "";
  if (!file) return;
  localError.value = "";
  emit("clearError");
  if (!file.type.startsWith("image/")) {
    localError.value = "请选择一张图片。";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    localError.value = "图片太大了，请选择 15 MB 以内的图片。";
    return;
  }

  const source = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new Error("图片无法读取，请换一张试试。"));
      source.src = objectUrl;
    });
    image.value = source;
    open.value = true;
    await nextTick();
    initialize();
  } catch (reason) {
    localError.value = (reason as Error).message || "图片无法读取，请换一张试试。";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function changeZoom(event: Event) {
  const target = canvas.value;
  const source = image.value;
  if (!target || !source) return;
  const previousScale = scale();
  const imageCenterX = (target.width / 2 - crop.offsetX) / previousScale;
  const imageCenterY = (target.height / 2 - crop.offsetY) / previousScale;
  zoom.value = Number((event.target as HTMLInputElement).value);
  const nextScale = scale();
  crop.offsetX = target.width / 2 - imageCenterX * nextScale;
  crop.offsetY = target.height / 2 - imageCenterY * nextScale;
  clamp();
  draw();
}

function startDrag(event: PointerEvent) {
  if (!canvas.value) return;
  canvas.value.setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: crop.offsetX, offsetY: crop.offsetY };
}

function move(event: PointerEvent) {
  const target = canvas.value;
  if (!target || !drag || drag.pointerId !== event.pointerId) return;
  const displayScale = target.width / target.getBoundingClientRect().width;
  crop.offsetX = drag.offsetX + (event.clientX - drag.x) * displayScale;
  crop.offsetY = drag.offsetY + (event.clientY - drag.y) * displayScale;
  clamp();
  draw();
}

function endDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) drag = null;
}

function close() {
  if (props.saving) return;
  complete();
}

function complete() {
  open.value = false;
  image.value = null;
  drag = null;
}

function bytes(dataUrl: string) {
  return Math.ceil((dataUrl.split(",")[1] || "").length * 3 / 4);
}

function render(size: number, quality: number) {
  const source = canvas.value;
  if (!source) return "";
  const output = document.createElement("canvas");
  output.width = size;
  output.height = size;
  output.getContext("2d")?.drawImage(source, 0, 0, size, size);
  return output.toDataURL("image/webp", quality);
}

function confirm() {
  if (props.saving || !image.value) return;
  localError.value = "";
  emit("clearError");
  let dataUrl = "";
  for (const size of [512, 448, 384]) {
    for (const quality of [0.88, 0.76, 0.64, 0.52]) {
      dataUrl = render(size, quality);
      if (dataUrl && bytes(dataUrl) <= 700 * 1024) break;
    }
    if (dataUrl && bytes(dataUrl) <= 700 * 1024) break;
  }
  if (!dataUrl || bytes(dataUrl) > 700 * 1024) {
    localError.value = "头像压缩失败，请换一张图片试试。";
    return;
  }
  emit("confirm", dataUrl);
}

defineExpose({ choose, close, complete });
</script>

<template>
  <input ref="input" class="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp" @change="selectFile" />
  <Transition name="fade">
    <div v-if="open" class="crop-backdrop" @click.self="close">
      <section class="avatar-cropper" role="dialog" aria-modal="true" :aria-label="`裁剪${subject}`">
        <header>
          <div><span>AVATAR CROP</span><h2>裁剪{{ subject }}</h2></div>
          <button type="button" :aria-label="`关闭${subject}裁剪`" :disabled="saving" @click="close"><X :size="18" /></button>
        </header>
        <div class="crop-stage">
          <canvas ref="canvas" width="600" height="600" @pointerdown="startDrag" @pointermove="move" @pointerup="endDrag" @pointercancel="endDrag" />
          <i class="crop-guide" aria-hidden="true" />
        </div>
        <p>拖动画面调整位置，滑动缩放到喜欢的构图。</p>
        <label class="crop-zoom">
          <ZoomOut :size="17" />
          <input type="range" min="100" max="250" step="1" :value="zoom" :aria-label="`缩放${subject}`" @input="changeZoom" />
          <ZoomIn :size="18" />
        </label>
        <p v-if="visibleError" class="crop-error">{{ visibleError }}</p>
        <div class="crop-actions">
          <button type="button" :disabled="saving" @click="close">取消</button>
          <button type="button" :disabled="saving" @click="confirm"><Check :size="16" />{{ saving ? '正在上传…' : '确认并上传' }}</button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.avatar-file-input{display:none}.crop-backdrop{position:fixed;z-index:70;inset:0;display:grid;place-items:center;padding:calc(18px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom));background:rgba(40,37,56,.34);backdrop-filter:blur(9px)}.avatar-cropper{width:min(100%,390px);padding:18px;border:1px solid rgba(255,255,255,.78);border-radius:28px;background:linear-gradient(145deg,rgba(255,252,254,.98),rgba(243,247,252,.98));box-shadow:0 28px 80px rgba(50,45,69,.3)}.avatar-cropper header{display:flex;align-items:center;justify-content:space-between}.avatar-cropper header span{color:#a07a9e;font-size: calc(7px * var(--font-scale, 1));font-weight:800;letter-spacing:.16em}.avatar-cropper h2{margin:3px 0 0;color:#4d4859;font-size: calc(21px * var(--font-scale, 1));letter-spacing:-.045em}.avatar-cropper header button{width:38px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:13px;color:#817a8b;background:rgba(111,103,136,.07)}.crop-stage{position:relative;width:min(74vw,292px);overflow:hidden;aspect-ratio:1;margin:18px auto 0;border-radius:28px;background:#dedbe5;box-shadow:inset 0 0 0 1px rgba(77,70,98,.1),0 17px 35px rgba(75,68,97,.17)}.crop-stage canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}.crop-stage canvas:active{cursor:grabbing}.crop-guide{position:absolute;inset:10px;border:1px solid rgba(255,255,255,.76);border-radius:21px;box-shadow:0 0 0 1px rgba(68,61,86,.08);pointer-events:none}.avatar-cropper>p{margin:12px 0 0;color:#918a9b;font-size: calc(8px * var(--font-scale, 1));line-height:1.5;text-align:center}.crop-zoom{height:44px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:8px;padding:0 5px;color:#8a8295}.crop-zoom input{width:100%;accent-color:#a785b3}.crop-error{color:#aa5970!important}.crop-actions{display:grid;grid-template-columns:1fr 1.45fr;gap:9px;margin-top:12px}.crop-actions button{height:45px;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:14px;color:#797283;background:rgba(105,97,131,.08);font-size: calc(9px * var(--font-scale, 1));font-weight:700}.crop-actions button:last-child{color:#fff;background:linear-gradient(115deg,#ca87ad,#8d92bf 58%,#77a8d0)}.crop-actions button:disabled,.avatar-cropper header button:disabled{opacity:.55}
</style>
