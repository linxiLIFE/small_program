const assert=require('assert');const vm=require('vm');const fs=require('fs');const path=require('path');
const constants=require('../cloudfunctions/api/lib/constants');const time=require('../cloudfunctions/api/lib/time');
const errors=require('../cloudfunctions/api/lib/errors');
function moduleOf(name,stubs={}) { const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/api/lib',name+'.js'),'utf8'),{module:m,exports:m.exports,require:key=>stubs[key]||({'./constants':constants,'./time':time,'./errors':errors,'./auth':{},crypto:require('crypto')}[key]),Date,console,Buffer});return m.exports;}
(async()=>{
 const at=value=>Date.parse(value+'T12:00:00+08:00');
 const old={id:'old',userId:'repeat',status:'COMPLETED',createdAt:at('2026-07-01'),paidAt:at('2026-07-01'),completedAt:at('2026-07-01'),paymentStatus:'SUCCESS',paidFen:100,workSnapshot:{id:'a',title:'A'}};
 const orders=[old,{...old,id:'repeat',createdAt:at('2026-08-01'),paidAt:at('2026-09-09'),completedAt:at('2026-09-10')},{...old,id:'new',userId:'new',createdAt:at('2026-09-09'),paidAt:at('2026-09-09'),completedAt:at('2026-09-09')},{...old,id:'refunded-completed',userId:'refunded',status:'REFUNDED',refundStatus:'SUCCESS',createdAt:at('2026-08-01'),paidAt:at('2026-08-01'),completedAt:at('2026-09-10')},{...old,id:'pending',userId:'pending',status:'PENDING_PAYMENT',paymentStatus:'NOTPAY',createdAt:at('2026-09-10')},{...old,id:'cancelled',status:'CANCELLED_BY_USER',refundStatus:'SUCCESS'}];
 const analytics=moduleOf('analytics',{'./db':{find:async()=>orders}});
 assert.equal(analytics.validBooking({...old,refundStatus:'SUCCESS',refundedFen:50}),true);
 const result=analytics.analyze(orders,[{status:'SUCCESS',createdAt:at('2026-08-01'),successAt:at('2026-09-10'),amountFen:50}],7,at('2026-09-10'));
 assert.equal(result.metrics.paidFen,200);assert.equal(result.metrics.refundFen,50);assert.equal(result.metrics.newCustomerCount,2);assert.equal(result.metrics.returningCustomerCount,1);assert.equal(result.metrics.completedCount,3);assert.equal(result.trend.length,7);assert.equal((await analytics.bookingCounts()).a,3);
 const settings=moduleOf('settings-validation');const clone=()=>JSON.parse(JSON.stringify(constants.DEFAULT_SETTINGS));
 const invalid=clone();invalid.booking.slotStepMinutes=0;assert.throws(()=>settings.validateSettings(invalid),/预约/);
 const nonQuarter=clone();nonQuarter.booking.slotStepMinutes=30;assert.throws(()=>settings.validateSettings(nonQuarter),/固定为 15 分钟/);
 const banner=clone();banner.home={banners:[{id:'b',imageUrl:'https://expired.example/a',imageFileID:'cloud://file/a'}]};const saved=settings.validateSettings(banner);assert.equal(saved.home.banners[0].imageUrl,'cloud://file/a');assert(!saved.home.banners[0].imageFileID);
 const partial=clone();partial.store.latitude=45;assert.throws(()=>settings.validateSettings(partial),/同时/);
 const media=moduleOf('media',{'./db':{cloud:{getTempFileURL:async()=>{throw new Error('storage timeout');}}}});
 const resolved=await media.resolveImages({name:'still loaded',imageUrl:'cloud://file/a'});assert.equal(resolved.name,'still loaded');assert.equal(resolved.imageFileID,'cloud://file/a');assert.equal(resolved.imageUrl,'');
 // A native tab icon must contain transparent pixels and visible strokes, not a solid square.
 const zlib=require('zlib');for(const tab of require('../app.json').tabBar.list)for(const key of ['iconPath','selectedIconPath']){const data=fs.readFileSync(path.join(__dirname,'..',tab[key]));assert(data.length<40960);assert.equal(data.readUInt32BE(16),81);let offset=8,chunks=[];while(offset<data.length){let len=data.readUInt32BE(offset);if(data.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(data.subarray(offset+8,offset+8+len));offset+=len+12;}const raw=zlib.inflateSync(Buffer.concat(chunks));assert(new Set(raw).size>8);}
 console.log('refinements passed: paid/completed/refund dates, new/returning customers, popularity exclusions, settings validation, banner file IDs, storage failure isolation, native icons');
})().catch(e=>{console.error(e);process.exitCode=1;});
