<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CatalogResponse, Category, Service, Work } from '../types';
import { adminApi, money } from '../api';
import ImageUploader from './ImageUploader.vue';
import CatalogImage from './CatalogImage.vue';

type Editor = 'category' | 'service' | 'work';
type WorkStep = 'category' | 'service' | 'detail';
type SortKind = Editor;

const props = defineProps<{ catalog: CatalogResponse }>();
const emit = defineEmits<{ changed: [] }>();
const categoryId = ref('');
const serviceId = ref('');
const search = ref('');
const featuredOnly = ref(false);
const draft = ref<any>(null);
const editor = ref<Editor>('work');
const workStep = ref<WorkStep>('category');
const saving = ref(false);
const uploading = ref(false);
const error = ref('');
const notice = ref('');
const deleteTarget = ref<{ kind: Editor; id: string; name: string; services: number; works: number } | null>(null);
const dragging = ref<{ kind: SortKind; id: string } | null>(null);
const dropTarget = ref<{ kind: SortKind; id: string } | null>(null);
let sortPress: { kind: SortKind; id: string; pointerId: number; startX: number; startY: number; started: boolean } | null = null;
let sortPressTimer: number | null = null;

function compareOrder(left: { sort?: number; id: string }, right: { sort?: number; id: string }): number {
  const leftSort = Number(left.sort);
  const rightSort = Number(right.sort);
  const leftRank = Number.isSafeInteger(leftSort) && leftSort > 0 ? leftSort : Number.MAX_SAFE_INTEGER;
  const rightRank = Number.isSafeInteger(rightSort) && rightSort > 0 ? rightSort : Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.id.localeCompare(right.id);
}

const categories = computed(() => [...(props.catalog.categories || [])].sort(compareOrder));
const services = computed(() => props.catalog.services
  .filter((service) => !categoryId.value || service.categoryId === categoryId.value)
  .map((service) => ({ ...service, styleCount: service.styleCount ?? styleCountFor(service.id) }))
  .sort(compareOrder));
const selectedCategory = computed(() => categories.value.find((category) => category.id === categoryId.value));
const selectedService = computed(() => services.value.find((service) => service.id === serviceId.value));
const serviceWorks = computed(() => props.catalog.works
  .filter((work) => work.serviceId === serviceId.value)
  .sort(compareOrder));
const works = computed(() => serviceWorks.value
  .filter((work) => (!categoryId.value || work.categoryId === categoryId.value || serviceFor(work.serviceId)?.categoryId === categoryId.value)
    && (!search.value.trim() || work.title.includes(search.value.trim()))
    && (!featuredOnly.value || work.featured)));
const projectOptions = computed(() => props.catalog.services
  .filter((service) => service.bookableStandalone !== false && (service.enabled || service.id === draft.value?.serviceId) && service.categoryId === draft.value?.categoryId)
  .sort(compareOrder));

const sortLimit = computed(() => {
  if (!draft.value) return 1;
  if (editor.value === 'category') return Math.max(1, categories.value.length + (draft.value.id ? 0 : 1));
  if (editor.value === 'service') {
    const sameGroup = draft.value.id && draft.value._originalParentId === draft.value.categoryId;
    return Math.max(1, servicesForCategory(draft.value.categoryId).length + (sameGroup ? 0 : 1));
  }
  const sameGroup = draft.value.id && draft.value._originalParentId === draft.value.serviceId;
  return Math.max(1, worksForService(draft.value.serviceId).length + (sameGroup ? 0 : 1));
});

watch(categories, (items) => {
  const current = items.find((item) => item.id === categoryId.value);
  if (!current) categoryId.value = items.find((item) => item.enabled)?.id || items[0]?.id || '';
  if (serviceId.value && !services.value.some((item) => item.id === serviceId.value)) serviceId.value = '';
}, { immediate: true });

function serviceFor(id: string): Service | undefined { return props.catalog.services.find((service) => service.id === id); }
function styleCountFor(id: string): number { return props.catalog.works.filter((work) => work.serviceId === id && work.published !== false).length; }
function projectCountFor(id: string): number { return props.catalog.services.filter((service) => service.categoryId === id).length; }
function categoryStyleCountFor(id: string): number { return props.catalog.works.filter((work) => serviceFor(work.serviceId)?.categoryId === id && work.published !== false).length; }
function servicesForCategory(id: string): Service[] { return props.catalog.services.filter((service) => service.categoryId === id).slice().sort(compareOrder); }
function worksForService(id: string): Work[] { return props.catalog.works.filter((work) => work.serviceId === id).slice().sort(compareOrder); }
function displayRank(items: Array<{ id: string }>, id: string): number {
  const index = items.findIndex((item) => item.id === id);
  return index >= 0 ? index + 1 : items.length + 1;
}
function catalogRank(kind: SortKind, item: Category | Service | Work): number {
  if (kind === 'category') return displayRank(categories.value, item.id);
  if (kind === 'service') return displayRank(servicesForCategory((item as Service).categoryId), item.id);
  return displayRank(worksForService((item as Work).serviceId), item.id);
}
function durationLabel(minutes: number): string {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function selectCategory(id: string) { categoryId.value = id; serviceId.value = ''; }
function selectService(id: string) { serviceId.value = id; }

function open(kind: Editor, item?: Category | Service | Work) {
  editor.value = kind;
  error.value = '';
  uploading.value = false;
  if (item) {
    draft.value = { ...item };
    draft.value._originalParentId = kind === 'service' ? (item as Service).categoryId : kind === 'work' ? (item as Work).serviceId : '';
    draft.value.sort = catalogRank(kind, item);
    if (kind === 'service') draft.value.price = Number((item as Service).priceFen) / 100;
    const field = kind === 'work' ? 'imageUrl' : 'coverUrl';
    const fileField = kind === 'work' ? 'imageFileID' : 'coverFileID';
    draft.value.previewUrl = draft.value[field];
    draft.value[field] = draft.value[fileField] || draft.value[field] || '';
    delete draft.value[fileField];
    if (kind === 'work') {
      draft.value.categoryId = serviceFor((item as Work).serviceId)?.categoryId || '';
      draft.value.serviceId = (item as Work).serviceId;
      workStep.value = 'detail';
    }
    return;
  }
  const firstCategory = categories.value.find((category) => category.enabled) || categories.value[0];
  if (kind === 'category') draft.value = { name: '', icon: '✦', color: '#f1ded8', enabled: true, coverUrl: '', sort: categories.value.length + 1, _originalParentId: '' };
  if (kind === 'service') {
    const targetCategoryId = categoryId.value || firstCategory?.id || '';
    draft.value = { name: '', categoryId: targetCategoryId, coverUrl: '', price: 0, durationMinutes: 60, addonType: '', enabled: true, description: '', sort: servicesForCategory(targetCategoryId).length + 1, _originalParentId: '' };
  }
  if (kind === 'work') {
    const targetServiceId = serviceId.value || '';
    draft.value = { title: '', categoryId: categoryId.value || firstCategory?.id || '', serviceId: targetServiceId, imageUrl: '', published: true, featured: false, sort: worksForService(targetServiceId).length + 1, _originalParentId: '' };
    workStep.value = draft.value.serviceId ? 'detail' : draft.value.categoryId ? 'service' : 'category';
  }
}

function syncServiceOrder() {
  if (!draft.value || editor.value !== 'service') return;
  const sameGroup = draft.value.id && draft.value._originalParentId === draft.value.categoryId;
  draft.value.sort = sameGroup
    ? displayRank(servicesForCategory(draft.value.categoryId), draft.value.id)
    : servicesForCategory(draft.value.categoryId).length + 1;
}

function chooseDraftCategory(id: string) {
  if (!draft.value) return;
  draft.value.categoryId = id;
  draft.value.serviceId = '';
  workStep.value = 'service';
}

function chooseDraftService(id: string) {
  if (!draft.value) return;
  const previousServiceId = draft.value.serviceId;
  draft.value.serviceId = id;
  if (previousServiceId !== id) {
    const sameGroup = draft.value.id && draft.value._originalParentId === id;
    draft.value.sort = sameGroup ? displayRank(worksForService(id), draft.value.id) : worksForService(id).length + 1;
  }
  workStep.value = 'detail';
}

function goWorkStep(step: WorkStep) {
  if (step === 'service' && !draft.value?.categoryId) return;
  if (step === 'detail' && !draft.value?.serviceId) return;
  workStep.value = step;
}

async function save() {
  if (!draft.value || saving.value || uploading.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const sort = Number(draft.value.sort);
    if (!Number.isSafeInteger(sort) || sort < 1 || sort > sortLimit.value) throw new Error(`显示顺序必须在 1 到 ${sortLimit.value} 之间`);
    if (!draft.value.id) draft.value.id = crypto.randomUUID();
    const value = { ...draft.value };
    if (editor.value === 'category') await adminApi.saveCategory(value);
    else if (editor.value === 'service') await adminApi.saveService({ ...value, priceFen: Math.round(Number(value.price) * 100) });
    else {
      if (!value.categoryId || !value.serviceId) throw new Error('请先选择大项和小项目');
      if (!value.imageUrl) throw new Error('请先上传款式图片');
      await adminApi.saveWork(value);
    }
    draft.value = null;
    notice.value = '已保存';
    emit('changed');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function toggleFeatured(work: Work) {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await adminApi.saveWork({ ...work, featured: !work.featured });
    notice.value = work.featured ? '已取消精选' : '已设为首页精选';
    emit('changed');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

function sortItems(kind: SortKind): Array<Category | Service | Work> {
  if (kind === 'category') return categories.value;
  if (kind === 'service') return services.value;
  return serviceWorks.value;
}

function clearSortListeners() {
  window.removeEventListener('pointermove', moveSortPointer);
  window.removeEventListener('pointerup', finishSortPointer);
  window.removeEventListener('pointercancel', cancelSortPointer);
}

function resetSortPointer() {
  if (sortPressTimer !== null) window.clearTimeout(sortPressTimer);
  sortPressTimer = null;
  sortPress = null;
  dragging.value = null;
  dropTarget.value = null;
  clearSortListeners();
}

function beginSortDrag(kind: SortKind, id: string, event: PointerEvent) {
  if (saving.value || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  resetSortPointer();
  sortPress = { kind, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
  window.addEventListener('pointermove', moveSortPointer, { passive: false });
  window.addEventListener('pointerup', finishSortPointer);
  window.addEventListener('pointercancel', cancelSortPointer);
  sortPressTimer = window.setTimeout(() => {
    if (!sortPress) return;
    sortPress.started = true;
    dragging.value = { kind, id };
  }, 340);
}

function moveSortPointer(event: PointerEvent) {
  if (!sortPress || event.pointerId !== sortPress.pointerId) return;
  if (!sortPress.started) {
    if (Math.hypot(event.clientX - sortPress.startX, event.clientY - sortPress.startY) > 10) resetSortPointer();
    return;
  }
  event.preventDefault();
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-catalog-sort-kind][data-catalog-sort-id]');
  if (element?.dataset.catalogSortKind === sortPress.kind && element.dataset.catalogSortId) {
    dropTarget.value = { kind: sortPress.kind, id: element.dataset.catalogSortId };
  } else {
    dropTarget.value = null;
  }
}

function finishSortPointer(event: PointerEvent) {
  const current = sortPress;
  if (!current || event.pointerId !== current.pointerId) return;
  if (current.started) moveSortPointer(event);
  const targetId = current.started && dropTarget.value?.kind === current.kind ? dropTarget.value.id : '';
  const list = sortItems(current.kind);
  const sourceIndex = list.findIndex((item) => item.id === current.id);
  const targetIndex = list.findIndex((item) => item.id === targetId);
  let nextSort = 0;
  if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
    const targetElement = Array.from(document.querySelectorAll<HTMLElement>('[data-catalog-sort-kind][data-catalog-sort-id]'))
      .find((item) => item.dataset.catalogSortKind === current.kind && item.dataset.catalogSortId === targetId);
    const after = targetElement ? event.clientY >= targetElement.getBoundingClientRect().top + targetElement.getBoundingClientRect().height / 2 : false;
    let nextIndex = targetIndex + (after ? 1 : 0);
    if (sourceIndex < nextIndex) nextIndex -= 1;
    nextSort = nextIndex + 1;
  }
  const { kind, id } = current;
  resetSortPointer();
  if (nextSort > 0 && nextSort !== sourceIndex + 1) void persistCatalogOrder(kind, id, nextSort);
}

function cancelSortPointer() { resetSortPointer(); }

function isDragging(kind: SortKind, id: string): boolean { return dragging.value?.kind === kind && dragging.value.id === id; }
function isDropTarget(kind: SortKind, id: string): boolean { return dropTarget.value?.kind === kind && dropTarget.value.id === id; }

async function persistCatalogOrder(kind: SortKind, id: string, sort: number) {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await adminApi.reorderCatalog(kind, id, sort);
    notice.value = `已调整到第 ${sort} 位`;
    emit('changed');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '排序保存失败';
  } finally {
    saving.value = false;
  }
}

onBeforeUnmount(resetSortPointer);

function close() { if (!saving.value && !uploading.value) draft.value = null; }
function askDelete(kind: Editor, item: Category | Service | Work) {
  error.value = '';
  notice.value = '';
  const id = item.id;
  deleteTarget.value = {
    kind, id, name: kind === 'work' ? (item as Work).title : (item as Category | Service).name,
    services: kind === 'category' ? projectCountFor(id) : 0,
    works: kind === 'category' ? props.catalog.works.filter(work => work.categoryId === id || serviceFor(work.serviceId)?.categoryId === id).length
      : kind === 'service' ? props.catalog.works.filter(work => work.serviceId === id).length : 0
  };
}
async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    if (target.kind === 'category') await adminApi.deleteCategory(target.id);
    else if (target.kind === 'service') await adminApi.deleteService(target.id);
    else await adminApi.deleteWork(target.id);
    if (target.kind === 'category' && categoryId.value === target.id) { categoryId.value = ''; serviceId.value = ''; }
    if (target.kind === 'service' && serviceId.value === target.id) serviceId.value = '';
    deleteTarget.value = null;
    notice.value = `已删除${target.kind === 'category' ? '大项' : target.kind === 'service' ? '小项目' : '款式'}“${target.name}”`;
    emit('changed');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <section class="catalog-studio">
    <div class="page-intro"><div><h1>项目与款式</h1></div><div class="toolbar-actions"><button class="soft-button" type="button" @click="open('category')">＋ 新增大项</button><button class="soft-button" type="button" @click="open('service')">＋ 新增小项目</button><button class="primary-button" type="button" @click="open('work')">＋ 新增款式</button></div></div>
    <div v-if="notice && !draft" class="inline-success" role="status">{{ notice }}</div><div v-if="error && !draft" class="field-error" role="alert">{{ error }}</div>

    <div class="catalog-flow">
      <section class="catalog-flow-section">
        <div class="flow-heading"><span class="flow-number">01</span><div><h2>选择大项</h2><p>按住“⠿”拖动调整顺序，数字就是当前顺序。</p></div><span class="flow-count">{{ categories.length }}</span></div>
        <div class="category-choice-grid">
          <article v-for="category in categories" :key="category.id" :data-catalog-sort-kind="'category'" :data-catalog-sort-id="category.id" :class="['category-choice-card', { selected: categoryId === category.id, disabled: !category.enabled, 'catalog-sort-dragging': isDragging('category', category.id), 'catalog-sort-target': isDropTarget('category', category.id) }]" @click="selectCategory(category.id)">
            <button class="category-choice" type="button"><span class="catalog-order-number">{{ catalogRank('category', category) }}</span><span class="category-choice-icon" :style="{ background: category.color }">{{ category.icon }}</span><span class="category-choice-copy"><strong>{{ category.name }}</strong><small>{{ projectCountFor(category.id) }} 个小项目 · {{ categoryStyleCountFor(category.id) }} 款式</small></span><span v-if="!category.enabled" class="choice-status">停用</span></button>
            <div class="choice-card-actions"><button class="catalog-sort-handle" type="button" :disabled="saving" :aria-label="`按住拖动大项 ${category.name}`" @pointerdown.stop="beginSortDrag('category', category.id, $event)" @click.stop.prevent>⠿</button><button type="button" @click.stop="open('category', category)">编辑</button><button class="delete-link" type="button" @click.stop="askDelete('category', category)">删除</button></div>
          </article>
          <button class="choice-add-card" type="button" @click="open('category')"><span>＋</span><strong>新增大项</strong></button>
        </div>
      </section>

      <section class="catalog-flow-section" :class="{ 'flow-disabled': !categoryId }">
        <div class="flow-heading"><span class="flow-number">02</span><div><h2>{{ selectedCategory?.name || '小项目' }}</h2><p>按住“⠿”拖动调整顺序，序号可在编辑里直接输入。</p></div><span class="flow-count">{{ services.length }}</span></div>
        <div v-if="categoryId" class="project-choice-grid">
          <article v-for="service in services" :key="service.id" :data-catalog-sort-kind="'service'" :data-catalog-sort-id="service.id" :class="['project-choice-card', { selected: serviceId === service.id, disabled: !service.enabled, 'catalog-sort-dragging': isDragging('service', service.id), 'catalog-sort-target': isDropTarget('service', service.id) }]" @click="selectService(service.id)">
            <button class="project-choice" type="button"><span class="catalog-order-number">{{ catalogRank('service', service) }}</span><CatalogImage v-if="service.coverUrl" :src="service.coverUrl" :alt="service.name"/><span v-else class="project-choice-cover">{{ service.categoryName }}</span><span class="project-choice-copy"><strong>{{ service.name }}</strong><small>{{ service.addonType === 'REMOVAL' ? '卸甲 · 单独 '+money(service.priceFen) : service.addonType === 'BUILDER' ? '建构 · '+money(service.priceFen) : money(service.priceFen) }} · {{ durationLabel(service.durationMinutes) }}</small><small>{{ (service.styleCount || 0) }} 款式{{ service.isAddon ? ' · 可叠加' : '' }}</small></span><span :class="['pill', service.enabled ? 'green' : 'sand']">{{ service.enabled ? '上架' : '下架' }}</span></button>
            <div class="choice-card-actions"><button class="catalog-sort-handle" type="button" :disabled="saving" :aria-label="`按住拖动小项目 ${service.name}`" @pointerdown.stop="beginSortDrag('service', service.id, $event)" @click.stop.prevent>⠿</button><button type="button" @click.stop="open('service', service)">编辑小项目</button><button class="delete-link" type="button" @click.stop="askDelete('service', service)">删除</button></div>
          </article>
          <button class="choice-add-card project-add-card" type="button" @click="open('service')"><span>＋</span><strong>新增小项目</strong></button>
        </div>
      </section>

      <section class="catalog-flow-section" :class="{ 'flow-disabled': !serviceId }">
        <div class="flow-heading"><span class="flow-number">03</span><div><h2>{{ selectedService?.name || '款式图库' }}</h2><p>{{ serviceId ? (selectedService?.isAddon ? '按住“⠿”拖动调整款式顺序。' : '按住“⠿”拖动调整款式顺序，序号可在编辑里直接输入。') : '先选择小项目后查看对应款式。' }}</p><small v-if="featuredOnly || search.trim()">清除筛选后可拖动排序。</small></div><div class="flow-tools"><button v-if="serviceId && !selectedService?.isAddon" :class="['filter-chip', { active: featuredOnly }]" type="button" @click="featuredOnly = !featuredOnly">{{ featuredOnly ? '只看精选' : '全部款式' }}</button><input v-if="serviceId && !selectedService?.isAddon" v-model="search" class="search-field" placeholder="搜索款式" aria-label="搜索款式"/></div></div>
        <div v-if="serviceId" class="portfolio-grid">
          <article v-for="work in works" :key="work.id" :data-catalog-sort-kind="'work'" :data-catalog-sort-id="work.id" :class="['portfolio-tile', { 'catalog-sort-dragging': isDragging('work', work.id), 'catalog-sort-target': isDropTarget('work', work.id) }]">
            <button class="portfolio-cover" type="button" :aria-label="'编辑款式 ' + work.title" @click="open('work', work)"><CatalogImage :src="work.imageUrl" :alt="work.title"/><span class="catalog-order-badge">{{ catalogRank('work', work) }}</span><span v-if="!work.published" class="tile-badge">已下架</span><span v-if="work.featured" class="featured-badge">★ 精选</span></button>
            <button class="catalog-sort-handle portfolio-sort-handle" type="button" :disabled="saving || featuredOnly || !!search.trim()" :title="featuredOnly || search.trim() ? '清除搜索和精选筛选后可拖动排序' : '按住拖动调整顺序'" :aria-label="`按住拖动款式 ${work.title}`" @pointerdown.stop="beginSortDrag('work', work.id, $event)" @click.stop.prevent>⠿</button>
            <div class="tile-body"><h3>{{ work.title }}</h3><p>{{ serviceFor(work.serviceId)?.name || '未关联项目' }}</p><div class="tile-actions"><button class="text-button" type="button" @click="open('work', work)">编辑</button><button v-if="!selectedService?.isAddon" :class="['feature-toggle', { on: work.featured }]" :disabled="saving || !work.published" type="button" @click="toggleFeatured(work)">{{ work.featured ? '★ 已精选' : '☆ 设为精选' }}</button><button v-if="!selectedService?.isAddon" class="text-button delete-link" type="button" @click="askDelete('work', work)">删除</button></div></div>
          </article>
          <button v-if="!selectedService?.isAddon" class="add-tile" type="button" @click="open('work')"><span>＋</span>新增款式</button>
        </div>
        <div v-else class="flow-empty"><span>03</span><strong>选择小项目后进入款式图库</strong></div>
      </section>
    </div>

    <div v-if="deleteTarget" class="editor-backdrop" @click.self="!saving && (deleteTarget = null)" @keydown.esc="!saving && (deleteTarget = null)"><section class="compact-modal catalog-delete-modal" role="dialog" aria-modal="true" aria-label="确认删除项目"><h2>删除“{{ deleteTarget.name }}”？</h2><p v-if="deleteTarget.kind === 'category'">其下 {{ deleteTarget.services }} 个小项目及 {{ deleteTarget.works }} 个款式会同时从项目列表移除。</p><p v-else-if="deleteTarget.kind === 'service'">其下 {{ deleteTarget.works }} 个款式会同时从项目列表移除。</p><p v-else>这款式会从项目列表移除。</p><p>已有顾客预约及订单记录保留，仍可正常查看和处理。</p><p v-if="error" class="field-error" role="alert">{{ error }}</p><div class="catalog-delete-actions"><button class="soft-button" type="button" :disabled="saving" @click="deleteTarget = null">取消</button><button class="primary-button" type="button" :disabled="saving" @click="confirmDelete">{{ saving ? '删除中…' : '确认删除' }}</button></div></section></div>

    <div v-if="draft" class="editor-backdrop" @click.self="close" @keydown.esc="close"><section class="studio-modal catalog-editor-modal" role="dialog" aria-modal="true" :aria-label="editor === 'category' ? '编辑大项' : editor === 'service' ? '编辑小项目' : '编辑款式'"><header><div><span class="modal-context">{{ editor === 'category' ? '大项' : editor === 'service' ? '小项目' : '大项 → 小项目 → 款式' }}</span><h2>{{ draft.id ? '编辑' : '新增' }}{{ editor === 'category' ? '大项' : editor === 'service' ? '小项目' : '款式' }}</h2></div><button class="icon-button" type="button" :disabled="saving || uploading" @click="close" aria-label="关闭编辑">×</button></header>

      <template v-if="editor === 'work'"><nav class="work-stepper" aria-label="款式添加步骤"><button type="button" :class="{ active: workStep === 'category' }" @click="goWorkStep('category')"><span>01</span>选择大项</button><button type="button" :class="{ active: workStep === 'service' }" :disabled="!draft.categoryId" @click="goWorkStep('service')"><span>02</span>选择小项目</button><button type="button" :class="{ active: workStep === 'detail' }" :disabled="!draft.serviceId" @click="goWorkStep('detail')"><span>03</span>填写款式</button></nav><div v-if="workStep === 'category'" class="work-step-panel"><div class="step-panel-heading"><h3>选择大项</h3><p>先确定款式属于哪个大项。</p></div><div class="editor-choice-grid"><button v-for="category in categories.filter(item => item.enabled || item.id === draft.categoryId)" :key="category.id" type="button" :class="['editor-choice', { selected: draft.categoryId === category.id }]" @click="chooseDraftCategory(category.id)"><span class="category-choice-icon" :style="{ background: category.color }">{{ category.icon }}</span><span><strong>{{ category.name }}</strong><small>{{ projectCountFor(category.id) }} 个小项目</small></span><b>›</b></button></div><footer class="modal-step-actions"><button class="soft-button" type="button" @click="close">取消</button><button class="primary-button" type="button" :disabled="!draft.categoryId" @click="goWorkStep('service')">下一步</button></footer></div><div v-else-if="workStep === 'service'" class="work-step-panel"><div class="step-panel-heading"><h3>{{ categories.find(item => item.id === draft.categoryId)?.name || '选择小项目' }}</h3><p>继续选择具体小项目，款式会归到这里。</p></div><div class="editor-project-grid"><button v-for="service in projectOptions" :key="service.id" type="button" :class="['editor-project-choice', { selected: draft.serviceId === service.id }]" @click="chooseDraftService(service.id)"><img v-if="service.coverUrl" :src="service.coverUrl" alt=""/><span v-else class="project-choice-cover">{{ service.categoryName }}</span><span><strong>{{ service.name }}</strong><small>{{ money(service.priceFen) }} · {{ durationLabel(service.durationMinutes) }}</small></span><b>›</b></button></div><footer class="modal-step-actions"><button class="soft-button" type="button" @click="goWorkStep('category')">上一步</button><button class="primary-button" type="button" :disabled="!draft.serviceId" @click="goWorkStep('detail')">下一步</button></footer></div><form v-else class="work-detail-form" @submit.prevent="save"><div class="modal-content"><ImageUploader v-model="draft.imageUrl" :preview-url="draft.previewUrl" :crop-ratio="1" crop-label="款式图片" label="上传款式图片" @busy="uploading = $event"/><div class="modal-fields"><div class="selected-path"><span>所属路径</span><strong>{{ categories.find(item => item.id === draft.categoryId)?.name }} <i>→</i> {{ serviceFor(draft.serviceId)?.name }}</strong><button class="text-button" type="button" @click="goWorkStep('category')">更换所属</button></div><label>款式名称<input v-model="draft.title" required maxlength="80" autofocus placeholder="填写名称"/></label><label class="catalog-order-field">显示顺序<input v-model.number="draft.sort" type="number" min="1" :max="sortLimit" step="1" required/><small>第 {{draft.sort}} 位，共 {{sortLimit}} 个位置；后续顺序自动后移。</small></label><label class="switch-row"><span>上架展示</span><input v-model="draft.published" type="checkbox"/></label><label class="switch-row"><span>设为首页精选</span><input v-model="draft.featured" type="checkbox"/></label></div></div><p v-if="error" class="modal-error" role="alert">{{ error }}</p><footer><button class="soft-button" type="button" :disabled="saving || uploading" @click="close">取消</button><button class="primary-button" :disabled="saving || uploading">{{ uploading ? '图片上传中…' : saving ? '保存中…' : '保存款式' }}</button></footer></form></template>

      <form v-else @submit.prevent="save"><div class="modal-content"><ImageUploader v-model="draft.coverUrl" :preview-url="draft.previewUrl" :crop-ratio="editor === 'service' ? 1 : 0" :crop-label="editor === 'service' ? '小项目图片' : '大项封面'" :label="editor === 'category' ? '上传大项封面' : '上传项目图片'" @busy="uploading = $event"/><div class="modal-fields"><label>{{ editor === 'category' ? '大项名称' : '小项目名称' }}<input v-model="draft.name" required maxlength="80" autofocus placeholder="填写名称"/></label><label class="catalog-order-field">显示顺序<input v-model.number="draft.sort" type="number" min="1" :max="sortLimit" step="1" required/><small>第 {{draft.sort}} 位，共 {{sortLimit}} 个位置；后续顺序自动后移。</small></label><label v-if="editor === 'service'">所属大项<select v-model="draft.categoryId" @change="syncServiceOrder" required><option value="" disabled>选择大项</option><option v-for="category in categories.filter(item => item.enabled || item.id === draft.categoryId)" :key="category.id" :value="category.id">{{ category.name }}</option></select></label><template v-if="editor === 'service'"><label v-if="['nail','foot-nail'].includes(draft.categoryId)">预约用途<select v-model="draft.addonType"><option value="">普通小项目</option><option value="REMOVAL">卸甲选项</option><option value="BUILDER">建构选项（额外收费）</option></select></label><div class="form-pair"><label>单独预约价格（元）<input v-model.number="draft.price" required type="number" min="0.01" step="0.01"/></label><label>服务总时长（分钟）<input v-model.number="draft.durationMinutes" required type="number" min="1" max="720"/></label></div><small v-if="draft.addonType === 'REMOVAL'" class="field-note">卸本甲加项免费，其他卸甲按项目价收费；时长都会叠加。</small><small v-else-if="draft.addonType === 'BUILDER'" class="field-note">建构价格和时长都会叠加到主项目。</small></template><template v-else><label>分类图标<div class="icon-choices"><button v-for="icon in ['✦', '⌁', '◌', '♡', '✿', '◇']" :key="icon" type="button" :class="{ selected: draft.icon === icon }" @click="draft.icon = icon">{{ icon }}</button></div></label><label>分类颜色<input v-model="draft.color" type="color"/></label></template><label class="switch-row"><span>{{ editor === 'category' ? '启用大项' : '启用小项目' }}</span><input v-model="draft.enabled" type="checkbox"/></label></div></div><p v-if="error" class="modal-error" role="alert">{{ error }}</p><footer><button class="soft-button" type="button" :disabled="saving || uploading" @click="close">取消</button><button class="primary-button" :disabled="saving || uploading">{{ uploading ? '图片上传中…' : saving ? '保存中…' : '保存' }}</button></footer></form>
    </section></div>
  </section>
</template>
