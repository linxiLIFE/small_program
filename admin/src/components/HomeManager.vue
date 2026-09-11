<script setup lang="ts">
import { ref, watch } from 'vue';
import ImageUploader from './ImageUploader.vue';
import { adminApi } from '../api';
import type { Settings } from '../types';
const props=defineProps<{settings:Settings}>(); const emit=defineEmits<{saved:[settings:Settings]}>();
const banners=ref<Array<{id:string;imageUrl:string;previewUrl?:string}>>([]);const busy=ref(false),uploads=ref(0),error=ref(''),notice=ref('');
watch(()=>props.settings.home,home=>{banners.value=(home?.banners||[]).map(b=>({id:b.id,imageUrl:b.imageFileID||b.imageUrl,previewUrl:b.imageUrl}));},{immediate:true,deep:true});
function add(){banners.value.push({id:crypto.randomUUID(),imageUrl:''});}
function move(index:number,step:number){const other=index+step;if(other<0||other>=banners.value.length)return;[banners.value[index],banners.value[other]]=[banners.value[other]!,banners.value[index]!];}
async function save(){busy.value=true;error.value='';notice.value='';try{if(banners.value.some(b=>!b.imageUrl))throw new Error('请上传图片或移除空白项');const saved=await adminApi.saveSettings({version:props.settings.version,home:{banners:banners.value.map(({id,imageUrl})=>({id,imageUrl}))}});emit('saved',saved);notice.value='宣传图片已保存';}catch(e){error.value=e instanceof Error?e.message:'保存失败';}finally{busy.value=false;}}
</script>
<template><section class="page-section"><div class="page-intro"><h1>首页宣传</h1><button class="primary-button" :disabled="banners.length>=20||busy||uploads>0" @click="add">＋ 添加宣传图</button></div><div class="banner-editor-grid"><article v-for="(banner,index) in banners" :key="banner.id" class="panel banner-editor"><ImageUploader v-model="banner.imageUrl" :preview-url="banner.previewUrl" :crop-ratio="2" label="上传 2:1 横版宣传图" @busy="uploads+=$event?1:-1"/><footer><span>{{index+1}} / {{banners.length}}</span><div><button class="soft-button" :disabled="index===0||busy||uploads>0" @click="move(index,-1)">前移</button><button class="soft-button" :disabled="index===banners.length-1||busy||uploads>0" @click="move(index,1)">后移</button><button class="text-button" :disabled="busy||uploads>0" @click="banners.splice(index,1)">移除</button></div></footer></article><button class="add-tile banner-add" :disabled="banners.length>=20||busy||uploads>0" @click="add"><span>＋</span>添加宣传图</button></div><p class="field-error" v-if="error" role="alert">{{error}}</p><p class="inline-success" v-if="notice" role="status">{{notice}}</p><div class="settings-actions"><button class="primary-button" :disabled="busy||uploads>0" @click="save">{{busy?'保存中…':'保存宣传图'}}</button></div></section></template>
