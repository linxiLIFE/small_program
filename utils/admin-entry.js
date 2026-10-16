// The gesture only hides navigation. The admin keeps its own login and role checks.
function resetAdminEntry() {
  this.adminAvatarTaps = 0;
  this.adminAvatarLastTap = 0;
  this.adminNavigating = false;
}

function handleAdminAvatarTap() {
  if (this.adminNavigating) return;
  const now = Date.now();
  const count = now - (this.adminAvatarLastTap || 0) <= 1000 ? (this.adminAvatarTaps || 0) + 1 : 1;
  this.adminAvatarLastTap = now;
  this.adminAvatarTaps = count;
  if (count < 5) return;
  this.adminAvatarTaps = 0;
  this.adminNavigating = true;
  wx.navigateTo({
    url: '/pages/admin/index',
    fail: () => {
      resetAdminEntry.call(this);
      wx.showToast({ title: '后台暂时无法打开，请重试', icon: 'none' });
    }
  });
}

module.exports = { resetAdminEntry, handleAdminAvatarTap };
