const { assert } = require('./errors');
function validateSettings(next) {
  const number = (group, key, min, max) => {
    const value = Number(next[group][key]);
    assert(Number.isInteger(value) && value>=min && value<=max, 'INVALID_SETTINGS', `请检查${group==='booking'?'预约':'积分'}设置：数值需在 ${min} 到 ${max} 之间`);
    next[group][key]=value;
  };
  number('booking','openDays',1,14); number('booking','minAdvanceMinutes',1,10080);
  number('booking','slotStepMinutes',1,120); assert(next.booking.slotStepMinutes===15,'INVALID_SETTINGS','预约时间点固定为 15 分钟'); number('booking','unpaidHoldMinutes',1,60); number('booking','noShowGraceMinutes',1,1440);
  number('points','pointRateFen',1,100000); number('points','unit',1,100000); number('points','discountFen',1,100000); number('points','maxPercent',0,100);
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
