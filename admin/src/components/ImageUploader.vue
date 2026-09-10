<script setup lang="ts">
import { ref, watch } from 'vue';
import { adminApi } from '../api';
const props = defineProps<{ modelValue: string; previewUrl?: string; label?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; busy: [value: boolean] }>();
const preview = ref(props.previewUrl || (props.modelValue.startsWith('cloud://') ? '' : props.modelValue));
const uploading = ref(false); const error = ref('');
watch(() => props.previewUrl, value => { if (value) preview.value = value; });
async function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0];
  if (!file) return;
  error.value = '';
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) { error.value = '请选择 12 MB 内的照片、PNG 或 WebP 图片'; input.value = ''; return; }
  uploading.value = true; emit('busy',true);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width*scale); canvas.height = Math.round(bitmap.height*scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法处理图片');
    context.fillStyle='#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    let data = canvas.toDataURL('image/jpeg',.86);
    if (data.length > 2700000) data = canvas.toDataURL('image/jpeg',.65);
    if (data.length > 2700000) throw new Error('图片过大，请裁剪后重试');
    const result = await adminApi.uploadImage(data.split(',')[1]);
    emit('update:modelValue',result.fileID); preview.value = result.url || data;
  } catch (err) { error.value = err instanceof Error ? err.message : '上传失败，请重试'; }
  finally { uploading.value=false; emit('busy',false); input.value=''; }
}
</script>
<template>
  <div class="image-upload"><label class="upload-drop" :class="{ 'has-image': preview, uploading }">
    <img v-if="preview" :src="preview" alt="图片预览"/>
    <span v-else class="upload-empty"><span class="upload-symbol">＋</span><strong>{{ label || '上传款式图片' }}</strong><span>从电脑选择图片</span></span>
    <span v-if="preview" class="upload-replace">{{ uploading ? '上传中…' : '更换图片' }}</span>
    <span v-else-if="uploading" class="upload-progress">上传中…</span>
    <input type="file" accept="image/jpeg,image/png,image/webp" :aria-label="label || '上传款式图片'" :disabled="uploading" @change="upload"/>
  </label><p v-if="error" class="field-error" role="alert">{{ error }}</p></div>
</template>
