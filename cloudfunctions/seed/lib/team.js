const crypto = require('crypto');
const { COLLECTIONS } = require('./constants');
const { db, getOptional, find, getContext } = require('./db');
const { requireRole } = require('./auth');
const { assert } = require('./errors');

async function session() {
  const context = getContext();
  assert(context.uid || context.openid, 'UNAUTHENTICATED','请先登录',401);
  const records = context.uid ? await find(COLLECTIONS.staff,{uid:context.uid,active:true},{limit:1}) : await find(COLLECTIONS.staff,{openid:context.openid,active:true},{limit:1});
  if (!records.length) return {role:'UNASSIGNED',name:''};
  const {account} = await requireRole(['OWNER','STAFF','TECHNICIAN']);
  return {role:account.role,name:account.name || '',technicianId:account.technicianId || ''};
}
function validateCredentials(payload) {
  const username=String(payload.username || '').trim(); const password=String(payload.password || '');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(username),'INVALID_USERNAME','账号需为 3 到 32 位字母、数字、点、横线或下划线');
  const complexity=[/[a-z]/,/[A-Z]/,/[0-9]/,/[()!@#$%^&*|?><_-]/].filter(rule=>rule.test(password)).length;
  assert(password.length>=8&&password.length<=32&&/^[a-zA-Z0-9]/.test(password)&&complexity>=3,'INVALID_PASSWORD','密码需为 8 到 32 位，以字母或数字开头，包含大小写字母、数字、符号中的至少三类');
  return {username,password};
}
async function createTechnicianLogin(payload) {
  const {account} = await requireRole(['OWNER']);
  const {username,password}=validateCredentials(payload);
  const technician=await getOptional(COLLECTIONS.technicians,payload.technicianId);
  assert(technician&&technician.enabled!==false,'INVALID_TECHNICIAN','请先保存并启用技师');
  const uid=`tech_${crypto.createHash('sha256').update(payload.technicianId).digest('hex').slice(0,32)}`;
  const bindingId=`web_${payload.technicianId}`;
  // Reserve the deterministic identity before the external call. A failed provisioning
  // has no active business permissions and can safely be retried with the same username.
  await db.runTransaction(async transaction=>{
    const current=await getOptional(COLLECTIONS.staff,bindingId,transaction);
    assert(!current?.active,'ALREADY_BOUND','该技师已开通账号');
    await transaction.collection(COLLECTIONS.staff).doc(bindingId).set({data:{id:bindingId,uid,technicianId:payload.technicianId,role:'TECHNICIAN',active:false,name:username,createdAt:current?.createdAt||Date.now()}});
  });
  const tcb=require('@cloudbase/node-sdk');
  const credentials=tcb.getCloudbaseContext();
  const Client=require('tencentcloud-sdk-nodejs-tcb').tcb.v20180608.Client;
  const client=new Client({credential:{secretId:credentials.TENCENTCLOUD_SECRETID,secretKey:credentials.TENCENTCLOUD_SECRETKEY,token:credentials.TENCENTCLOUD_SESSIONTOKEN},region:'ap-shanghai',profile:{httpProfile:{reqTimeout:15}}});
  const envId=credentials.TCB_ENV || credentials.SCF_NAMESPACE;
  // Read the deterministic UID first so a retry after a database/network failure
  // cannot create another account or change an existing account's credentials.
  const existing=await client.DescribeUserList({EnvId:envId,UidList:[uid],PageSize:1});
  const user=existing.Data?.UserList?.find(item=>item.Uid===uid);
  if(user) assert(user.Name===username,'ACCOUNT_CONFLICT','该技师账号名称已固定，请使用原账号名称');
  else {
    const result=await client.CreateUser({EnvId:envId,Name:username,Uid:uid,Password:password,Type:'internalUser',UserStatus:'ACTIVE',NickName:technician.name.length>=2?technician.name:'技师'+technician.name});
    assert(result.Data?.Uid===uid,'CREATE_ACCOUNT_FAILED','登录账号未创建成功');
  }
  await db.collection(COLLECTIONS.staff).doc(bindingId).set({data:{id:bindingId,uid,technicianId:payload.technicianId,role:'TECHNICIAN',active:true,name:username,createdAt:Date.now()}});
  const auditId=`audit-login-${crypto.randomUUID()}`;
  await db.collection(COLLECTIONS.auditLogs).doc(auditId).set({data:{id:auditId,operatorId:account.uid||account.openid,action:'CREATE_TECHNICIAN_LOGIN',objectId:payload.technicianId,createdAt:Date.now()}});
  return {username};
}
module.exports={session,createTechnicianLogin,validateCredentials};
