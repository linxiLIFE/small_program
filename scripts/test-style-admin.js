const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const constants = require('../cloudfunctions/api/lib/constants');
let actor = {role:'OWNER',uid:'owner'};
const tables = {categories:{nail:{id:'nail',name:'美甲',enabled:true}},services:{service:{id:'service',name:'法式',categoryId:'nail',categoryName:'美甲',enabled:true,priceFen:9900,durationMinutes:60}},works:{},technicians:{tech:{id:'tech',name:'技师',enabled:true,skills:['service']},other:{id:'other',name:'其他',enabled:true,skills:['service']}},orders:{},technician_days:{},staff_accounts:{},audit_logs:{}};
const clone = value=>JSON.parse(JSON.stringify(value));
const db={ collection: table => ({ doc: id => ({ set: async ({data}) => { (tables[table] ||= {})[id]=clone(data); } }) }) };
db.runTransaction=async fn=>{const before=clone(tables);try{return await fn(db);}catch(error){Object.keys(tables).forEach(k=>delete tables[k]);Object.assign(tables,before);throw error;}};
const stubs={
 './constants':constants,
 './db':{db,getOptional:async(table,id)=>tables[table]?.[id]||null,find:async(table,where={})=>Object.values(tables[table]||{}).filter(item=>Object.entries(where).every(([key,value])=>item[key]===value)),getContext:()=>({uid:actor.uid})},
 './auth':{requireRole:async roles=>{if(!roles.includes(actor.role))throw new Error('FORBIDDEN');return{account:actor,context:{uid:actor.uid}};}},
 './errors':{assert:(condition,code)=>{if(!condition)throw new Error(code);},AppError:class extends Error{constructor(code){super(code);}}},
 './money':require('../cloudfunctions/api/lib/money'),
 './time':require('../cloudfunctions/api/lib/time'),
 './settings':{getCurrentSettings:async()=>clone(constants.DEFAULT_SETTINGS)},
 './booking':{publicOrder:item=>item}
};
const cache={};
function load(name){if(cache[name])return cache[name];const scope={module:{exports:{}},require:ref=>ref==='crypto'?crypto:stubs[ref]||(['./catalog','./catalog-admin'].includes(ref)?load(ref.slice(2)):{}),console,Buffer};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/api/lib',name+'.js'),'utf8'),scope);return cache[name]=scope.module.exports;}
(async()=>{
 assert.equal(stubs['./time'].weekday('2026-09-07'),1); assert.equal(stubs['./time'].weekday('2026-09-13'),7);
 const catalog=load('catalog-admin');
 const category=await catalog.saveCategory({name:'新大类',enabled:false,sort:3});assert(category.id);assert.equal(category.enabled,false);
 await assert.rejects(catalog.saveService({name:'新项目',categoryId:category.id,priceFen:100,durationMinutes:30}),/INVALID_CATEGORY/);
 const service=await catalog.saveService({name:'新项目',categoryId:'nail',categoryName:'伪造',priceFen:100,durationMinutes:30,enabled:true});assert.equal(service.categoryName,'美甲');assert.equal(service.enabled,true);
 const work=await catalog.saveWork({title:'新款',imageUrl:'https://example.com/a.jpg',serviceId:service.id,featured:true,featuredSort:2,published:true});assert(work.id);assert.equal(work.featured,true);
 const listing=await catalog.listCatalog();assert(listing.categories.some(c=>!c.enabled));assert(listing.services.every(s=>typeof s.enabled==='boolean'));assert(listing.works.some(w=>w.featured));
 await assert.rejects(catalog.saveWork({...work,imageUrl:'javascript:alert(1)'}),/INVALID_IMAGE/);
 await assert.rejects(catalog.saveTechnician({name:'无项目',skills:[],enabled:true}),/INVALID_SKILLS/);
 const tech=await catalog.saveTechnician({name:'新技师',skills:[service.id],enabled:true});assert(tech.id);
 await catalog.saveWork({...work,published:false});assert.equal((await load('catalog').getHome(constants.DEFAULT_SETTINGS)).works.length,0);
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
