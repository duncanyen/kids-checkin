// Real HTML/CSS/JS; Auth transport is isolated, API uses the tested service fixture.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {fixture}=require('./fixture.cjs');
const base=process.env.OPS_UI_BASE||'http://127.0.0.1:8030/game-admin/site';
const mockRuntime=`
let observer;
const current=()=>JSON.parse(sessionStorage.getItem('ops-test-user')||'null');
export const observe=callback=>{observer=callback;queueMicrotask(()=>callback(current()));return()=>{};};
export const identity=async user=>user;
export async function login(email,password){if(password!=='isolated-only')throw Object.assign(Error('Bad login'),{code:'auth/invalid-credential'});if(email==='player@example.test'){const user={uid:'alice',email,admin:false,mfa:false};sessionStorage.setItem('ops-test-user',JSON.stringify(user));observer(user);return{};}if(email==='plain@example.test'){const user={uid:'admin',email,admin:true,mfa:false,enrolled:false};sessionStorage.setItem('ops-test-user',JSON.stringify(user));observer(user);return{};}sessionStorage.setItem('ops-test-pending',email);return{mfaRequired:true};}
export async function finishMfa(code){if(code!=='123456')throw Object.assign(Error('Bad code'),{code:'auth/invalid-verification-code'});const user={uid:'admin',email:sessionStorage.getItem('ops-test-pending'),admin:true,mfa:true};sessionStorage.setItem('ops-test-user',JSON.stringify(user));observer(user);}
export async function logout(){sessionStorage.removeItem('ops-test-user');observer?.(null);}
export const beginEnrollment=async()=>{if(window.__totpDisabled)throw Object.assign(Error('TOTP not enabled'),{code:'auth/operation-not-allowed'});return{secret:'ISOLATED-TEST-TOTP-SECRET'};};
export async function finishEnrollment(){await logout();}
export async function api(action,payload={},requestId){const response=await window.__ops({action,payload,requestId,user:current()});if(response.error)throw Object.assign(Error(response.error.message),{code:response.error.code});return response.data;}
`;
(async()=>{
 const f=await fixture();f.clock(Date.now());let writes=0;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/game-admin/site/runtime.js*',route=>route.fulfill({contentType:'text/javascript',body:mockRuntime}));
  await context.exposeFunction('__ops',async op=>{
   if(op.action.startsWith('save'))writes++;
   f.clock(Date.now());
   try{return{data:await f.service.adminAPI({auth:op.user?{uid:op.user.uid,token:{role:op.user.admin?'admin':'player',firebase:op.user.mfa?{sign_in_second_factor:'totp'}:{}}}:null,data:{action:op.action,payload:op.payload,requestId:op.requestId}})};}catch(error){return{error:{code:'functions/'+error.code,message:error.message}};}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(12000);
  await page.goto(base+'/index.html');await page.waitForURL('**/login.html');
  await page.fill('#email','player@example.test');await page.fill('#password','isolated-only');await page.click('#loginForm button');await page.getByText('此帳號不是遊戲管理員，無法進入管理功能。').waitFor();
  await page.fill('#email','plain@example.test');await page.fill('#password','isolated-only');await page.click('#loginForm button');
  await page.waitForURL('**/index.html');await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);
  await page.click('#manageMfa');await page.locator('#enrollment').waitFor({state:'visible'});
  await page.evaluate(()=>window.__totpDisabled=true);await page.click('#beginEnrollment');
  await page.getByText('Firebase 尚未啟用此驗證方式；MFA 為選用，可返回管理中心繼續使用。').waitFor();
  await page.click('#backToAdmin');await page.waitForURL('**/index.html');await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);
  await page.click('#logout');await page.waitForURL('**/login.html');
  await page.fill('#email','operator@example.test');await page.fill('#password','wrong');await page.click('#loginForm button');await page.getByText('登入失敗，請確認帳號或密碼。').waitFor();
  await page.fill('#password','isolated-only');await page.click('#loginForm button');await page.locator('#mfaForm').waitFor({state:'visible'});
  await page.fill('#mfaCode','000000');await page.click('#mfaForm button');await page.getByText('驗證碼不正確，請重新輸入。').waitFor();
  await page.fill('#mfaCode','123456');await page.click('#mfaForm button');await page.waitForURL('**/index.html');await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);
  assert.equal(await page.locator('.metric-value').first().innerText(),'3');await page.screenshot({path:'/tmp/nexus-admin-dashboard-desktop.png'});
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);
  await page.click('[data-view=announcements]');await page.click('#createButton');await page.fill('[name=title]','測試公告 <img src=x onerror=alert(1)>');await page.fill('[name=content]','維護公告\n<script>window.hacked=true</script>');await page.click('#previewButton');
  assert.equal(await page.locator('#previewContent img,#previewContent script').count(),0);assert.ok((await page.locator('#previewContent').innerText()).includes('<script>'));
  await page.click('#closePreview');const before=writes;await page.locator('#saveDraft').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(writes,before+1);await page.locator('#listTable .pill').filter({hasText:'草稿'}).waitFor();
  await page.getByRole('button',{name:'立即發布',exact:true}).click();await page.getByText('狀態已更新',{exact:true}).waitFor();assert.equal((await f.db.collection('ops_announcements').get()).docs[0].data().status,'published');
  await page.getByRole('button',{name:'下架',exact:true}).click();await page.getByText('狀態已更新',{exact:true}).waitFor();assert.equal((await f.db.collection('ops_announcements').get()).docs[0].data().status,'archived');
  await page.click('[data-view=notifications]');await page.click('#createButton');
  await page.fill('[name=title]','系統通知測試');await page.fill('[name=content]','安全的系統訊息 <img src=x>');
  await page.selectOption('[name=targetType]','accounts');await page.fill('[name=targetAccountIds]','alice,bob');await page.selectOption('[name=status]','published');
  await page.click('#publishButton');await page.locator('#editor').waitFor({state:'hidden'});await page.getByText('系統通知測試',{exact:true}).waitFor();
  let notification=(await f.db.collection('ops_notifications').get()).docs[0];assert.deepEqual(notification.data().targetAccountIds,['alice','bob']);
  await page.getByRole('button',{name:'編輯',exact:true}).click();await page.selectOption('[name=targetType]','all');await page.fill('[name=targetAccountIds]','');await page.click('#publishButton');await page.locator('#editor').waitFor({state:'hidden'});
  assert.equal((await f.db.doc('ops_notifications/'+notification.id).get()).data().targetType,'all');
  await page.getByRole('button',{name:'下架',exact:true}).click();await page.getByText('狀態已更新',{exact:true}).waitFor();assert.equal((await f.db.doc('ops_notifications/'+notification.id).get()).data().status,'archived');
  await page.click('[data-view=gifts]');await page.click('#createButton');await page.fill('[name=name]','夏日農場禮包');await page.fill('[name=description]','安全測試');await page.fill('[name=code]','BROWSER2026');await page.selectOption('[name=status]','active');await page.click('#publishButton');await page.locator('#codeDialog').waitFor({state:'visible'});assert.equal(await page.locator('#codeDialog output').innerText(),'BROWSER2026');await page.getByRole('button',{name:'已保存，關閉'}).click();
  await page.getByRole('button',{name:'停用',exact:true}).click();await page.getByText('狀態已更新',{exact:true}).waitFor();assert.equal((await f.db.collection('ops_gifts').get()).docs[0].data().status,'inactive');
  await page.click('[data-view=audit]');await page.waitForSelector('#listTable tbody tr');assert.ok(await page.locator('#listTable tbody tr').count()>0);await page.locator('#listTable button').first().click();assert.ok((await page.locator('#previewContent').innerText()).includes('adminUid'));assert.ok(!(await page.locator('#previewContent').innerText()).includes('BROWSER2026'));await page.click('#closePreview');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.click('#menuButton');await page.click('[data-view=dashboard]');await page.waitForFunction(()=>document.querySelectorAll('.metric').length===6);await page.screenshot({path:'/tmp/nexus-admin-dashboard-mobile.png'});
  await page.click('#menuButton');await page.click('[data-view=gifts]');await page.click('#createButton');await page.screenshot({path:'/tmp/nexus-admin-gift-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.click('#closeEditor');
  await page.click('#logout');await page.waitForURL('**/login.html');assert.equal(await page.evaluate(()=>sessionStorage.getItem('ops-test-user')),null);
  assert.deepEqual(errors,[]);console.log('PASS admin UI: unauthenticated redirect, player denied, invalid login, password-only admin login, optional MFA settings and disabled-provider recovery, enrolled MFA challenge/error, session restore, dashboard API data, announcements draft/publish/archive, XSS-safe preview, gift create/disable, audits, desktop/mobile, logout');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
