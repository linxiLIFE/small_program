const crypto = require('crypto');
const { COLLECTIONS } = require('./constants');
const { db, getOptional, getContext } = require('./db');
const { getStaffAccountForContext, requireRole } = require('./auth');
const { AppError, assert } = require('./errors');

async function session() {
  const context = getContext();
  assert(context.uid || context.openid, 'UNAUTHENTICATED','请先登录',401);
  const current = await getStaffAccountForContext(context);
  if (!current) return {role:'UNASSIGNED',name:''};
  const {account} = await requireRole(['OWNER','STAFF','TECHNICIAN']);
  return {role:account.role,name:account.name || '',technicianId:account.technicianId || ''};
}
function validateCredentials(payload) {
  const username=String(payload.username || '').trim(); const password=String(payload.password || '');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(username),'INVALID_USERNAME','账号需为 3 到 32 位字母、数字、点、横线或下划线');
  const complexity=[/[a-z]/,/[A-Z]/,/[0-9]/,/[()!@#$%^&*|?><_-]/].filter(rule=>rule.test(password)).length;
  assert(password.length>=8&&password.length<=32&&/^[a-zA-Z0-9][a-zA-Z0-9()!@#$%^&*|?><_-]*$/.test(password)&&complexity>=3,'INVALID_PASSWORD','密码需为 8 到 32 位，以字母或数字开头，包含大小写字母、数字、符号中的至少三类，不能包含空格、中文或其他符号');
  return {username,password};
}

function accountProviderError(error, action) {
  const code = String(error && error.code || '').toUpperCase();
  const message = String(error && error.message || '');
  console.error('技师账号服务调用失败', { action, code, message });
  if (/TIMEOUT|TIMEDOUT|ECONN|ENET|EAI_AGAIN|SOCKET/.test(code) || /timeout|timed out|network|socket/i.test(message)) {
    return new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', '技师账号服务连接失败，请稍后重试', 503);
  }
  if (/credential|secret|unauthorized|forbidden|permission|invalid.*(token|key)/i.test(`${code} ${message}`)) {
    return new AppError('ACCOUNT_PROVIDER_CONFIG', '技师账号服务配置异常，请联系管理员', 503);
  }
  if (code === 'LIMITEXCEEDED' || code.startsWith('LIMITEXCEEDED.')) return new AppError('ACCOUNT_PROVIDER_QUOTA', '云端账号额度已用完，请联系管理员处理', 409);
  if (/PASSWORD/.test(code) || /password|密码/i.test(message)) return new AppError('INVALID_PASSWORD', '密码不符合账号服务要求，请使用大小写字母、数字和允许的符号');
  if (/DUPLICATE|ALREADYEXIST/.test(code) || /already exist|duplicate|已存在|重复/i.test(message)) return new AppError('ACCOUNT_CONFLICT', '账号名称已被使用，请更换账号名称');
  return new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', `技师账号服务暂时不可用（${code.replace(/[^A-Z0-9_.-]/g, '').slice(0,100) || 'UNKNOWN'}），请稍后重试`, 503);
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
  assert(envId, 'ACCOUNT_PROVIDER_CONFIG', '技师账号服务环境未配置', 503);
  // Read the deterministic UID first so a retry after a database/network failure
  // cannot create another account or change an existing account's credentials.
  async function providerFailure(error, action) {
    const diagnostic = { action, code: String(error && error.code || 'UNKNOWN').slice(0,100), requestId: String(error && error.requestId || '').slice(0,100), occurredAt: Date.now() };
    try { await db.collection(COLLECTIONS.staff).doc(bindingId).update({ data: { provisioningError: diagnostic } }); } catch (recordError) { console.error('保存账号服务诊断失败', { code: recordError.code }); }
    return accountProviderError(error, action);
  }
  let existing;
  try {
    existing=await client.DescribeUserList({EnvId:envId,UidList:[uid],PageSize:1});
  } catch (error) {
    throw await providerFailure(error, 'DescribeUserList');
  }
  const user=existing.Data?.UserList?.find(item=>item.Uid===uid);
  if(user) assert(String(user.Name || '').toLowerCase()===username.toLowerCase(),'ACCOUNT_CONFLICT','该技师账号名称已固定，请使用原账号名称');
  else {
    // App roles come from staff_accounts. CloudBase internal users are reserved
    // for its own console/workspace and consume the plan's member quota.
    let result;
    try {
      result=await client.CreateUser({EnvId:envId,Name:username,Uid:uid,Password:password,Type:'externalUser',UserStatus:'ACTIVE',NickName:technician.name.length>=2?technician.name:'技师'+technician.name});
    } catch (error) {
      throw await providerFailure(error, 'CreateUser');
    }
    assert(result.Data?.Uid===uid,'CREATE_ACCOUNT_FAILED','登录账号未创建成功');
  }
  await db.collection(COLLECTIONS.staff).doc(bindingId).set({data:{id:bindingId,uid,technicianId:payload.technicianId,role:'TECHNICIAN',active:true,name:username,createdAt:Date.now()}});
  const auditId=`audit-login-${crypto.randomUUID()}`;
  await db.collection(COLLECTIONS.auditLogs).doc(auditId).set({data:{id:auditId,operatorId:account.uid||account.openid,action:'CREATE_TECHNICIAN_LOGIN',objectId:payload.technicianId,createdAt:Date.now()}});
  return {username};
}
module.exports={session,createTechnicianLogin,validateCredentials};
