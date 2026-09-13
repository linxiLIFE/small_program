const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');

const { db } = require('./lib/db');
const { COLLECTIONS } = require('./lib/constants');
const { categories, services, works, serviceIdsByCategory } = require('./lib/catalog-data');

const technicians = [
  { _id: 'tech-lin', id: 'tech-lin', name: '林老师', title: '主理人 · 美甲师', bio: '擅长低饱和、法式与手绘细节，喜欢把每一双手的气质做出来。', categoryIds: ['nail', 'foot-nail'], skills: [], avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80', sort: 1, enabled: true },
  { _id: 'tech-zhou', id: 'tech-zhou', name: '周老师', title: '高级眉形设计师', bio: '以自然毛流和面部比例为优先，擅长通勤眉与原生感眉形设计。', categoryIds: ['brow'], skills: [], avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=80', sort: 2, enabled: true },
  { _id: 'tech-he', id: 'tech-he', name: '何老师', title: '美睫 · 纹绣师', bio: '专注自然美睫、纹绣与术后恢复沟通，先充分沟通，再决定最适合你的方案。', categoryIds: ['lash', 'tattoo'], skills: [], avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&q=80', sort: 3, enabled: true }
];

const settings = { _id: 'v1', id: 'v1', version: 1, published: true, timezone: 'Asia/Shanghai', store: { storeName: '四个小姐姐的店', address: '预约成功后展示详细地址', phone: '', notice: '每次预约只安排一位顾客和一位技师，请提前 5 分钟到店。' }, booking: { openDays: 14, minAdvanceMinutes: 60, slotStepMinutes: 15, unpaidHoldMinutes: 5, noShowGraceMinutes: 30 }, points: { pointRateFen: 100, unit: 20, discountFen: 100, maxPercent: 10 }, schedule: { weekly: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] })) }, createdAt: Date.now() };

async function write(collection, item) {
  const { _id, ...data } = item;
  await db.collection(collection).doc(_id).set({ data: { ...data, id: _id } });
}

exports.main = async (event = {}) => {
  const expected = String(process.env.SEED_ADMIN_SECRET || '');
  const received = String(event.secret || '');
  const secretValid = expected.length >= 32
    && received.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (process.env.SEED_ENABLED !== 'true' || event.confirm !== 'SEED_DEMO_DATA' || !secretValid) {
    return { ok: false, message: '演示数据初始化未启用或授权失败' };
  }
  for (const item of categories) await write(COLLECTIONS.categories, item);
  for (const item of services) await write(COLLECTIONS.services, item);
  for (const item of technicians) await write(COLLECTIONS.technicians, item);
  for (const item of works) await write(COLLECTIONS.works, item);
  await write(COLLECTIONS.settings, settings);
  return { ok: true, tables: [COLLECTIONS.categories, COLLECTIONS.services, COLLECTIONS.technicians, COLLECTIONS.works, COLLECTIONS.settings], count: categories.length + services.length + technicians.length + works.length + 1 };
};
