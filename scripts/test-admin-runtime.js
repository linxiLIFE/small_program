const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '..');
const constants = require('../cloudfunctions/api/lib/constants');
const errors = require('../cloudfunctions/api/lib/errors');
function load(file, stubs) {
  const scope = { module: { exports: {} }, console, require: name => name in stubs ? stubs[name] : require(name.startsWith('.') ? path.resolve(path.dirname(path.join(root,file)),name) : name) };
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
  return scope.module.exports;
}
(async () => {
  // Use the real authorization module: one account and technician read per
  // invocation, concurrent identities isolated, role and revocation rechecked.
  const contexts = new AsyncLocalStorage();
  const staff = { a: {id:'staff-a',uid:'a',role:'TECHNICIAN',technicianId:'tech-a',active:true}, b: {id:'staff-b',uid:'b',role:'TECHNICIAN',technicianId:'tech-b',active:true} };
  let accountReads=0, technicianReads=0;
  const auth = load('cloudfunctions/api/lib/auth.js', {
    './db': {db:{},getContext:()=>contexts.getStore(),find:async (_,where)=>{accountReads++;const a=staff[where.uid];return a?.active?[a]:[];},getOptional:async(_,id)=>{technicianReads++;return {id,enabled:true};}}
  });
  const authorize = uid => contexts.run({uid},async()=> {
    const account=await auth.getStaffAccountForContext({uid});
    return auth.withStaffAccount(account,async()=> {
      for(let i=0;i<3;i++) assert.equal((await auth.requireRole(['TECHNICIAN'])).account.uid,uid);
      await assert.rejects(auth.requireRole(['OWNER']),{code:'FORBIDDEN'});
    });
  });
  await Promise.all([authorize('a'),authorize('b')]);
  assert.equal(accountReads,2);assert.equal(technicianReads,2);
  staff.a.active=false;
  await contexts.run({uid:'a'},()=>assert.rejects(auth.requireRole(['TECHNICIAN']),{code:'FORBIDDEN'}));

  // Real SQL builder must enforce the authenticated technician even if the
  // client requests another technician. Dates/status/pagination stay available.
  let actor={role:'TECHNICIAN',technicianId:'tech-a'}; const queries=[];
  const orders=[{id:'future',technicianId:'tech-a',status:'RESERVED'}, {id:'completed',technicianId:'tech-a',status:'COMPLETED'}, {id:'other',technicianId:'tech-b',status:'RESERVED'}];
  const admin=load('cloudfunctions/api/lib/admin.js', {
    './auth':{requireRole:async roles=>{errors.assert(roles.includes(actor.role),'FORBIDDEN','forbidden',403);return{account:actor};}},
    './db':{db:{query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.includes('FROM orders')) {
        const scoped=orders.filter(o=>!sql.includes('technician_id = ?')||o.technicianId===params[0]);
        return sql.includes('COUNT(*)')?[[{total:scoped.length}]]:[scoped.map(data=>({data}))];
      }
      return [[]];
    }}, find:async()=>[],getOptional:async()=>null},
    './booking':{publicOrder:o=>o},'./catalog':{},'./catalog-admin':{},'./settings':{},'./payment-service':{},'./wechat-pay':{}
  });
  const own=await admin.listOrdersForAdmin({technicianId:'tech-b',page:1,limit:20});
  assert.deepEqual(Array.from(own.orders,o=>o.id),['future','completed']); assert.equal(own.canRefund,false);assert.equal(own.total,2);
  for(const q of queries.filter(q=>q.sql.includes('FROM orders'))) {assert(q.sql.includes('technician_id = ?'));assert.equal(q.params[0],'tech-a');}
  await assert.rejects(admin.orderFilters(),{code:'FORBIDDEN'});
  actor={role:'TECHNICIAN'};await assert.rejects(admin.listOrdersForAdmin({}),{code:'FORBIDDEN'});
  actor={role:'CUSTOMER'};await assert.rejects(admin.listOrdersForAdmin({}),{code:'FORBIDDEN'});

  // Native page makes exactly one request for a restored first screen. Employee
  // orders use the own-order endpoint, never the daily schedule or full catalog.
  let definition;const calls=[]; let scannerCalls=0;
  const summary={metrics:{},trend:[],categories:[],works:[],services:[],technicians:[]};
  let role='OWNER';
  const client={getSavedSession:()=>({token:'saved'}),request:async(action,payload)=>{
    calls.push({action,payload});
    if(action==='bootstrap') return {session:{role,technicianId:'tech-a'},data:role==='OWNER'?summary:{orders:[],plan:{},technician:{id:'tech-a'}}};
    if(action==='adminListOrders') return own;
    if(action==='redeemCheckInCode')return{};
    throw new Error('Unexpected request '+action);
  }};
  const scope={Page:value=>{definition=value;},require:name=>name==='./api'?client:require(path.resolve(root,'pages/admin',name)),wx:{pageScrollTo(){},scanCode:options=>{scannerCalls++;options.success({result:'signed-checkin-code'});}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/admin/index.js'),'utf8'),scope);
  function page(){return {...definition,data:structuredClone(definition.data),setData(patch){for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let target=this.data;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value;}}};}
  const ownerPage=page();await ownerPage.restoreSession();assert.deepEqual(calls.map(c=>c.action),['bootstrap']);assert(ownerPage.data.summary);
  role='TECHNICIAN';calls.length=0;const techPage=page();await techPage.restoreSession();assert.deepEqual(calls.map(c=>c.action),['bootstrap']);
  calls.length=0;await techPage.selectTab({currentTarget:{dataset:{tab:'orders'}}});
  assert.deepEqual(calls.map(c=>c.action),['adminListOrders']);assert.equal(techPage.data.orders.length,2);assert(!techPage.data.orders[0].canRefund);
  const beforeReselect=calls.length;await techPage.selectTab({currentTarget:{dataset:{tab:'orders'}}});assert.equal(calls.length,beforeReselect,'active tab does not reload orders');
  await techPage.scanCheckIn();assert.equal(scannerCalls,1);assert(calls.some(c=>c.action==='redeemCheckInCode'&&c.payload.code==='signed-checkin-code'));
  assert.equal(techPage.data.checkCode,'');
  const wxml=fs.readFileSync(path.join(root,'pages/admin/index.wxml'),'utf8');
  assert(wxml.includes('<block wx:if="{{tab === \'orders\'}}">'));
  assert(!wxml.includes("tab === 'orders' && !technician"));
  assert(wxml.includes('bindtap="scanCheckIn"'));
  // Removing the homepage avatar must also remove its profile fetch.
  let homeDefinition;const homeCalls=[];
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/index/index.js'),'utf8'),{
    Page:v=>{homeDefinition=v;},getApp:()=>({globalData:{}}),
    require:name=>name==='../../utils/api'?{getHome:async()=>{homeCalls.push('getHome');return{store:{storeName:'门店'},categories:[],works:[]};},getProfile:async()=>{throw new Error('homepage must not fetch profile');}}:require(path.resolve(root,'pages/index',name))
  });
  const home={...homeDefinition,data:structuredClone(homeDefinition.data),setData(patch){Object.assign(this.data,patch);}};
  home.onShow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(homeCalls,['getHome']);assert.equal(home.data.loading,false);

  // Share identical in-flight reads only. Recheck subsequent reads, retry failed
  // reads, and never combine business mutations or a different login's requests.
  let saved={token:'old',expiresAt:Date.now()+86400000};const gateway=[];
  const apiScope={module:{exports:{}},wx:{getStorageSync:()=>saved,setStorageSync:(_,v)=>{saved=v;},removeStorageSync:()=>{saved=null;},cloud:{callFunction:options=>new Promise(resolve=>gateway.push({options,resolve}))}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/admin/api.js'),'utf8'),apiScope);
  const apiClient=apiScope.module.exports;
  const first=apiClient.request('adminListOrders',{page:1}),duplicate=apiClient.request('adminListOrders',{page:1});
  assert.equal(gateway.length,1);gateway[0].resolve({result:{ok:true,data:{orders:[]}}});await Promise.all([first,duplicate]);
  const fresh=apiClient.request('adminListOrders',{page:1});assert.equal(gateway.length,2);gateway[1].resolve({result:{ok:false,error:{code:'INTERNAL_ERROR',message:'busy'}}});await assert.rejects(fresh,{code:'INTERNAL_ERROR'});
  const retry=apiClient.request('adminListOrders',{page:1});assert.equal(gateway.length,3);gateway[2].resolve({result:{ok:true,data:{orders:[]}}});await retry;
  const changes=[apiClient.request('staffTransition',{orderId:'one',action:'checkIn'}),apiClient.request('staffTransition',{orderId:'one',action:'checkIn'})];assert.equal(gateway.length,5);for(const entry of gateway.slice(3))entry.resolve({result:{ok:true,data:{}}});await Promise.all(changes);
  const oldRead=apiClient.request('bootstrap');const newLogin=apiClient.login('next','input-only');gateway[6].resolve({result:{ok:true,data:{token:'new',expiresAt:Date.now()+86400000,session:{role:'OWNER'}}}});await newLogin;
  const newRead=apiClient.request('bootstrap');assert.equal(gateway.length,8);gateway[5].resolve({result:{ok:false,error:{code:'UNAUTHENTICATED',message:'old expired'}}});await assert.rejects(oldRead,{code:'UNAUTHENTICATED'});assert.equal(saved.token,'new');gateway[7].resolve({result:{ok:true,data:{session:{role:'OWNER'}}}});await newRead;
  console.log('admin runtime passed: 1-call restored startup, request-local authorization reuse/revocation, own future/completed orders, forged technician isolation and employee scan redemption');
})().catch(err=>{console.error(err);process.exitCode=1;});
