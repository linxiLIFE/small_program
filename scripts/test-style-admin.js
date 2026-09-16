const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const constants = require('../cloudfunctions/api/lib/constants');
let actor = {role:'OWNER',uid:'owner'};
const tables = {categories:{nail:{id:'nail',name:'美甲',enabled:true},brow:{id:'brow',name:'眉毛',enabled:true}},services:{service:{id:'service',name:'法式',categoryId:'nail',categoryName:'美甲',enabled:true,priceFen:9900,durationMinutes:60}},works:{},technicians:{tech:{id:'tech',name:'技师',enabled:true,skills:['service']},other:{id:'other',name:'其他',enabled:true,skills:['service']}},orders:{},technician_days:{},staff_accounts:{},audit_logs:{}};
const clone = value=>JSON.parse(JSON.stringify(value));
const db={ collection: table => ({ doc: id => ({ set: async ({data}) => { (tables[table] ||= {})[id]=clone(data); } }) }) };
db.query=async()=>[[]];
db.insertIfAbsent=async(table,id,data)=>{if(tables[table]?.[id])return{inserted:false};(tables[table]||={})[id]=clone(data);return{inserted:true};};
db.command={in:value=>({__in:value}),gte:value=>value};
db.runTransaction=async fn=>{const before=clone(tables);try{return await fn(db);}catch(error){Object.keys(tables).forEach(k=>delete tables[k]);Object.assign(tables,before);throw error;}};
const stubs={
 './constants':constants,
 './db':{db,getOptional:async(table,id)=>tables[table]?.[id]||null,find:async(table,where={})=>Object.values(tables[table]||{}).filter(item=>Object.entries(where).every(([key,value])=>value&&value.__in?value.__in.includes(item[key]):item[key]===value)),getContext:()=>({uid:actor.uid})},
 './auth':{requireRole:async roles=>{if(!roles.includes(actor.role))throw new Error('FORBIDDEN');return{account:actor,context:{uid:actor.uid}};}},
 './errors':{assert:(condition,code)=>{if(!condition)throw new Error(code);},AppError:class extends Error{constructor(code){super(code);}}},
 './money':require('../cloudfunctions/api/lib/money'),
 './time':require('../cloudfunctions/api/lib/time'),
 './settings':{getCurrentSettings:async()=>clone(constants.DEFAULT_SETTINGS)},
 './booking':{publicOrder:item=>item}
};
const cache={};
function load(name){if(cache[name])return cache[name];const scope={module:{exports:{}},require:ref=>ref==='crypto'?crypto:stubs[ref]||(['./catalog','./catalog-admin','./analytics','./settings-validation'].includes(ref)?load(ref.slice(2)):{}),console,Buffer};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/api/lib',name+'.js'),'utf8'),scope);return cache[name]=scope.module.exports;}
(async()=>{
 assert.equal(stubs['./time'].weekday('2026-09-07'),1); assert.equal(stubs['./time'].weekday('2026-09-13'),7);
 const catalog=load('catalog-admin');
 const category=await catalog.saveCategory({name:'新大类',enabled:false,sort:3});assert(category.id);assert.equal(category.enabled,false);
 await assert.rejects(catalog.saveService({name:'新项目',categoryId:category.id,priceFen:100,durationMinutes:30}),/INVALID_CATEGORY/);
 await assert.rejects(catalog.saveService({name:'超限项目',categoryId:'nail',priceFen:10000001,durationMinutes:30}),/INVALID_SERVICE/);
 const service=await catalog.saveService({name:'新项目',categoryId:'nail',categoryName:'伪造',priceFen:100,durationMinutes:30,enabled:true});assert.equal(service.categoryName,'美甲');assert.equal(service.enabled,true);
 const work=await catalog.saveWork({title:'新款',imageUrl:'https://example.com/a.jpg',serviceId:service.id,featured:true,featuredSort:2,published:true});assert(work.id);assert.equal(work.featured,true);
 const secondWork=await catalog.saveWork({title:'另一款',imageUrl:'https://example.com/b.jpg',serviceId:service.id,featured:false,published:true});
 await catalog.saveFeaturedWorks({orderedIds:[secondWork.id,work.id]});
 assert.equal(tables.works[secondWork.id].featured,true);assert.equal(tables.works[secondWork.id].featuredSort,1);assert.equal(tables.works[work.id].featuredSort,2);
 const listing=await catalog.listCatalog();assert(listing.categories.some(c=>!c.enabled));assert(listing.services.every(s=>typeof s.enabled==='boolean'));assert(listing.works.some(w=>w.featured));
 await assert.rejects(catalog.saveWork({...work,imageUrl:'javascript:alert(1)'}),/INVALID_IMAGE/);
 await assert.rejects(catalog.saveTechnician({name:'无项目',skills:[],enabled:true}),/INVALID_SKILLS/);
 const tech=await catalog.saveTechnician({name:'新技师',skills:[service.id],enabled:true});assert(tech.id);
 const multiTech=await catalog.saveTechnician({name:'多能技师',categoryIds:['nail','brow'],enabled:true});assert.deepEqual(multiTech.categoryIds,['nail','brow']);
 const removable=await catalog.saveTechnician({name:'待删除技师',categoryIds:['nail'],enabled:true});
 assert.deepEqual(await catalog.deleteTechnician(removable.id),{id:removable.id,deleted:true});assert.equal(tables.technicians[removable.id].archived,true);assert.equal(tables.technicians[removable.id].enabled,false);
 const booked=await catalog.saveTechnician({name:'已有预约技师',categoryIds:['nail'],enabled:true});tables.orders.booked={id:'booked',technicianId:booked.id,status:'CANCELLED_BY_USER'};
 await assert.rejects(catalog.deleteTechnician(booked.id),/TECHNICIAN_HAS_ORDERS/);assert.equal(tables.technicians[booked.id].archived,undefined);
 await catalog.saveFeaturedWorks({orderedIds:[]});
 await catalog.saveWork({...work,published:false});assert.equal((await load('catalog').getHome(constants.DEFAULT_SETTINGS)).works.length,0);
 const deletableCategory=await catalog.saveCategory({name:'可删除大项',enabled:true});
 const deleteServices=[];const deleteWorks=[];
 for(let index=0;index<3;index++){
   const item=await catalog.saveService({name:`待删小项目${index}`,categoryId:deletableCategory.id,priceFen:100,durationMinutes:30});
   deleteServices.push(item);
   deleteWorks.push(await catalog.saveWork({title:`待删款式${index}`,imageUrl:'https://example.com/style.jpg',serviceId:item.id,published:true}));
 }
 const snapshots=deleteWorks.map((item,index)=>({id:`catalog-order-${index}`,serviceId:deleteServices[index].id,workSnapshot:{id:item.id,title:item.title,imageUrl:item.imageUrl},serviceSnapshot:{id:deleteServices[index].id,name:deleteServices[index].name,categoryId:deletableCategory.id,categoryName:deletableCategory.name}}));
 snapshots.forEach(order=>{tables.orders[order.id]=clone(order);});
 assert.deepEqual(await catalog.deleteCatalog('work',deleteWorks[0].id),{id:deleteWorks[0].id,deleted:true,archivedServices:0,archivedWorks:0});
 assert.equal(tables.works[deleteWorks[0].id].archived,true);
 await assert.rejects(load('catalog').getWork(deleteWorks[0].id),/WORK_NOT_FOUND/);
 assert.deepEqual(await catalog.deleteCatalog('service',deleteServices[1].id),{id:deleteServices[1].id,deleted:true,archivedServices:0,archivedWorks:1});
 assert.equal(tables.services[deleteServices[1].id].archived,true);assert.equal(tables.works[deleteWorks[1].id].archived,true);
 await assert.rejects(load('catalog').getService(deleteServices[1].id),/SERVICE_NOT_FOUND/);
 tables.works.legacyOrphan={id:'legacyOrphan',title:'旧数据款式',serviceId:deleteServices[1].id,categoryId:deletableCategory.id,published:true};
 assert.deepEqual(await catalog.deleteCatalog('category',deletableCategory.id),{id:deletableCategory.id,deleted:true,archivedServices:2,archivedWorks:2});
 assert.equal(tables.categories[deletableCategory.id].archived,true);assert.equal(tables.services[deleteServices[2].id].archived,true);assert.equal(tables.works[deleteWorks[2].id].archived,true);
 assert.equal(tables.works.legacyOrphan.archived,true);
 const afterDelete=await catalog.listCatalog();
 assert(!afterDelete.categories.some(item=>item.id===deletableCategory.id));
 assert(!afterDelete.services.some(item=>deleteServices.some(service=>service.id===item.id)));
 assert(!afterDelete.works.some(item=>deleteWorks.some(work=>work.id===item.id)));
 snapshots.forEach(order=>assert.deepEqual(tables.orders[order.id],order));
 await assert.rejects(catalog.saveWork({...deleteWorks[2]}),/INVALID_SERVICE/);
 await assert.rejects(catalog.deleteCatalog('work',deleteWorks[0].id),/CATALOG_NOT_FOUND/);
 actor={role:'TECHNICIAN',uid:'tech-user',technicianId:'tech'};
 await assert.rejects(catalog.saveCategory({name:'越权'}),/FORBIDDEN/);
 await assert.rejects(catalog.listCatalog(),/FORBIDDEN/);
 const admin=load('admin');
 await assert.rejects(admin.saveScheduleDay({technicianId:'other'}),/FORBIDDEN/);
 const date=stubs['./time'].toDateString();
 const startAt=stubs['./time'].dateToTimestamp(date,'11:00');const endAt=startAt+3600000;
 tables.orders.order={id:'order',technicianId:'tech',date,startAt,endAt,status:'RESERVED'};
 await assert.rejects(admin.saveScheduleDay({technicianId:'tech',date,leave:true,shifts:[],version:1}),/SCHEDULE_CONFLICT/);
 const saved=await admin.saveScheduleDay({technicianId:'tech',date,leave:false,shifts:[{start:'10:00',end:'20:00',breaks:[]}],version:1});assert.equal(saved.technicianId,'tech');
 await assert.rejects(admin.saveScheduleDay({technicianId:'tech',date,leave:false,shifts:[{start:'10:00',end:'20:00',breaks:[{start:'11:00',end:'11:30'}]}],version:1}),/SCHEDULE_CONFLICT/);
 const own=await admin.mySchedule({date,technicianId:'other'});assert.equal(own.technician.id,'tech');assert(own.days.every(day=>day.technicianId==='tech'));
 const media=load('media');assert.throws(()=>media.decodeImage({base64:Buffer.from('<svg>evil</svg>').toString('base64')}),/INVALID_IMAGE/);
 const team=load('team');assert.throws(()=>team.validateCredentials({username:'ab',password:'12345678'}),/INVALID_USERNAME/);assert.throws(()=>team.validateCredentials({username:'technician',password:'12345678'}),/INVALID_PASSWORD/);
 console.log('admin tests passed: category/service/style/technician CRUD, featured filtering, uploads, role isolation, personal schedule, booking conflicts');
})().catch(error=>{console.error(error);process.exitCode=1;});
