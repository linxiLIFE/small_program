const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { AppError, assert: check } = require('../cloudfunctions/api/lib/errors');
const records = {};
let createCount = 0;
let createInput;
let providerError;
let providerUser;
const techId = 'account-test-tech';
const uid = `tech_${crypto.createHash('sha256').update(techId).digest('hex').slice(0, 32)}`;
const collection = name => ({doc: id => ({
  set: async ({data}) => { records[`${name}:${id}`] = {...data}; },
  update: async ({data}) => { Object.assign(records[`${name}:${id}`], data); }
})});
const db = { collection, runTransaction: async callback => callback({collection}) };
class Client {
  async DescribeUserList() { if (providerError) throw providerError; return {Data:{UserList:providerUser ? [providerUser] : []}}; }
  async CreateUser(input) { createCount += 1; createInput = input; return {Data:{Uid:input.Uid}}; }
}
const moduleValue = {exports:{}};
vm.runInNewContext(fs.readFileSync('cloudfunctions/api/lib/team.js', 'utf8'), {
  module: moduleValue, console: {error() {}}, require: name => {
    if (name === 'crypto') return crypto;
    if (name === './constants') return {COLLECTIONS:{technicians:'technicians',staff:'staff',auditLogs:'audit'}};
    if (name === './db') return {db,getContext:()=>({uid:'owner'}),getOptional:async(name,id)=>name==='technicians'?{id:techId,name:'测试技师',enabled:true}:records[`${name}:${id}`]||null};
    if (name === './auth') return {requireRole:async()=>({account:{uid:'owner'}})};
    if (name === './errors') return {AppError,assert:check};
    if (name === '@cloudbase/node-sdk') return {getCloudbaseContext:()=>({SCF_NAMESPACE:'env'})};
    if (name === 'tencentcloud-sdk-nodejs-tcb') return {tcb:{v20180608:{Client}}};
    throw new Error(`Unexpected module ${name}`);
  }
});
(async()=>{
  const team = moduleValue.exports;
  const input={technicianId:techId,username:'Account_Test',password:'Good9Abc_'};
  for(const password of ['Good9Abc 中文','Good9Abc ','Good9Abc😀']) assert.throws(()=>team.validateCredentials({...input,password}),error=>error.code==='INVALID_PASSWORD');
  team.validateCredentials(input);
  providerError=Object.assign(new Error('service unavailable'),{code:'FailedOperation.TestProvider',requestId:'provider-test-request'});
  await assert.rejects(team.createTechnicianLogin(input),error=>error.code==='ACCOUNT_PROVIDER_UNAVAILABLE'&&error.message.includes('FAILEDOPERATION.TESTPROVIDER'));
  assert.equal(records[`staff:web_${techId}`].active,false);
  assert.equal(records[`staff:web_${techId}`].provisioningError.action,'DescribeUserList');
  assert.equal(records[`staff:web_${techId}`].provisioningError.requestId,'provider-test-request');
  assert.equal(JSON.stringify(records).includes(input.password),false);
  providerError=Object.assign(new Error('quota exceeded'),{code:'LimitExceeded'});
  await assert.rejects(team.createTechnicianLogin(input),error=>error.code==='ACCOUNT_PROVIDER_QUOTA');
  assert.equal(records[`staff:web_${techId}`].active,false);
  providerError=undefined;
  await team.createTechnicianLogin(input);
  assert.equal(createCount,1);
  assert.equal(createInput.Type,'externalUser');
  assert.equal(createInput.Uid,uid);
  assert.equal(records[`staff:web_${techId}`].active,true);
  records[`staff:web_${techId}`].active=false;
  providerUser={Uid:uid,Name:input.username.toLowerCase()};
  await team.createTechnicianLogin(input);
  assert.equal(createCount,1);
  assert.equal(records[`staff:web_${techId}`].active,true);
  assert.equal(records[`staff:web_${techId}`].provisioningError,undefined);
  await assert.rejects(team.createTechnicianLogin(input),error=>error.code==='ALREADY_BOUND');
  console.log('technician account tests passed: external login users, explicit quota errors, password rules, safe diagnostics, retry identity and duplicate binding');
})().catch(error=>{console.error(error);process.exitCode=1;});
