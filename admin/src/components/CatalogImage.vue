<script setup lang="ts">
import {ref,watch} from 'vue';
const props=defineProps<{src?:string;alt?:string}>();const failed=ref(false);
watch(()=>props.src,()=>{failed.value=false;});
function imageError(event: Event) {
  failed.value=true;
  const match=/[?&]q-sign-time=([^&]+)/.exec(props.src||'');
  const expires=match?Number(decodeURIComponent(match[1]).split(';')[1])*1000:Infinity;
  if(expires<=Date.now()+30000) {
    (event.target as HTMLElement).dispatchEvent(new CustomEvent('catalog-image-expired',{bubbles:true}));
  }
}
</script>
<template><img v-if="src&&!failed" :src="src" :alt="alt||''" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="imageError"/><div v-else class="catalog-image-empty" role="img" :aria-label="alt||'暂无图片'"><span>◇</span><small>{{failed?'图片暂不可用':alt||'暂无图片'}}</small></div></template>
