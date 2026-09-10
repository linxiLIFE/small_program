const { formatDateLabel } = require('./format');

const categories = [
  { id: 'nail', name: '美甲', subtitle: '指尖的小心思', icon: '✦', color: '#f7d9d3' },
  { id: 'brow', name: '美眉', subtitle: '自然有神', icon: '⌁', color: '#e9dccd' },
  { id: 'tattoo', name: '纹绣', subtitle: '耐看的精致', icon: '◌', color: '#ead5db' }
];

const services = [
  {
    id: 'svc-nail-french', categoryId: 'nail', categoryName: '美甲', name: '奶油法式美甲',
    description: '低饱和奶油色打底，搭配细线法式与手绘小花，适合日常通勤。',
    priceFen: 29900, durationMinutes: 90, bufferMinutes: 15,
    coverUrl: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=80',
    tags: ['显白', '法式', '含基础护理']
  },
  {
    id: 'svc-nail-jelly', categoryId: 'nail', categoryName: '美甲', name: '玫瑰果冻裸色',
    description: '透亮果冻感与轻薄加固，干净耐看，适合第一次做美甲。',
    priceFen: 23900, durationMinutes: 75, bufferMinutes: 15,
    coverUrl: 'https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=900&q=80',
    tags: ['裸色', '轻薄', '新手友好']
  },
  {
    id: 'svc-brow-natural', categoryId: 'brow', categoryName: '美眉', name: '自然野生眉设计',
    description: '根据脸型、眉骨和毛流重新设计，保留自然感，日常无需反复描画。',
    priceFen: 19900, durationMinutes: 60, bufferMinutes: 15,
    coverUrl: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=900&q=80',
    tags: ['脸型分析', '自然眉', '含修眉']
  },
  {
    id: 'svc-tattoo-lip', categoryId: 'tattoo', categoryName: '纹绣', name: '轻氧嘟嘟唇',
    description: '按唇色与唇形定制色乳，追求自然提气色，包含术前沟通与术后护理说明。',
    priceFen: 128000, durationMinutes: 150, bufferMinutes: 30,
    coverUrl: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=80',
    tags: ['定制色乳', '术后指导', '需提前沟通']
  }
];

const technicians = [
  {
    id: 'tech-lin', name: '林老师', title: '主理人 · 美甲师',
    bio: '擅长低饱和、法式与手绘细节，喜欢把每一双手的气质做出来。',
    skills: ['svc-nail-french', 'svc-nail-jelly'],
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80'
  },
  {
    id: 'tech-zhou', name: '周老师', title: '高级眉形设计师',
    bio: '以自然毛流和面部比例为优先，擅长通勤眉与原生感眉形设计。',
    skills: ['svc-brow-natural'],
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=80'
  },
  {
    id: 'tech-he', name: '何老师', title: '纹绣师',
    bio: '专注自然纹绣与术后恢复沟通，先充分沟通，再决定最适合你的方案。',
    skills: ['svc-tattoo-lip'],
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&q=80'
  }
];

const works = [
  {
    id: 'work-001', categoryId: 'nail', categoryName: '美甲', title: '春日奶油法式',
    description: '奶油白、柔雾粉和一笔小花，温柔但不甜腻。',
    imageUrl: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1200&q=85',
    serviceId: 'svc-nail-french', technicianId: 'tech-lin', published: true
  },
  {
    id: 'work-002', categoryId: 'nail', categoryName: '美甲', title: '玫瑰果冻裸色',
    description: '适合想要干净指尖、又不想太高调的你。',
    imageUrl: 'https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=1200&q=85',
    serviceId: 'svc-nail-jelly', technicianId: 'tech-lin', published: true
  },
  {
    id: 'work-003', categoryId: 'brow', categoryName: '美眉', title: '原生感通勤眉',
    description: '保留毛流起伏，眉尾收得更轻，素颜也有精神。',
    imageUrl: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=1200&q=85',
    serviceId: 'svc-brow-natural', technicianId: 'tech-zhou', published: true
  },
  {
    id: 'work-004', categoryId: 'tattoo', categoryName: '纹绣', title: '轻氧嘟嘟唇',
    description: '以自然提气色为目标，术前会充分确认色调与边界。',
    imageUrl: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=1200&q=85',
    serviceId: 'svc-tattoo-lip', technicianId: 'tech-he', published: true
  }
];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDates() {
  const now = new Date();
  return Array.from({ length: 14 }, (_, index) => {
    const date = addDays(now, index);
    const value = toDateString(date);
    return { value, label: index === 0 ? '今天' : index === 1 ? '明天' : formatDateLabel(value) };
  });
}

function getSlots(dateString) {
  const today = new Date();
  const slots = [];
  for (let hour = 10; hour < 20; hour += 1) {
    for (const minute of [0, 30]) {
      if (dateString === toDateString(today) && hour * 60 + minute < today.getHours() * 60 + today.getMinutes() + 60) continue;
      slots.push({
        id: `${dateString}-${hour}-${minute}`,
        label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        startAt: new Date(`${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).getTime(),
        available: true
      });
    }
  }
  return slots;
}

const profile = {
  id: 'demo-user', nickname: '拾光访客', avatarUrl: '', phone: '13800138000', phoneMasked: '138****8000',
  points: 680, role: 'CUSTOMER'
};

const orders = [
  {
    id: 'demo-order-001', status: 'RESERVED', statusLabel: '待到店',
    serviceName: '奶油法式美甲', technicianName: '林老师', date: getDates()[1].value,
    startAt: getSlots(getDates()[1].value)[2].startAt, durationMinutes: 90,
    totalFen: 29900, pointsUsed: 0, discountFen: 0, paidFen: 29900, refundStatus: ''
  }
];

const settings = {
  storeName: '拾光美研', address: '哈尔滨市南岗区底下商店美甲店', phone: '400-800-2026',
  notice: '每次预约只安排一位顾客和一位技师，请提前 5 分钟到店。',
  pointUnit: 20, pointDiscountFen: 100, pointMaxPercent: 10,
  minAdvanceMinutes: 60, openDays: 14
};

module.exports = { categories, services, technicians, works, getDates, getSlots, profile, orders, settings };
