const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/format');
const { storeParts } = require('../../utils/store-time');
const { createInviteShare } = require('../../utils/share');

function inviteTimeLabel(timestamp) {
  return timestamp ? `${storeParts(timestamp).year}年${formatDateTime(timestamp)}` : '时间未记录';
}

Page({
  data: { loading: true, account: {}, ledger: [], profile:{}, inviteRewardPoints:10, inviteDraft:'', bindingInvite:false,
    showInviteRecords: false, inviteRecords: [], inviteRecordsLoading: false, inviteRecordsError: '', inviteRecordsCursor: null,
    inviteRecordsFailedCursor: 0 },

  onLoad(options) {
    if(options&&options.invite)this.setData({inviteDraft:String(options.invite).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16)});
  },

  onShow() {
    this.loadPoints();
    if (this.data.showInviteRecords) this.loadInviteRecords();
  },

  onShareAppMessage() {
    if (this.data.profile.inviteCode) return createInviteShare(this.data.profile);
    return {
      ...createInviteShare(),
      promise: api.getProfile().then(profile => createInviteShare(profile)).catch(() => createInviteShare())
    };
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
      const reward = settings && settings.points && settings.points.inviteRewardPoints;
      this.setData({ loading: false, account: result.account || {}, ledger, profile, inviteRewardPoints: reward === undefined ? 10 : Number(reward) });
    } catch (error) {
      this.setData({ loading: false, account: {}, ledger: [] });
      wx.showToast({ title: error.message || '积分加载失败', icon: 'none' });
    }
  },

  toggleInviteRecords() {
    const showInviteRecords = !this.data.showInviteRecords;
    this.setData({ showInviteRecords });
    if (showInviteRecords) this.loadInviteRecords();
  },

  async loadInviteRecords(event) {
    if (this.data.inviteRecordsLoading) return;
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
    const cursor = dataset.retry ? this.data.inviteRecordsFailedCursor : dataset.more ? this.data.inviteRecordsCursor : 0;
    const append = cursor > 0;
    if (cursor === null) return;
    this.setData({ inviteRecordsLoading: true, inviteRecordsError: '', inviteRecordsFailedCursor: cursor });
    try {
      const result = await api.listInviteRecords(cursor);
      const records = (result.records || []).map(item => ({
        ...item, boundTimeLabel: inviteTimeLabel(item.boundAt),
        grantedTimeLabel: item.grantedAt ? inviteTimeLabel(item.grantedAt) : '',
        rewardLabel: item.status === 'GRANTED' ? `+${item.rewardPoints} 积分` : `${item.rewardPoints} 积分`
      }));
      this.setData({ inviteRecords: append ? this.data.inviteRecords.concat(records) : records,
        inviteRecordsCursor: result.nextCursor === undefined ? null : result.nextCursor });
    } catch (error) {
      this.setData({ inviteRecordsError: error.message || '邀请记录加载失败' });
    } finally {
      this.setData({ inviteRecordsLoading: false });
    }
  },

  inputInviteCode(event){this.setData({inviteDraft:String(event.detail.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16)});},
  copyInviteCode(){if(this.data.profile.inviteCode)wx.setClipboardData({data:this.data.profile.inviteCode});},
  async bindInvite(){if(this.data.bindingInvite||!this.data.inviteDraft)return;this.setData({bindingInvite:true});try{const result=await api.bindInviteCode(this.data.inviteDraft);this.setData({profile:result.profile,inviteDraft:'','account.available':Number(result.profile.points||0)});wx.showToast({title:'绑定成功',icon:'success'});this.loadPoints();}catch(error){wx.showToast({title:error.message||'邀请码绑定失败',icon:'none'});}finally{this.setData({bindingInvite:false});}}
});
