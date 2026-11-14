// 模擬慢速結算及失敗；不呼叫正式 Firebase。
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[],calls=[];
  let release,entered;const gate=new Promise(resolve=>release=resolve),settling=new Promise(resolve=>entered=resolve);
  page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('__battleQueue',async(action,payload,id)=>{
   calls.push({action,payload,id});
   if(action==='battleSettle'){
    if(payload.battleId==='failure')return{error:{code:'functions/unavailable',message:'fixture network failure'}};
    entered();await gate;
   }
   return{result:{outcome:'win',health:0},serverNow:Date.now()};
  });
  await page.route('**/__battle_queue',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Battle queue</title>'}));
  await page.route('**/js/private-auth-client.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=true;'}));
  await page.route('**/js/farm/operations-client.js',r=>r.fulfill({contentType:'text/javascript',body:`
   export const createGameOperationsClient=()=>({farmTransaction:async(...args)=>{
    const response=await window.__battleQueue(...args);
    if(response.error)throw Object.assign(Error(response.error.message),{code:response.error.code});
    return response;
   }});
  `}));
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',groupId:'A'}));localStorage.setItem('lastGroupId','A');});
  await page.goto(base+'/__battle_queue');
  const pending=await page.evaluate(async()=>{
   const api=window.__battleApi=await import('/js/farm/backend-client.js');
   api.recordBattleHit('slow');
   window.__settle=api.settleBackendBattle('slow');
   const duplicate=api.settleBackendBattle('slow');
   window.__clean=api.farmCommand('helpClean',{targetGroupId:'A',targetAccountId:'bob'});
   window.__buy=api.farmCommand('buyMedicine',{quantity:1});
   return{same:window.__settle===duplicate,pending:api.hasPendingBackendBattle()};
  });
  assert.deepEqual(pending,{same:true,pending:true});
  let timer;try{await Promise.race([settling,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('settlement not requested')),5000))]);}finally{clearTimeout(timer);}
  assert.deepEqual(calls.map(row=>row.action),['battleAttack','battleSettle']);
  await page.evaluate(()=>window.__battleApi.farmCommand('settlePoultry'));
  assert.equal(calls.at(-1).action,'settlePoultry','背景同步不被結算鎖住');
  release();await page.evaluate(()=>Promise.all([window.__settle,window.__clean,window.__buy]));
  assert.equal(calls.filter(row=>row.action==='battleSettle').length,1);
  assert.deepEqual(calls.slice(-2).map(row=>row.action),['helpClean','buyMedicine']);
  assert.equal(await page.evaluate(()=>window.__battleApi.hasPendingBackendBattle()),false);
  const before=calls.filter(row=>row.action==='helpClean').length;
  const failed=await page.evaluate(async()=>{
   const api=window.__battleApi;
   const settlement=api.settleBackendBattle('failure');
   const clean=api.farmCommand('helpClean',{targetGroupId:'A',targetAccountId:'bob'});
   return(await Promise.allSettled([settlement,clean])).map(result=>({status:result.status,code:result.reason?.code}));
  });
  assert.ok(failed.every(result=>result.status==='rejected'&&result.code==='functions/unavailable'));
  assert.equal(calls.filter(row=>row.action==='helpClean').length,before,'失敗時不送出後續經濟操作');
  await page.evaluate(()=>window.__battleApi.settleBackendBattle('failure').catch(()=>{}));
  const retry=calls.filter(row=>row.action==='battleSettle'&&row.payload.battleId==='failure');
  assert.equal(retry.length,2);assert.equal(retry[0].id,retry[1].id,'失敗重試保留原收據');
  assert.deepEqual(errors,[]);
  console.log('PASS slow settlement queues economic actions, shares settlement, preserves background sync, blocks failed follow-ups and reuses retry receipts');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
