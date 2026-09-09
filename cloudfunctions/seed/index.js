const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { db } = require('./lib/db');
const { COLLECTIONS } = require('./lib/constants');

const categories = [
  { _id: 'nail', id: 'nail', name: '美甲', subtitle: '指尖的小心思', icon: '✦', color: '#f7d9d3', sort: 1, enabled: true },
  { _id: 'brow', id: 'brow', name: '美眉', subtitle: '自然有神', icon: '⌁', color: '#e9dccd', sort: 2, enabled: true },
  { _id: 'tattoo', id: 'tattoo', name: '纹绣', subtitle: '耐看的精致', icon: '◌', color: '#ead5db', sort: 3, enabled: true }
];

const services = [
  { _id: 'svc-nail-french', id: 'svc-nail-french', categoryId: 'nail', categoryName: '美甲', name: '奶油法式美甲', description: '低饱和奶油色打底，搭配细线法式与手绘小花，适合日常通勤。', priceFen: 29900, durationMinutes: 90, bufferMinutes: 15, coverUrl: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=80', tags: ['显白', '法式', '含基础护理'], sort: 1, enabled: true, version: 1 },
  { _id: 'svc-nail-jelly', id: 'svc-nail-jelly', categoryId: 'nail', categoryName: '美甲', name: '玫瑰果冻裸色', description: '透亮果冻感与轻薄加固，干净耐看，适合第一次做美甲。', priceFen: 23900, durationMinutes: 75, bufferMinutes: 15, coverUrl: 'https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=900&q=80', tags: ['裸色', '轻薄', '新手友好'], sort: 2, enabled: true, version: 1 },
  { _id: 'svc-brow-natural', id: 'svc-brow-natural', categoryId: 'brow', categoryName: '美眉', name: '自然野生眉设计', description: '根据脸型、眉骨和毛流重新设计，保留自然感，日常无需反复描画。', priceFen: 19900, durationMinutes: 60, bufferMinutes: 15, coverUrl: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=900&q=80', tags: ['脸型分析', '自然眉', '含修眉'], sort: 1, enabled: true, version: 1 },
  { _id: 'svc-tattoo-lip', id: 'svc-tattoo-lip', categoryId: 'tattoo', categoryName: '纹绣', name: '轻氧嘟嘟唇', description: '按唇色与唇形定制色乳，追求自然提气色，包含术前沟通与术后护理说明。', priceFen: 128000, durationMinutes: 150, bufferMinutes: 30, coverUrl: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=80', tags: ['定制色乳', '术后指导', '需提前沟通'], sort: 1, enabled: true, version: 1 }
];

const technicians = [
  { _id: 'tech-lin', id: 'tech-lin', name: '林老师', title: '主理人 · 美甲师', bio: '擅长低饱和、法式与手绘细节，喜欢把每一双手的气质做出来。', skills: ['svc-nail-french', 'svc-nail-jelly'], avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80', sort: 1, enabled: true },
  { _id: 'tech-zhou', id: 'tech-zhou', name: '周老师', title: '高级眉形设计师', bio: '以自然毛流和面部比例为优先，擅长通勤眉与原生感眉形设计。', skills: ['svc-brow-natural'], avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=80', sort: 2, enabled: true },
  { _id: 'tech-he', id: 'tech-he', name: '何老师', title: '纹绣师', bio: '专注自然纹绣与术后恢复沟通，先充分沟通，再决定最适合你的方案。', skills: ['svc-tattoo-lip'], avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&q=80', sort: 3, enabled: true }
];

const works = services.map((service, index) => ({
  _id: `work-00${index + 1}`,
  id: `work-00${index + 1}`,
  categoryId: service.categoryId,
  categoryName: service.categoryName,
  title: service.name,
  description: service.description,
  imageUrl: service.coverUrl,
  serviceId: service.id,
  technicianId: technicians.find((item) => item.skills.includes(service.id)).id,
  published: true,
  sort: index + 1
}));

const settings = { _id: 'v1', id: 'v1', version: 1, published: true, timezone: 'Asia/Shanghai', store: { storeName: '拾光美研', address: '预约成功后展示详细地址', phone: '', notice: '每次预约只安排一位顾客和一位技师，请提前 5 分钟到店。' }, booking: { openDays: 14, minAdvanceMinutes: 60, slotStepMinutes: 15, unpaidHoldMinutes: 5, noShowGraceMinutes: 30 }, points: { pointRateFen: 100, unit: 20, discountFen: 100, maxPercent: 10 }, schedule: { weekly: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] })) }, createdAt: Date.now() };

async function write(collection, item) {
  const { _id, ...data } = item;
  await db.collection(collection).doc(_id).set({ data: { ...data, id: _id } });
}

exports.main = async (event = {}) => {
  if (event.confirm !== 'SEED_DEMO_DATA') return { ok: false, message: '需要传入 confirm=SEED_DEMO_DATA 才会写入演示目录' };
  for (const item of categories) await write(COLLECTIONS.categories, item);
  for (const item of services) await write(COLLECTIONS.services, item);
  for (const item of technicians) await write(COLLECTIONS.technicians, item);
  for (const item of works) await write(COLLECTIONS.works, item);
  await write(COLLECTIONS.settings, settings);
  return { ok: true, tables: [COLLECTIONS.categories, COLLECTIONS.services, COLLECTIONS.technicians, COLLECTIONS.works, COLLECTIONS.settings], count: categories.length + services.length + technicians.length + works.length + 1 };
};
