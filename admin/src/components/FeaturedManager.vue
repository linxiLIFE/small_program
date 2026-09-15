<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { adminApi } from '../api';
import type { CatalogResponse, Work } from '../types';
import CatalogImage from './CatalogImage.vue';

const props = defineProps<{catalog:CatalogResponse}>();
const emit = defineEmits<{changed:[]}>();
const orderedIds = ref<string[]>([]);
const search = ref('');
const saving = ref(false);
const dirty = ref(false);
const error = ref('');
const notice = ref('');

const byId = computed(() => new Map(props.catalog.works.map((work) => [work.id, work])));
const selectedWorks = computed(() => orderedIds.value.map((id) => byId.value.get(id)).filter(Boolean) as Work[]);
const availableWorks = computed(() => props.catalog.works
  .filter((work) => work.published !== false && !orderedIds.value.includes(work.id) && (!search.value.trim() || work.title.includes(search.value.trim()) || work.serviceName?.includes(search.value.trim())))
  .sort((left, right) => (right.bookingCount || 0) - (left.bookingCount || 0) || left.title.localeCompare(right.title)));

watch(() => props.catalog.works, (works) => {
  if (dirty.value) return;
  orderedIds.value = works.filter((work) => work.featured).sort((left, right) => Number(left.featuredSort || 0) - Number(right.featuredSort || 0) || (right.bookingCount || 0) - (left.bookingCount || 0)).map((work) => work.id);
}, { immediate:true });

function add(work:Work){orderedIds.value.push(work.id);dirty.value=true;notice.value='';}
function remove(id:string){orderedIds.value=orderedIds.value.filter((item)=>item!==id);dirty.value=true;notice.value='';}
function move(index:number,direction:number){const next=index+direction;if(next<0||next>=orderedIds.value.length)return;const list=[...orderedIds.value];[list[index],list[next]]=[list[next],list[index]];orderedIds.value=list;dirty.value=true;notice.value='';}
async function save(){if(saving.value)return;saving.value=true;error.value='';notice.value='';try{await adminApi.saveFeaturedWorks(orderedIds.value);dirty.value=false;notice.value='精选款式已保存';emit('changed');}catch(err){error.value=err instanceof Error?err.message:'保存失败';}finally{saving.value=false;}}
</script>

<template>
  <section class="page-section featured-manager">
    <div class="page-intro"><div><h1>精选管理</h1><p>首页按下方顺序展示精选款式。</p></div><button class="primary-button" :disabled="saving||!dirty" @click="save">{{saving?'保存中…':'保存精选'}}</button></div>
    <p v-if="error" class="field-error">{{error}}</p><p v-if="notice" class="inline-success">{{notice}}</p>
    <div class="featured-layout">
      <section class="panel featured-selected"><div class="panel-heading"><h2>首页精选</h2><span>{{selectedWorks.length}} 款</span></div><div class="featured-order-list"><article v-for="(work,index) in selectedWorks" :key="work.id" class="featured-order-item"><span class="featured-index">{{String(index+1).padStart(2,'0')}}</span><CatalogImage :src="work.imageUrl" :alt="work.title"/><div><strong>{{work.title}}</strong><small>{{work.serviceName||'款式'}}</small></div><div class="featured-item-actions"><button class="icon-button" :disabled="index===0" title="上移" @click="move(index,-1)">↑</button><button class="icon-button" :disabled="index===selectedWorks.length-1" title="下移" @click="move(index,1)">↓</button><button class="text-button" @click="remove(work.id)">取消精选</button></div></article><p v-if="!selectedWorks.length" class="empty-inline">还没有精选款式</p></div></section>
      <section class="panel featured-picker"><div class="panel-heading"><h2>添加款式</h2><input v-model="search" class="search-field" placeholder="搜索款式或项目"/></div><div class="featured-pick-grid"><button v-for="work in availableWorks" :key="work.id" class="featured-pick-card" @click="add(work)"><CatalogImage :src="work.imageUrl" :alt="work.title"/><span><strong>{{work.title}}</strong><small>{{work.serviceName||'款式'}} · {{work.bookingCount||0}} 次预约</small></span><b>＋</b></button></div><p v-if="!availableWorks.length" class="empty-inline">没有可添加的已上架款式</p></section>
    </div>
  </section>
</template>
