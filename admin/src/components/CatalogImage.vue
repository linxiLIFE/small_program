<script setup lang="ts">
import {ref,watch} from 'vue';
const props=defineProps<{src?:string;alt?:string}>();const failed=ref(false);
watch(()=>props.src,()=>{failed.value=false;});
</script>
<template><img v-if="src&&!failed" :src="src" :alt="alt||''" loading="lazy" @error="failed=true"/><div v-else class="catalog-image-empty"><span>◇</span><small>{{alt||'暂无图片'}}</small></div></template>
