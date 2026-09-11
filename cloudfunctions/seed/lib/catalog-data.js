const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=80';
const DURATION_OPTIONS = [60, 90, 120];

function durationFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DURATION_OPTIONS[hash % DURATION_OPTIONS.length];
}

function service({ id, categoryId, categoryName, name, priceFen, description, tags = [], sort, isAddon = false }) {
  return {
    _id: id,
    id,
    categoryId,
    categoryName,
    name,
    description,
    priceFen,
    durationMinutes: durationFor(id),
    coverUrl: PLACEHOLDER_IMAGE,
    tags,
    sort,
    enabled: true,
    version: 1,
    ...(isAddon ? { isAddon: true, bookableStandalone: false } : {})
  };
}

const categories = [
  { _id: 'nail', id: 'nail', name: '美甲', subtitle: '指尖的小心思', icon: '✦', color: '#f7d9d3', sort: 1, enabled: true },
  { _id: 'foot-nail', id: 'foot-nail', name: '脚部美甲', subtitle: '脚尖也要精致', icon: '◇', color: '#ecd9cc', sort: 2, enabled: true },
  { _id: 'lash', id: 'lash', name: '睫毛', subtitle: '放大眼神', icon: '♡', color: '#ead7df', sort: 3, enabled: true },
  { _id: 'brow', id: 'brow', name: '眉毛', subtitle: '自然有神', icon: '⌁', color: '#e9dccd', sort: 4, enabled: true },
  { _id: 'tattoo', id: 'tattoo', name: '纹绣', subtitle: '耐看的精致', icon: '◌', color: '#ead5db', sort: 5, enabled: true }
];

const legacyServices = [
  { _id: 'svc-nail-french', id: 'svc-nail-french', categoryId: 'nail', categoryName: '美甲', name: '奶油法式美甲', description: '低饱和奶油色打底，搭配细线法式与手绘小花，适合日常通勤。', priceFen: 29900, durationMinutes: 90, coverUrl: PLACEHOLDER_IMAGE, tags: ['显白', '法式', '含基础护理'], sort: 1, enabled: true, version: 1 },
  { _id: 'svc-nail-jelly', id: 'svc-nail-jelly', categoryId: 'nail', categoryName: '美甲', name: '玫瑰果冻裸色', description: '透亮果冻感与轻薄加固，干净耐看，适合第一次做美甲。', priceFen: 23900, durationMinutes: 75, coverUrl: 'https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=900&q=80', tags: ['裸色', '轻薄', '新手友好'], sort: 2, enabled: true, version: 1 },
  { _id: 'svc-brow-natural', id: 'svc-brow-natural', categoryId: 'brow', categoryName: '眉毛', name: '自然野生眉设计', description: '根据脸型、眉骨和毛流重新设计，保留自然感，日常无需反复描画。', priceFen: 19900, durationMinutes: 60, coverUrl: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=900&q=80', tags: ['脸型分析', '自然眉', '含修眉'], sort: 1, enabled: true, version: 1 },
  { _id: 'svc-tattoo-lip', id: 'svc-tattoo-lip', categoryId: 'tattoo', categoryName: '纹绣', name: '轻氧嘟嘟唇', description: '按唇色与唇形定制色乳，追求自然提气色，包含术前沟通与术后护理说明。', priceFen: 128000, durationMinutes: 150, coverUrl: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=80', tags: ['定制色乳', '术后指导', '需提前沟通'], sort: 1, enabled: true, version: 1 }
];

const nailServices = [
  service({ id: 'svc-nail-natural-color-30', categoryId: 'nail', categoryName: '美甲', name: '本甲纯色｜30元色板', priceFen: 3000, description: '本甲纯色，30元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 10 }),
  service({ id: 'svc-nail-natural-color-50', categoryId: 'nail', categoryName: '美甲', name: '本甲纯色｜50元色板', priceFen: 5000, description: '本甲纯色，50元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 11 }),
  service({ id: 'svc-nail-natural-color-80', categoryId: 'nail', categoryName: '美甲', name: '本甲纯色｜80元色板', priceFen: 8000, description: '本甲纯色，80元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 12 }),
  service({ id: 'svc-nail-natural-color-120', categoryId: 'nail', categoryName: '美甲', name: '本甲纯色｜120元色板', priceFen: 12000, description: '本甲纯色，120元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 13 }),
  service({ id: 'svc-nail-builder-solid', categoryId: 'nail', categoryName: '美甲', name: '本甲建构纯色', priceFen: 6000, description: '本甲建构纯色。', tags: ['本甲', '建构', '纯色'], sort: 14 }),
  service({ id: 'svc-nail-simple-style', categoryId: 'nail', categoryName: '美甲', name: '本甲简约款式', priceFen: 6000, description: '本甲简约款式。', tags: ['本甲', '简约款式'], sort: 15 }),
  service({ id: 'svc-nail-simple-builder-style', categoryId: 'nail', categoryName: '美甲', name: '本甲简约建构款式', priceFen: 8000, description: '本甲简约建构款式。', tags: ['本甲', '建构', '简约款式'], sort: 16 }),
  service({ id: 'svc-nail-builder-luxury-style', categoryId: 'nail', categoryName: '美甲', name: '本甲建构轻奢款式', priceFen: 12000, description: '本甲建构轻奢款式。', tags: ['本甲', '建构', '轻奢款式'], sort: 17 }),
  service({ id: 'svc-nail-tips-solid', categoryId: 'nail', categoryName: '美甲', name: '甲片纯色', priceFen: 7000, description: '甲片纯色。', tags: ['甲片', '纯色'], sort: 18 }),
  service({ id: 'svc-nail-tips-simple-style', categoryId: 'nail', categoryName: '美甲', name: '甲片简约款式', priceFen: 9000, description: '甲片简约款式。', tags: ['甲片', '简约款式'], sort: 19 }),
  service({ id: 'svc-nail-tips-luxury-style', categoryId: 'nail', categoryName: '美甲', name: '甲片轻奢款式', priceFen: 12000, description: '甲片轻奢款式。', tags: ['甲片', '轻奢款式'], sort: 20 }),
  service({ id: 'svc-nail-tips-luxury-custom', categoryId: 'nail', categoryName: '美甲', name: '甲片轻奢高定款', priceFen: 15000, description: '甲片轻奢高定款。', tags: ['甲片', '轻奢', '高定'], sort: 21 }),
  service({ id: 'svc-nail-tips-luxury-shallow', categoryId: 'nail', categoryName: '美甲', name: '轻奢甲片浅贴', priceFen: 28000, description: '轻奢甲片浅贴。', tags: ['甲片', '轻奢', '浅贴'], sort: 22 }),
  service({ id: 'svc-nail-addon-v-builder', categoryId: 'nail', categoryName: '美甲', name: 'V建构', priceFen: 1500, description: '预约主项目时可叠加。', tags: ['可叠加', '建构'], sort: 23, isAddon: true }),
  service({ id: 'svc-nail-addon-shaping-builder', categoryId: 'nail', categoryName: '美甲', name: '塑形建构', priceFen: 3000, description: '预约主项目时可叠加。', tags: ['可叠加', '建构'], sort: 24, isAddon: true }),
  service({ id: 'svc-nail-addon-luxury-shaping-builder', categoryId: 'nail', categoryName: '美甲', name: '轻奢塑形建构', priceFen: 6000, description: '预约主项目时可叠加。', tags: ['可叠加', '建构', '轻奢'], sort: 25, isAddon: true }),
  service({ id: 'svc-nail-removal-natural', categoryId: 'nail', categoryName: '美甲', name: '卸本甲', priceFen: 1000, description: '本甲卸除服务。', tags: ['卸除', '本甲'], sort: 26 }),
  service({ id: 'svc-nail-removal-thick-builder', categoryId: 'nail', categoryName: '美甲', name: '卸超厚本甲建构', priceFen: 2000, description: '超厚本甲建构卸除服务。', tags: ['卸除', '本甲', '建构'], sort: 27 }),
  service({ id: 'svc-nail-removal-tips', categoryId: 'nail', categoryName: '美甲', name: '卸甲片', priceFen: 2000, description: '甲片卸除服务。', tags: ['卸除', '甲片'], sort: 28 })
];

const footNailServices = [
  service({ id: 'svc-foot-nail-natural-color-40', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲纯色｜40元色板', priceFen: 4000, description: '脚部本甲纯色，40元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 10 }),
  service({ id: 'svc-foot-nail-natural-color-60', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲纯色｜60元色板', priceFen: 6000, description: '脚部本甲纯色，60元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 11 }),
  service({ id: 'svc-foot-nail-natural-color-80', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲纯色｜80元色板', priceFen: 8000, description: '脚部本甲纯色，80元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 12 }),
  service({ id: 'svc-foot-nail-natural-color-120', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲纯色｜120元色板', priceFen: 12000, description: '脚部本甲纯色，120元色板档位。', tags: ['本甲', '纯色', '色板不同'], sort: 13 }),
  service({ id: 'svc-foot-nail-simple-style', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲简约款式', priceFen: 6000, description: '脚部本甲简约款式。', tags: ['本甲', '简约款式'], sort: 14 }),
  service({ id: 'svc-foot-nail-simple-builder-style', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲简约建构款式', priceFen: 8000, description: '脚部本甲简约建构款式。', tags: ['本甲', '建构', '简约款式'], sort: 15 }),
  service({ id: 'svc-foot-nail-builder-luxury-style', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲建构轻奢款式', priceFen: 12000, description: '脚部本甲建构轻奢款式。', tags: ['本甲', '建构', '轻奢款式'], sort: 16 }),
  service({ id: 'svc-foot-nail-tips-40', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '10根脚甲片｜40元', priceFen: 4000, description: '10根脚甲片，40元档位。', tags: ['脚甲片', '10根'], sort: 17 }),
  service({ id: 'svc-foot-nail-tips-80', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '10根脚甲片｜80元', priceFen: 8000, description: '10根脚甲片，80元档位。', tags: ['脚甲片', '10根'], sort: 18 }),
  service({ id: 'svc-foot-nail-addon-single-tip', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '单独加1个脚甲片', priceFen: 500, description: '预约脚部美甲主项目时可叠加。', tags: ['可叠加', '脚甲片'], sort: 19, isAddon: true })
];

const lashServices = [
  service({ id: 'svc-lash-upper-natural', categoryId: 'lash', categoryName: '睫毛', name: '上睫毛｜自然款', priceFen: 8000, description: '上睫毛自然款。', tags: ['上睫毛', '自然款'], sort: 10 }),
  service({ id: 'svc-lash-upper-arc', categoryId: 'lash', categoryName: '睫毛', name: '上睫毛｜130弧系款（妈生款、婴儿弯等，送下睫毛）', priceFen: 13000, description: '130弧系款，包含妈生款、婴儿弯等，赠送下睫毛。', tags: ['上睫毛', '弧系款', '送下睫毛'], sort: 11 }),
  service({ id: 'svc-lash-upper-hot', categoryId: 'lash', categoryName: '睫毛', name: '上睫毛｜150小地瓜热门款（网感效果等，送下睫毛）', priceFen: 15000, description: '150小地瓜热门款，包含网感效果等，赠送下睫毛。', tags: ['上睫毛', '热门款', '送下睫毛'], sort: 12 }),
  service({ id: 'svc-lash-upper-chinese', categoryId: 'lash', categoryName: '睫毛', name: '上睫毛｜180中式嫁接手法（送下睫毛）', priceFen: 18000, description: '180中式嫁接手法，赠送下睫毛。', tags: ['上睫毛', '中式嫁接', '送下睫毛'], sort: 13 }),
  service({ id: 'svc-lash-upper-new-chinese-custom', categoryId: 'lash', categoryName: '睫毛', name: '上睫毛｜280新中式定制款（送下睫毛）', priceFen: 28000, description: '280新中式定制款，赠送下睫毛。', tags: ['上睫毛', '新中式', '定制', '送下睫毛'], sort: 14 }),
  service({ id: 'svc-lash-lower-50', categoryId: 'lash', categoryName: '睫毛', name: '下睫毛｜50元', priceFen: 5000, description: '下睫毛50元档位。', tags: ['下睫毛'], sort: 15 }),
  service({ id: 'svc-lash-lower-80', categoryId: 'lash', categoryName: '睫毛', name: '下睫毛｜80元', priceFen: 8000, description: '下睫毛80元档位。', tags: ['下睫毛'], sort: 16 }),
  service({ id: 'svc-lash-lower-120', categoryId: 'lash', categoryName: '睫毛', name: '下睫毛｜120元', priceFen: 12000, description: '下睫毛120元档位。', tags: ['下睫毛'], sort: 17 }),
  service({ id: 'svc-lash-lower-natural-standalone', categoryId: 'lash', categoryName: '睫毛', name: '单独接下睫毛｜超级自然款', priceFen: 3000, description: '单独接下睫毛超级自然款。', tags: ['下睫毛', '单独接'], sort: 18 }),
  service({ id: 'svc-lash-removal', categoryId: 'lash', categoryName: '睫毛', name: '卸睫毛', priceFen: 2000, description: '睫毛卸除服务。', tags: ['卸除'], sort: 19 })
];

const browServices = [
  service({ id: 'svc-brow-trim', categoryId: 'brow', categoryName: '眉毛', name: '修眉', priceFen: 1000, description: '基础修眉服务。', tags: ['修眉'], sort: 10 }),
  service({ id: 'svc-brow-shape-design', categoryId: 'brow', categoryName: '眉毛', name: '单独设计眉形', priceFen: 5000, description: '根据脸型与眉骨单独设计眉形。', tags: ['眉形设计'], sort: 11 }),
  service({ id: 'svc-brow-natural-new-customer', categoryId: 'brow', categoryName: '眉毛', name: '新客专享｜自然眉', priceFen: 38000, description: '新客专享自然眉。', tags: ['新客专享', '自然眉'], sort: 12 }),
  service({ id: 'svc-brow-bare-face-design', categoryId: 'brow', categoryName: '眉毛', name: '素颜眉1V1专属设计', priceFen: 58000, description: '素颜眉1V1专属设计。', tags: ['素颜眉', '1V1设计'], sort: 13 }),
  service({ id: 'svc-brow-bone-mist', categoryId: 'brow', categoryName: '眉毛', name: '骨相定妆丝雾眉1V1专属设计', priceFen: 128000, description: '骨相定妆丝雾眉1V1专属设计。', tags: ['丝雾眉', '1V1设计'], sort: 14 }),
  service({ id: 'svc-brow-eco-wild', categoryId: 'brow', categoryName: '眉毛', name: '生态素颜野生眉1V1专属设计', priceFen: 168000, description: '生态素颜野生眉1V1专属设计。', tags: ['野生眉', '1V1设计'], sort: 15 }),
  service({ id: 'svc-brow-natural-eyeliner', categoryId: 'brow', categoryName: '眉毛', name: '自然款美瞳线', priceFen: 38000, description: '自然款美瞳线。', tags: ['美瞳线', '自然款'], sort: 16 }),
  service({ id: 'svc-brow-masheng-eyeliner', categoryId: 'brow', categoryName: '眉毛', name: '妈生款美瞳线', priceFen: 88000, description: '妈生款美瞳线。', tags: ['美瞳线', '妈生款'], sort: 17 }),
  service({ id: 'svc-brow-korean-eyeliner', categoryId: 'brow', categoryName: '眉毛', name: '高定款韩系美瞳线', priceFen: 128000, description: '高定款韩系美瞳线。', tags: ['美瞳线', '高定', '韩系'], sort: 18 })
];

const services = [...legacyServices, ...nailServices, ...footNailServices, ...lashServices, ...browServices];

const technicianIdByCategory = {
  nail: 'tech-lin',
  'foot-nail': 'tech-lin',
  brow: 'tech-zhou',
  lash: 'tech-he',
  tattoo: 'tech-he'
};

const legacyWorkIds = {
  'svc-nail-french': 'work-001',
  'svc-nail-jelly': 'work-002',
  'svc-brow-natural': 'work-003',
  'svc-tattoo-lip': 'work-004'
};

const works = services
  .filter((item) => !item.isAddon)
  .map((item, index) => ({
    _id: legacyWorkIds[item.id] || `work-${item.id}`,
    id: legacyWorkIds[item.id] || `work-${item.id}`,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    title: item.name,
    description: item.description,
    imageUrl: item.coverUrl,
    serviceId: item.id,
    technicianId: technicianIdByCategory[item.categoryId] || 'tech-lin',
    published: true,
    sort: index + 1
  }));

const serviceIdsByCategory = (categoryId) => services.filter((item) => item.categoryId === categoryId).map((item) => item.id);

module.exports = {
  PLACEHOLDER_IMAGE,
  categories,
  services,
  works,
  serviceIdsByCategory
};
