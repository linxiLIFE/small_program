const { assert } = require('./errors');
function validateSettings(next) {
  const number = (group, key, min, max) => {
    const value = Number(next[group][key]);
    assert(Number.isInteger(value) && value>=min && value<=max, 'INVALID_SETTINGS', `请检查${group==='booking'?'预约':'积分'}设置：数值需在 ${min} 到 ${max} 之间`);
    next[group][key]=value;
  };
  number('booking','openDays',1,14); number('booking','minAdvanceMinutes',1,10080);
  number('booking','slotStepMinutes',1,120); assert(next.booking.slotStepMinutes===15,'INVALID_SETTINGS','预约时间点固定为 15 分钟'); number('booking','unpaidHoldMinutes',1,60); number('booking','refundCutoffMinutes',0,10080); number('booking','noShowGraceMinutes',1,1440); number('booking','noShowPenaltyFen',0,1000000);
  next.booking.noShowPolicy='AUTO_PARTIAL_REFUND';
  number('points','pointRateFen',1,100000); number('points','unit',1,100000); number('points','discountFen',1,100000); number('points','maxPercent',0,100); number('points','inviteRewardPoints',0,100000);
  next.notifications=next.notifications||{};
  next.notifications.enabled=next.notifications.enabled!==false;
  const arrivalLead=Number(next.notifications.arrivalLeadMinutes||120);
  assert(Number.isInteger(arrivalLead)&&arrivalLead>=1&&arrivalLead<=10080,'INVALID_SETTINGS','到店提醒提前时间不正确');
  next.notifications.arrivalLeadMinutes=arrivalLead;
  const templateDefaults=require('./constants').DEFAULT_SETTINGS.notifications.templates;
  const templates={};
  for(const [event,defaults] of Object.entries(templateDefaults)){
    const source=next.notifications.templates&&next.notifications.templates[event]||{};
    const templateId=String(source.templateId||'').trim();
    assert(!templateId||/^[A-Za-z0-9_-]{10,100}$/.test(templateId),'INVALID_SETTINGS','订阅消息模板 ID 不正确');
    const record={...defaults,...source,templateId};
    for(const key of Object.keys(defaults).filter(item=>item.endsWith('Key'))){
      record[key]=String(record[key]||'').trim();
      assert(/^(thing|time|date|amount|phrase|number|character_string)\d+$/.test(record[key]),'INVALID_SETTINGS','订阅消息字段名不正确');
    }
    record.page=String(record.page||defaults.page).trim().slice(0,128);
    templates[event]=record;
  }
  next.notifications.templates=templates;
  for(const key of ['storeName','address','phone','notice'])next.store[key]=String(next.store[key]||'').trim().slice(0,key==='notice'?1000:200);
  assert(next.store.storeName,'INVALID_SETTINGS','请填写门店名称');
  const {latitude,longitude}=next.store;
  const hasLat=latitude!==undefined&&latitude!==null&&latitude!==''; const hasLng=longitude!==undefined&&longitude!==null&&longitude!=='';
  assert(hasLat===hasLng,'INVALID_LOCATION','请同时填写地图经度和纬度');
  if(hasLat){assert(Number.isFinite(Number(latitude))&&Number(latitude)>=-90&&Number(latitude)<=90&&Number.isFinite(Number(longitude))&&Number(longitude)>=-180&&Number(longitude)<=180,'INVALID_LOCATION','地图坐标不正确');next.store.latitude=Number(latitude);next.store.longitude=Number(longitude);}
  else {next.store.latitude=null;next.store.longitude=null;}
  const banners=next.home?.banners||[];
  assert(Array.isArray(banners)&&banners.length<=20,'INVALID_BANNERS','最多添加 20 张宣传图片');
  next.home={banners:banners.map((item,index)=>{
    const imageUrl=String(item.imageFileID||item.imageUrl||'');
    assert(/^cloud:\/\//.test(imageUrl)||/^https:\/\//.test(imageUrl),'INVALID_IMAGE','请上传宣传图片');
    return {id:String(item.id||`banner-${index}`),imageUrl};
  })};
  return next;
}
module.exports={validateSettings};
