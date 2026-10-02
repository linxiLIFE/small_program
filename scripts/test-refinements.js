const assert=require('assert');const vm=require('vm');const fs=require('fs');const path=require('path');
const constants=require('../cloudfunctions/api/lib/constants');const time=require('../cloudfunctions/api/lib/time');
const errors=require('../cloudfunctions/api/lib/errors');
function moduleOf(name,stubs={}) { const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/api/lib',name+'.js'),'utf8'),{module:m,exports:m.exports,require:key=>stubs[key]||({'./constants':constants,'./time':time,'./errors':errors,'./auth':{},crypto:require('crypto')}[key]),Date:stubs.__clock||Date,console,Buffer});return m.exports;}
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
 const qrSettings=clone();qrSettings.store.wechatQrUrl='https://expired.example/qr';qrSettings.store.wechatQrFileID='cloud://file/wechat-qr';qrSettings.store.wechatQrRemoteUrl='https://old.example/qr';
 const savedQr=settings.validateSettings(qrSettings);assert.equal(savedQr.store.wechatQrUrl,'cloud://file/wechat-qr');assert(!savedQr.store.wechatQrFileID);assert(!savedQr.store.wechatQrRemoteUrl);
 const badQr=clone();badQr.store.wechatQrUrl='javascript:alert(1)';assert.throws(()=>settings.validateSettings(badQr),/微信二维码/);
 assert.equal(settings.validateSettings(clone()).store.wechatQrUrl,'');
 const partial=clone();partial.store.latitude=45;assert.throws(()=>settings.validateSettings(partial),/同时/);
 const media=moduleOf('media',{'./db':{cloud:{getTempFileURL:async()=>{throw new Error('storage timeout');}}}});
 const resolved=await media.resolveImages({name:'still loaded',imageUrl:'cloud://file/a'});assert.equal(resolved.name,'still loaded');assert.equal(resolved.imageFileID,'cloud://file/a');assert.equal(resolved.imageUrl,'');
 const urlCalls=[];
 const liveMedia=moduleOf('media',{'./db':{cloud:{getTempFileURL:async({fileList})=>{urlCalls.push(fileList);return {fileList:fileList.map(file=>({fileID:typeof file==='string'?file:file.fileID,tempFileURL:'https://bucket.cos.ap-shanghai.myqcloud.com/a?fresh=1',status:0,maxAge:3600}))};}}}});
 const refreshed=await liveMedia.resolveImages({banners:[{imageFileID:'cloud://file/banner',imageUrl:'https://expired.example/banner'}]});
 assert.equal(refreshed.banners[0].imageFileID,'cloud://file/banner');
 assert.match(refreshed.banners[0].imageUrl,/cos\.ap-shanghai/);
 assert.equal(urlCalls[0][0].urlType,'COS_URL');
 await liveMedia.resolveImages({imageUrl:'cloud://file/banner'});assert.equal(urlCalls.length,1);
 const qrImage=await liveMedia.resolveImages({store:{wechatQrUrl:'cloud://file/wechat-qr'}});
 assert.equal(qrImage.store.wechatQrFileID,'cloud://file/wechat-qr');assert.match(qrImage.store.wechatQrUrl,/cos\.ap-shanghai/);
 const qrPage={};const previews=[];const recoveredQr=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/index/index.js'),'utf8'),{Page:page=>Object.assign(qrPage,page),require:key=>key.endsWith('image-cache')?{recoverImage:async id=>{recoveredQr.push(id);return {path:'wxfile://qr-recovered'};}}:{},wx:{previewImage:args=>previews.push(args)},console});
 qrPage.setData=function(patch){for(const [key,value] of Object.entries(patch)){if(key==='store.wechatQrUrl')this.data.store.wechatQrUrl=value;else this.data[key]=value;}};
 qrPage.contactForStyles();assert.equal(qrPage.data.showWechatQr,true);qrPage.previewWechatQr();assert.equal(previews.length,0);qrPage.closeWechatQr();assert.equal(qrPage.data.showWechatQr,false);
 qrPage.data.store={wechatQrUrl:'https://fresh.example/qr',wechatQrFileID:'cloud://file/wechat-qr'};
 qrPage.contactForStyles();qrPage.previewWechatQr();assert.equal(previews[0].current,'https://fresh.example/qr');
 await qrPage.handleWechatQrError();assert.equal(qrPage.data.store.wechatQrUrl,'wxfile://qr-recovered');assert.equal(recoveredQr.length,1);
 await qrPage.handleWechatQrError();assert.equal(qrPage.data.wechatQrError,true);qrPage.previewWechatQr();assert.equal(previews.length,1);
 // A requested one-hour URL can have an actual two-minute COS signature.
 let clock=Date.now();let signedCalls=0;
 class ClockDate extends Date { static now(){return clock;} }
 const signedMedia=moduleOf('media',{'./db':{cloud:{getTempFileURL:async({fileList})=>{signedCalls++;return {fileList:[{fileID:fileList[0].fileID,tempFileURL:`https://bucket.cos.ap-shanghai.myqcloud.com/a?q-sign-time=${Math.floor(clock/1000)};${Math.floor(clock/1000)+120}`,maxAge:3600}]};}}},__clock:ClockDate});
 await signedMedia.resolveImages({imageUrl:'cloud://file/short'});
 clock+=80000;await signedMedia.resolveImages({imageUrl:'cloud://file/short'});assert.equal(signedCalls,1);
 clock+=15000;await signedMedia.resolveImages({imageUrl:'cloud://file/short'});assert.equal(signedCalls,2,'refresh before actual COS signature expires');
 const fallbackCalls=[];
 const fallbackMedia=moduleOf('media',{'./db':{cloud:{getTempFileURL:async({fileList})=>{fallbackCalls.push(fileList);if(typeof fileList[0]==='object')throw new Error('COS unavailable');return {fileList:[{fileID:fileList[0],tempFileURL:'https://cdn.example/a',status:0}]};}}}});
 assert.equal((await fallbackMedia.resolveImages({imageUrl:'cloud://file/fallback'})).imageUrl,'https://cdn.example/a');
 assert.equal(fallbackCalls.length,2);
 const cacheModule={exports:{}};let finishDownload;let nativeDownloads=0;
 const cacheWx={cloud:{downloadFile:({success})=>{nativeDownloads++;finishDownload=success;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../utils/image-cache.js'),'utf8'),{module:cacheModule,exports:cacheModule.exports,wx:cacheWx,Map,Set,Date,Promise,setTimeout,console});
 const recoveryA=cacheModule.exports.recoverImage('cloud://file/recover');
 const recoveryB=cacheModule.exports.recoverImage('cloud://file/recover');
 assert.equal(recoveryA,recoveryB);assert.equal(nativeDownloads,1);
 finishDownload({tempFilePath:'wxfile://recovered-image'});
 assert.equal((await recoveryA).path,'wxfile://recovered-image');
 cacheWx.cloud.downloadFile=({fail})=>fail(new Error('download failed'));
 cacheWx.cloud.getTempFileURL=({success})=>success({fileList:[{fileID:'cloud://file/refresh',tempFileURL:'https://fresh.example/banner',status:0}]});
 assert.equal((await cacheModule.exports.recoverImage('cloud://file/refresh')).remoteUrl,'https://fresh.example/banner');
 // A native tab icon must contain transparent pixels and visible strokes, not a solid square.
 const zlib=require('zlib');for(const tab of require('../app.json').tabBar.list)for(const key of ['iconPath','selectedIconPath']){const data=fs.readFileSync(path.join(__dirname,'..',tab[key]));assert(data.length<40960);assert.equal(data.readUInt32BE(16),81);let offset=8,chunks=[];while(offset<data.length){let len=data.readUInt32BE(offset);if(data.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(data.subarray(offset+8,offset+8+len));offset+=len+12;}const raw=zlib.inflateSync(Buffer.concat(chunks));assert(new Set(raw).size>8);}
 console.log('refinements passed: paid/completed/refund dates, new/returning customers, popularity exclusions, settings validation, banner file IDs, storage failure isolation, native icons');
})().catch(e=>{console.error(e);process.exitCode=1;});
