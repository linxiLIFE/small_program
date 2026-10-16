const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const { AppError, assert: businessAssert } = require('../cloudfunctions/api/lib/errors');
const contexts = new AsyncLocalStorage();
const records = new Map();
const staff = new Map([
  ['owner-uid', { id: 'owner', uid: 'owner-uid', role: 'OWNER', name: '店主', active: true }],
  ['tech-uid', { id: 'technician', uid: 'tech-uid', role: 'TECHNICIAN', name: '技师', technicianId: 'tech-1', active: true }]
]);
const rates = [];
let providerCalls = 0;
let fakeNow = 1800000000000;
class Clock extends Date { static now() { return fakeNow; } }
const db = { collection: () => ({ doc: id => ({
  set: async ({data}) => records.set(id, structuredClone(data)),
  update: async ({data}) => records.set(id, { ...records.get(id), ...data })
}) }) };
const findAccount = async context => { const found = staff.get(context.uid); return found && found.active ? found : null; };
const requireRole = async roles => {
  const account = await findAccount(contexts.getStore());
  businessAssert(account && roles.includes(account.role) && !account.disabled, 'FORBIDDEN', '权限不足', 403);
  return { account, context: contexts.getStore() };
};
const sandbox = { module: {exports:{}}, Buffer, Date: Clock, process: {env: {TCB_ENV:'test-env'}}, require(name) {
  if (name === 'crypto') return require('node:crypto');
  if (name === 'https') return { request(url, options, callback) {
    providerCalls++; assert.equal(url, 'https://test-env.api.tcloudbasegateway.com/auth/v1/signin');
    assert.equal(options.method,'POST'); assert.match(options.headers['x-device-id'], /^[a-f0-9]{40}$/);
    const req = new EventEmitter(); req.destroy = () => req.emit('error',new Error('connection failed'));
    req.end = body => {
      const input = JSON.parse(body);
      setImmediate(() => {
        const good = input.password === 'correct-password'; const response = new EventEmitter();
        response.setEncoding=()=>{}; response.statusCode=good?200:400; callback(response);
        response.emit('data',JSON.stringify(good ? {sub:input.username === 'owner'?'owner-uid':input.username === 'tech'?'tech-uid':'unassigned',access_token:'provider-secret',refresh_token:'refresh-secret'} : {error:'invalid_username_or_password'})); response.emit('end');
      });
    }; return req;
  } };
  if (name === './constants') return {COLLECTIONS:{idempotency:'idempotency_keys'}};
  if (name === './db') return {db,getContext:()=>contexts.getStore(),getOptional:async (_,id)=>records.get(id),withRequestContext:(context,fn)=>contexts.run(context,fn)};
  if (name === './auth') return {requireOpenId:()=>{const context=contexts.getStore();businessAssert(context?.openid,'UNAUTHENTICATED','需要微信身份',401);return context;},getStaffAccountForContext:findAccount,requireRole};
  if (name === './errors') return {AppError,assert:businessAssert};
  if (name === './rate-limit') return {enforceActionRateLimit:async action=>rates.push(action)};
  throw new Error(`Unexpected import ${name}`);
} };
vm.runInNewContext(fs.readFileSync(path.join(root,'cloudfunctions/api/lib/native-admin.js'),'utf8'),sandbox);
const server = sandbox.module.exports;
const context = {openid:'wechat-a',appid:'wx-app'};
const invoke = (payload,who=context) => contexts.run(who,()=>server.dispatch(payload,async (action,payload)=>{
  await requireRole(action==='adminSaveSettings'?['OWNER']:action==='mySchedule'?['TECHNICIAN']:['OWNER','STAFF']);
  return {action,uid:contexts.getStore().uid,payload};
}));

(async()=>{
  await assert.rejects(invoke({action:'login',username:'owner',password:'correct-password'},{}),{code:'UNAUTHENTICATED'});
  assert.equal(providerCalls,0,'anonymous callers do not reach password provider');
  await assert.rejects(invoke({action:'login',username:'owner',password:'incorrect'}),{code:'INVALID_CREDENTIALS'});
  assert.equal(records.size,0,'invalid password grants no session');
  await assert.rejects(invoke({action:'login',username:'other',password:'correct-password'}),{code:'FORBIDDEN'});
  assert.equal(records.size,0,'unassigned account grants no session');
  const [owner,tech] = await Promise.all([
    invoke({action:'login',username:'owner',password:'correct-password'}),
    invoke({action:'login',username:'tech',password:'correct-password'})
  ]);
  assert.equal(owner.session.role,'OWNER'); assert.equal(tech.session.role,'TECHNICIAN');
  assert.notEqual(owner.token,tech.token,'concurrent logins remain independent');
  assert.equal(records.size,2);
  for(const [id,record] of records){
    assert.notEqual(id,owner.token); assert.notEqual(id,tech.token);
    assert(!JSON.stringify(record).includes('password')); assert(!JSON.stringify(record).includes('provider-secret'));
    assert.equal(record.openid,context.openid); assert.equal(record.appid,context.appid);
  }
  assert(rates.every(action=>action==='nativeAdminLogin'));
  const result=await invoke({action:'adminSummary',token:owner.token,payload:{uid:'attacker'}});
  assert.equal(result.uid,'owner-uid','identity comes from server session, never client payload');
  await assert.rejects(invoke({action:'adminSummary',token:owner.token},{...context,openid:'wechat-b'}),{code:'UNAUTHENTICATED'});
  await assert.rejects(invoke({action:'adminSummary',token:owner.token},{...context,appid:'another-app'}),{code:'UNAUTHENTICATED'});
  for(const action of ['createOrder','preparePayment','nativeAdmin','UNKNOWN']) await assert.rejects(invoke({action,token:owner.token}),{code:'FORBIDDEN'});
  await assert.rejects(invoke({action:'adminSaveSettings',token:tech.token}),{code:'FORBIDDEN'});
  assert.equal((await invoke({action:'mySchedule',token:tech.token})).uid,'tech-uid');
  staff.get('owner-uid').active=false;
  await assert.rejects(invoke({action:'adminSummary',token:owner.token}),{code:'FORBIDDEN'});
  staff.get('owner-uid').active=true;
  staff.get('tech-uid').disabled=true;
  await assert.rejects(invoke({action:'mySchedule',token:tech.token}),{code:'FORBIDDEN'});
  staff.get('tech-uid').disabled=false;
  await invoke({action:'logout',token:owner.token});
  await assert.rejects(invoke({action:'adminSummary',token:owner.token}),{code:'UNAUTHENTICATED'});
  fakeNow+=31*86400000;
  await assert.rejects(invoke({action:'mySchedule',token:tech.token}),{code:'UNAUTHENTICATED'});

  // Actual native client: only a bounded session credential is stored. A reopen
  // rechecks the server and expiry/logout invalidate it, while returning home does not.
  let saved; let cloudError; const calls=[];
  function client() {
    const scope={module:{exports:{}},Date,Error,wx:{getStorageSync:()=>saved,setStorageSync:(_,value)=>{saved=value;},removeStorageSync:()=>{saved=null;},cloud:{callFunction:async options=>{
      calls.push(options); const action=options.data.payload.action;
      return {result:cloudError?{ok:false,error:cloudError}:{ok:true,data:action==='login'?{token:'a'.repeat(64),expiresAt:Date.now()+86400000,session:{role:'OWNER',name:'店主'}}:{role:'OWNER',name:'店主'}}};
    }}}};vm.runInNewContext(fs.readFileSync(path.join(root,'pages/admin/api.js'),'utf8'),scope);return scope.module.exports;
  }
  await client().login('owner','entered-password');
  assert.equal(saved.token,'a'.repeat(64)); assert(!JSON.stringify(saved).includes('password'));
  const reopened=client();assert(reopened.getSavedSession());await reopened.request('staffSession');
  assert.equal(calls.at(-1).data.payload.token,'a'.repeat(64));assert.equal(calls.at(-1).data.action,'nativeAdmin');
  cloudError={code:'UNAUTHENTICATED',message:'expired'};
  await assert.rejects(reopened.request('staffSession'),{code:'UNAUTHENTICATED'});assert.equal(saved,null);
  cloudError=null;await reopened.login('owner','entered-password');await reopened.logout();assert.equal(saved,null);
  saved={token:'a'.repeat(64),expiresAt:Date.now()-1};assert.equal(client().getSavedSession(),null);

  let definition;
  const native={Page:value=>{definition=value;},require:name=>name==='./api'?{request:async()=>({role:'OWNER'})}:require(path.resolve(root,'pages/admin',name))};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/admin/index.js'),'utf8'),native);
  assert.equal(typeof definition.backHome,'function');assert.equal(typeof definition.scanCheckIn,'function');assert.equal(typeof definition.saveDay,'function');
  for(const file of ['pages/admin/index.js','pages/admin/index.wxml','pages/admin/api.js']){
    const source=fs.readFileSync(path.join(root,file),'utf8');assert(!/<web-view|adminUrl|wx\.request\(/.test(source),file+' must use native cloud functions');
  }
  console.log('native admin passed: password verification, concurrent identities, no credential persistence, role/WeChat/app isolation, expiry, revocation, logout, action allowlist, cloud-only native transport and session restore');
})().catch(error=>{console.error(error);process.exitCode=1;});
