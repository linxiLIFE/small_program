<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { adminApi } from '../api';

const props = defineProps<{ modelValue: string; previewUrl?: string; label?: string; cropRatio?: number }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; busy: [value: boolean] }>();

const MAX_EDGE = 1280;
const MAX_BASE64_LENGTH = 2700000;
const preview = ref(props.previewUrl || (props.modelValue?.startsWith('cloud://') ? '' : props.modelValue));
const uploading = ref(false);
const error = ref('');
const cropViewport = ref<HTMLElement | null>(null);
const cropSource = ref<{ src: string; image: HTMLImageElement } | null>(null);
const cropZoom = ref(1);
const cropOffset = ref({ x: 0, y: 0 });
const viewportSize = ref({ width: 0, height: 0 });
const dragging = ref(false);
const cropSaving = ref(false);
let dragOrigin: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
let activeInput: HTMLInputElement | null = null;

watch(() => props.previewUrl, value => { preview.value = value || (!props.modelValue?.startsWith('cloud://') ? props.modelValue : ''); });
watch(() => props.modelValue, value => { if (!uploading.value) preview.value = props.previewUrl || (value && !value.startsWith('cloud://') ? value : ''); });

const cropRatio = computed(() => {
  const value = Number(props.cropRatio || 0);
  return Number.isFinite(value) && value > 0 ? value : 1;
});

const cropSize = computed(() => {
  const width = viewportSize.value.width || 640;
  return { width, height: width / cropRatio.value };
});

const renderScale = computed(() => {
  if (!cropSource.value) return 1;
  const { image } = cropSource.value;
  return Math.max(cropSize.value.width / image.naturalWidth, cropSize.value.height / image.naturalHeight) * cropZoom.value;
});

const renderedSize = computed(() => cropSource.value ? {
  width: cropSource.value.image.naturalWidth * renderScale.value,
  height: cropSource.value.image.naturalHeight * renderScale.value
} : { width: 0, height: 0 });

const cropImageStyle = computed(() => ({
  width: `${renderedSize.value.width}px`,
  height: `${renderedSize.value.height}px`,
  transform: `translate3d(${cropOffset.value.x}px, ${cropOffset.value.y}px, 0)`
}));

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

function offsetLimits() {
  return {
    minX: cropSize.value.width - renderedSize.value.width,
    maxX: 0,
    minY: cropSize.value.height - renderedSize.value.height,
    maxY: 0
  };
}

function centeredOffset() {
  return {
    x: (cropSize.value.width - renderedSize.value.width) / 2,
    y: (cropSize.value.height - renderedSize.value.height) / 2
  };
}

function measureCropViewport() {
  const rect = cropViewport.value?.getBoundingClientRect();
  if (!rect || !rect.width) return;
  viewportSize.value = { width: rect.width, height: rect.width / cropRatio.value };
}

function keepOffsetInBounds() {
  const limits = offsetLimits();
  cropOffset.value = {
    x: clamp(cropOffset.value.x, limits.minX, limits.maxX),
    y: clamp(cropOffset.value.y, limits.minY, limits.maxY)
  };
}

function resetCrop() {
  if (!cropSource.value || cropSaving.value) return;
  cropZoom.value = 1;
  nextTick(() => {
    measureCropViewport();
    cropOffset.value = centeredOffset();
  });
}

function updateZoom(value: number) {
  if (!cropSource.value || cropSaving.value) return;
  const nextZoom = clamp(Number(value) || 1, 1, 3);
  const previousScale = renderScale.value;
  const centerX = cropSize.value.width / 2;
  const centerY = cropSize.value.height / 2;
  const anchorX = previousScale ? (centerX - cropOffset.value.x) / previousScale : 0;
  const anchorY = previousScale ? (centerY - cropOffset.value.y) / previousScale : 0;
  cropZoom.value = nextZoom;
  const nextScale = renderScale.value;
  cropOffset.value = {
    x: centerX - anchorX * nextScale,
    y: centerY - anchorY * nextScale
  };
  keepOffsetInBounds();
}

function handleZoomInput(event: Event) {
  updateZoom(Number((event.target as HTMLInputElement).value));
}

function beginDrag(event: PointerEvent) {
  if (!cropSource.value || cropSaving.value) return;
  event.preventDefault();
  dragging.value = true;
  dragOrigin = { x: event.clientX, y: event.clientY, offsetX: cropOffset.value.x, offsetY: cropOffset.value.y };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function drag(event: PointerEvent) {
  if (!dragging.value || !dragOrigin) return;
  const limits = offsetLimits();
  cropOffset.value = {
    x: clamp(dragOrigin.offsetX + event.clientX - dragOrigin.x, limits.minX, limits.maxX),
    y: clamp(dragOrigin.offsetY + event.clientY - dragOrigin.y, limits.minY, limits.maxY)
  };
}

function endDrag() { dragging.value = false; dragOrigin = null; }

function handleWheel(event: WheelEvent) {
  if (!cropSource.value || cropSaving.value) return;
  updateZoom(cropZoom.value + (event.deltaY > 0 ? -0.08 : 0.08));
}

function imageFromFile(file: File): Promise<{ src: string; image: HTMLImageElement }> {
  const src = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ src, image });
    image.onerror = () => { URL.revokeObjectURL(src); reject(new Error('图片无法读取，请换一张图片')); };
    image.src = src;
  });
}

async function openCrop(file: File) {
  uploading.value = true;
  emit('busy', true);
  try {
    cropSource.value = await imageFromFile(file);
    error.value = '';
    await nextTick();
    resetCrop();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '图片无法读取，请重试';
    finishCrop();
  }
}

function cropRect() {
  if (!cropSource.value) throw new Error('请先选择图片');
  const scale = renderScale.value;
  const image = cropSource.value.image;
  const width = cropSize.value.width / scale;
  const height = cropSize.value.height / scale;
  return {
    x: clamp(-cropOffset.value.x / scale, 0, image.naturalWidth - width),
    y: clamp(-cropOffset.value.y / scale, 0, image.naturalHeight - height),
    width: Math.min(width, image.naturalWidth),
    height: Math.min(height, image.naturalHeight)
  };
}

async function uploadCanvas(canvas: HTMLCanvasElement) {
  let data = canvas.toDataURL('image/jpeg', .82);
  if (data.length > MAX_BASE64_LENGTH) data = canvas.toDataURL('image/jpeg', .62);
  if (data.length > MAX_BASE64_LENGTH) throw new Error('图片过大，请裁剪后重试');
  const result = await adminApi.uploadImage(data.split(',')[1]);
  emit('update:modelValue', result.fileID);
  preview.value = result.url || data;
}

async function confirmCrop() {
  if (!cropSource.value || cropSaving.value) return;
  cropSaving.value = true;
  error.value = '';
  try {
    const source = cropSource.value;
    const rect = cropRect();
    const scale = Math.min(1, MAX_EDGE / Math.max(rect.width, rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source.image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    await uploadCanvas(canvas);
    finishCrop();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '上传失败，请重试';
  } finally {
    cropSaving.value = false;
  }
}

function finishCrop() {
  if (cropSource.value) URL.revokeObjectURL(cropSource.value.src);
  cropSource.value = null;
  cropSaving.value = false;
  uploading.value = false;
  emit('busy', false);
  if (activeInput) activeInput.value = '';
  activeInput = null;
}

function cancelCrop() {
  if (!cropSource.value || cropSaving.value) return;
  error.value = '';
  finishCrop();
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  activeInput = input;
  error.value = '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    error.value = '请选择 12 MB 内的照片、PNG 或 WebP 图片';
    input.value = '';
    activeInput = null;
    return;
  }
  if (Number(props.cropRatio || 0) > 0) {
    await openCrop(file);
    return;
  }
  uploading.value = true;
  emit('busy', true);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); throw new Error('浏览器无法处理图片'); }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    await uploadCanvas(canvas);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '上传失败，请重试';
  } finally {
    uploading.value = false;
    emit('busy', false);
    input.value = '';
    activeInput = null;
  }
}

function handleResize() { if (cropSource.value) { measureCropViewport(); keepOffsetInBounds(); } }
window.addEventListener('resize', handleResize);
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (cropSource.value) URL.revokeObjectURL(cropSource.value.src);
});
</script>
<template>
  <div class="image-upload">
    <label class="upload-drop" :class="{ 'has-image': preview, uploading, 'crop-banner': Number(cropRatio) > 0 }">
      <img v-if="preview" :src="preview" alt="图片预览" @error="preview=''"/>
      <span v-else class="upload-empty"><span class="upload-symbol">＋</span><strong>{{ label || '上传款式图片' }}</strong><span>从电脑选择图片</span></span>
      <span v-if="preview" class="upload-replace">{{ uploading ? (cropSource ? '调整裁切' : '上传中…') : '更换图片' }}</span>
      <span v-else-if="uploading" class="upload-progress">{{ cropSource ? '调整裁切' : '上传中…' }}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" :aria-label="label || '上传款式图片'" :disabled="uploading" @change="upload"/>
    </label>
    <p v-if="error && !cropSource" class="field-error" role="alert">{{ error }}</p>

    <div v-if="cropSource" class="crop-backdrop" @click.self="cancelCrop" @keydown.esc="cancelCrop">
      <section class="crop-modal" role="dialog" aria-modal="true" aria-label="裁切宣传图">
        <header class="crop-header"><div><span class="modal-context">宣传图</span><h2>调整图片</h2></div><button class="icon-button" type="button" :disabled="cropSaving" @click="cancelCrop" aria-label="取消裁切">×</button></header>
        <div class="crop-workbench">
          <div ref="cropViewport" class="crop-viewport" :style="{ aspectRatio: String(cropRatio) }" @pointerdown="beginDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag" @pointerleave="endDrag" @wheel.prevent="handleWheel">
            <img :src="cropSource.src" alt="待裁切图片" :style="cropImageStyle" draggable="false"/>
            <div class="crop-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </div>
          <div class="crop-controls"><span>缩放</span><input type="range" min="1" max="3" step="0.01" :value="cropZoom" :disabled="cropSaving" aria-label="图片缩放" @input="handleZoomInput"/><button class="soft-button" type="button" :disabled="cropSaving" @click="resetCrop">重置</button></div>
          <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        </div>
        <footer class="crop-footer"><button class="soft-button" type="button" :disabled="!uploading || cropSaving" @click="cancelCrop">取消</button><button class="primary-button" type="button" :disabled="!uploading || cropSaving" @click="confirmCrop">{{ cropSaving ? '上传中…' : '使用这张图片' }}</button></footer>
      </section>
    </div>
  </div>
</template>
