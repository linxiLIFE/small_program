const MAX_ITEMS = 10;
function storageKey(userId) {
  if (!userId) throw new Error('请先登录后使用购物车');
  return `booking-cart-v1:${userId}`;
}
function list(userId) {
  const value = wx.getStorageSync(storageKey(userId));
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS) : [];
}
function save(userId, items) {
  wx.setStorageSync(storageKey(userId), items);
  if (typeof wx.setTabBarBadge === 'function') {
    if (items.length) wx.setTabBarBadge({ index: 3, text: String(items.length) });
    else wx.removeTabBarBadge({ index: 3 });
  }
  return items;
}
function add(userId, item) {
  const items = list(userId);
  const existing = items.findIndex(x => x.id === item.id || x.payload.workId === item.payload.workId && x.payload.technicianId === item.payload.technicianId && x.payload.startAt === item.payload.startAt);
  if (existing >= 0) items[existing] = { ...item, id: items[existing].id };
  else {
    if (items.length >= MAX_ITEMS) throw new Error(`购物车最多保存 ${MAX_ITEMS} 项预约`);
    items.push({ ...item, id: item.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` });
  }
  return save(userId, items);
}
function remove(userId, ids) { return save(userId, list(userId).filter(x => !ids.includes(x.id))); }
module.exports = { list, save, add, remove, MAX_ITEMS };
