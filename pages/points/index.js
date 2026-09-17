const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/format');

Page({
  data: { loading: true, account: {}, ledger: [], profile:{}, inviteRewardPoints:10, inviteDraft:'', bindingInvite:false },

  onLoad(options) {
    if(options&&options.invite)this.setData({inviteDraft:String(options.invite).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16)});
    this.loadPoints();
  },

  async loadPoints() {
    try {
      const [result,profile,settings] = await Promise.all([api.listPoints(),api.getProfile(),api.getSettings().catch(()=>({points:{}}))]);
      const ledger = (result.ledger || []).map((item) => ({
        ...item,
        amountLabel: `${item.amount > 0 ? '+' : ''}${item.amount}`,
        timeLabel: formatDateTime(item.createdAt),
        positive: item.amount > 0
      }));
      this.setData({ loading: false, account: result.account || {}, ledger, profile, inviteRewardPoints:Number(settings&&settings.points&&settings.points.inviteRewardPoints||10) });
    } catch (error) {
      this.setData({ loading: false, account: {}, ledger: [] });
      wx.showToast({ title: error.message || '积分加载失败', icon: 'none' });
    }
  },

  inputInviteCode(event){this.setData({inviteDraft:String(event.detail.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16)});},
  copyInviteCode(){if(this.data.profile.inviteCode)wx.setClipboardData({data:this.data.profile.inviteCode});},
  async bindInvite(){if(this.data.bindingInvite||!this.data.inviteDraft)return;this.setData({bindingInvite:true});try{const result=await api.bindInviteCode(this.data.inviteDraft);this.setData({profile:result.profile,inviteDraft:'','account.available':result.profile.points||this.data.account.available});wx.showToast({title:'绑定成功',icon:'success'});this.loadPoints();}catch(error){wx.showToast({title:error.message||'邀请码绑定失败',icon:'none'});}finally{this.setData({bindingInvite:false});}}
});
