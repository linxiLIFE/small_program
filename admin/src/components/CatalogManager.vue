<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CatalogResponse, Category, Service, Work } from '../types';
import { adminApi, money } from '../api';
import ImageUploader from './ImageUploader.vue';
const props=defineProps<{ catalog: CatalogResponse }>(); const emit=defineEmits<{ changed: [] }>();
const categoryId=ref(''); const serviceId=ref(''); const search=ref(''); const mode=ref<'works'|'services'|'featured'>('works');
const draft=ref<any>(null); const editor=ref<'category'|'service'|'work'>('work'); const saving=ref(false); const uploading=ref(false); const error=ref(''); const notice=ref('');
const categories=computed(()=>props.catalog.categories || []);
const services=computed(()=>props.catalog.services.filter(s=>!categoryId.value||s.categoryId===categoryId.value));
const works=computed(()=>props.catalog.works.filter(w=>{
 const s=props.catalog.services.find(s=>s.id===w.serviceId);
 return (!categoryId.value||s?.categoryId===categoryId.value)&&(!serviceId.value||w.serviceId===serviceId.value)&&(!search.value||w.title.includes(search.value))&&(mode.value!=='featured'||w.featured);
}).sort((a,b)=>mode.value==='featured'?(a.featuredSort||0)-(b.featuredSort||0):(a.sort||0)-(b.sort||0)));
const currentCategory=computed(()=>categories.value.find(c=>c.id===categoryId.value));
const projectOptions=computed(()=>props.catalog.services.filter(s=>s.enabled && (!draft.value?.categoryId || s.categoryId===draft.value.categoryId)));
function selectCategory(id:string) { categoryId.value=id;serviceId.value=''; }
function open(kind:'category'|'service'|'work', item?: Category|Service|Work) {
 editor.value=kind;error.value='';uploading.value=false;
 if(item) {
  draft.value={...item};
  if(kind==='service') draft.value.price=Number((item as Service).priceFen)/100;
  const field=kind==='work'?'imageUrl':'coverUrl'; const fileField=kind==='work'?'imageFileID':'coverFileID';
  draft.value.previewUrl=draft.value[field]; draft.value[field]=draft.value[fileField]||draft.value[field]||''; delete draft.value[fileField];
  if(kind==='work') draft.value.categoryId=props.catalog.services.find(s=>s.id===(item as Work).serviceId)?.categoryId || '';
 } else {
  const first=categories.value.find(c=>c.enabled && (!categoryId.value||c.id===categoryId.value));
  draft.value=kind==='category'?{name:'',icon:'✦',color:'#f1ded8',enabled:true,sort:categories.value.length,coverUrl:''}:kind==='service'?{name:'',categoryId:first?.id||'',coverUrl:'',price:0,durationMinutes:60,bufferMinutes:15,enabled:true,sort:0,description:''}:{title:'',categoryId:first?.id||'',serviceId:serviceId.value||'',imageUrl:'',published:true,featured:false,sort:0,featuredSort:0};
 }
}
async function save() {
 if(!draft.value||saving.value||uploading.value)return;
 saving.value=true;error.value='';
 try {
  const value={...draft.value};
  if(editor.value==='category')await adminApi.saveCategory(value);
  else if(editor.value==='service')await adminApi.saveService({...value,priceFen:Math.round(Number(value.price)*100)});
  else await adminApi.saveWork(value);
  draft.value=null;notice.value='已保存';emit('changed');
 } catch(err) { error.value=err instanceof Error?err.message:'保存失败'; } finally {saving.value=false;}
}
async function toggleFeatured(work:Work) {
 if(saving.value)return; saving.value=true;error.value='';
 try {await adminApi.saveWork({...work,featured:!work.featured});notice.value=work.featured?'已取消精选':'已设为首页精选';emit('changed');}
 catch(err){error.value=err instanceof Error?err.message:'保存失败';}finally{saving.value=false;}
}
function close(){if(!saving.value&&!uploading.value)draft.value=null;}
</script>
<template>
 <section class="catalog-studio">
  <div class="page-intro"><div><h1>项目与款式</h1></div><div class="toolbar-actions"><button class="soft-button" @click="open('category')">＋ 新增大类</button><button class="primary-button" @click="open(mode==='services'?'service':'work')">＋ {{mode==='services'?'新增小项目':'新增款式'}}</button></div></div>
  <div v-if="notice&&!draft" class="inline-success" role="status">{{notice}}</div><div v-if="error&&!draft" class="field-error" role="alert">{{error}}</div>
  <div class="studio-layout">
   <aside class="category-rail"><button :class="{selected:!categoryId}" @click="selectCategory('')"><span>全部大类</span><b>{{catalog.works.length}}</b></button><div v-for="category in categories" :key="category.id" class="rail-item"><button :class="{selected:categoryId===category.id}" @click="selectCategory(category.id)"><span><i :style="{background:category.color}">{{category.icon}}</i>{{category.name}}</span><small v-if="!category.enabled">停用</small></button><button class="rail-edit" :aria-label="'编辑'+category.name" @click="open('category',category)">编辑</button></div><button class="rail-add" @click="open('category')">＋ 新增大类</button></aside>
   <div class="studio-content">
    <div class="studio-toolbar"><div class="studio-tabs"><button :class="{active:mode==='works'}" @click="mode='works'">款式图库</button><button :class="{active:mode==='services'}" @click="mode='services'">小项目</button><button :class="{active:mode==='featured'}" @click="mode='featured'">首页精选</button></div><input v-if="mode!=='services'" v-model="search" class="search-field" placeholder="搜索款式" aria-label="搜索款式"/></div>
    <div class="studio-heading"><h2>{{currentCategory?.name || '全部'}}<span>{{mode==='services'?services.length:works.length}}</span></h2><select v-if="mode!=='services'" v-model="serviceId" aria-label="筛选小项目"><option value="">全部小项目</option><option v-for="service in services" :key="service.id" :value="service.id">{{service.name}}</option></select></div>
    <div v-if="mode==='services'" class="project-grid"><article v-for="service in services" :key="service.id" class="project-tile"><img v-if="service.coverUrl" :src="service.coverUrl" alt=""/><div v-else class="project-cover-placeholder">{{service.categoryName}}</div><div class="tile-body"><div class="tile-title"><h3>{{service.name}}</h3><span :class="['pill',service.enabled?'green':'sand']">{{service.enabled?'上架':'下架'}}</span></div><p>{{money(service.priceFen)}} <span>· {{service.durationMinutes}} 分钟</span></p><button class="soft-button" @click="open('service',service)">编辑项目</button></div></article><button class="add-tile" @click="open('service')"><span>＋</span>新增小项目</button></div>
    <div v-else class="portfolio-grid"><article v-for="work in works" :key="work.id" class="portfolio-tile"><button class="portfolio-cover" :aria-label="'编辑款式 '+work.title" @click="open('work',work)"><img :src="work.imageUrl" :alt="work.title"/><span class="tile-badge" v-if="!work.published">已下架</span><span class="featured-badge" v-if="work.featured">★ 精选</span></button><div class="tile-body"><h3>{{work.title}}</h3><p>{{catalog.services.find(s=>s.id===work.serviceId)?.name || '未关联项目'}}</p><div class="tile-actions"><button class="text-button" @click="open('work',work)">编辑</button><button :class="['feature-toggle',{on:work.featured}]" :disabled="saving||!work.published" @click="toggleFeatured(work)">{{work.featured?'★ 已精选':'☆ 设为精选'}}</button></div></div></article><button class="add-tile" @click="open('work')"><span>＋</span>新增款式</button></div>
   </div>
  </div>
  <div v-if="draft" class="editor-backdrop" @click.self="close" @keydown.esc="close"><section class="studio-modal" role="dialog" aria-modal="true" :aria-label="editor==='category'?'编辑大类':editor==='service'?'编辑小项目':'编辑款式'">
   <header><div><span class="modal-context">{{editor==='category'?'大类':editor==='service'?'小项目':'款式'}}</span><h2>{{draft.id?'编辑':'新增'}}{{editor==='category'?'大类':editor==='service'?'小项目':'款式'}}</h2></div><button class="icon-button" :disabled="saving||uploading" @click="close" aria-label="关闭编辑">×</button></header>
   <form @submit.prevent="save"><div class="modal-content"><ImageUploader v-model="draft[editor==='work'?'imageUrl':'coverUrl']" :preview-url="draft.previewUrl" :label="editor==='work'?'上传款式图片':'上传封面'" @busy="uploading=$event"/><div class="modal-fields">
    <label>{{editor==='work'?'款式名称':editor==='category'?'大类名称':'项目名称'}}<input v-model="draft[editor==='work'?'title':'name']" required maxlength="80" autofocus placeholder="填写名称"/></label>
    <template v-if="editor!=='category'"><label>所属大类<select v-model="draft.categoryId" required @change="draft.serviceId='' "><option value="" disabled>选择大类</option><option v-for="category in categories.filter(c=>c.enabled)" :key="category.id" :value="category.id">{{category.name}}</option></select></label><label v-if="editor==='work'">所属小项目<select v-model="draft.serviceId" required><option value="" disabled>选择小项目</option><option v-for="service in projectOptions" :key="service.id" :value="service.id">{{service.name}}</option></select></label></template>
    <template v-if="editor==='service'"><div class="form-pair"><label>价格（元）<input v-model.number="draft.price" required type="number" min="0.01" step="0.01"/></label><label>服务时长（分钟）<input v-model.number="draft.durationMinutes" required type="number" min="1" max="720"/></label></div><label>整理时间（分钟）<input v-model.number="draft.bufferMinutes" type="number" min="0"/></label></template>
    <template v-if="editor==='category'"><label>分类图标<div class="icon-choices"><button v-for="icon in ['✦','⌁','◌','♡','✿','◇']" :key="icon" type="button" :class="{selected:draft.icon===icon}" @click="draft.icon=icon">{{icon}}</button></div></label><label>分类颜色<input v-model="draft.color" type="color"/></label></template>
    <div class="form-pair"><label>展示顺序<input v-model.number="draft.sort" type="number" min="0"/></label><label v-if="editor==='work'&&draft.featured">精选顺序<input v-model.number="draft.featuredSort" type="number" min="0"/></label></div>
    <label class="switch-row"><span>{{editor==='category'?'启用分类':'上架展示'}}</span><input v-model="draft[editor==='work'?'published':'enabled']" type="checkbox"/></label><label v-if="editor==='work'" class="switch-row"><span>设为首页精选</span><input v-model="draft.featured" type="checkbox"/></label>
   </div></div><p v-if="error" class="modal-error" role="alert">{{error}}</p><footer><button type="button" class="soft-button" @click="close" :disabled="saving||uploading">取消</button><button class="primary-button" :disabled="saving||uploading">{{uploading?'图片上传中…':saving?'保存中…':'保存'}}</button></footer></form>
  </section></div>
 </section>
</template>
