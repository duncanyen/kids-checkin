const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1)});
export const collection=doc,query=ref=>ref,where=()=>({}),orderBy=()=>({}),limit=()=>({});
export const getFirestore=()=>({});export const serverTimestamp=()=>1234;
export const getDoc=async ref=>{if(window.__delayPreferences)await new Promise(resolve=>window.__releasePreferences=resolve);const data=window.__docs[ref.path];return{exists:()=>!!data,data:()=>structuredClone(data)};};
export const getDocs=async ref=>{const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||'null');const data=ref.path==='users'&&user?[{id:'alice-doc',data:()=>user}]:[];return {docs:data,empty:!data.length,forEach:cb=>data.forEach(cb)};};
export const onSnapshot=()=>()=>{};
export const addDoc=async()=>({id:'log'}),updateDoc=async()=>{},deleteDoc=async()=>{};
export const setDoc=async(ref,data,options)=>{window.__writes.push({path:ref.path,data,options});if(window.__failSave)throw Error('offline');window.__docs[ref.path]={...window.__docs[ref.path],...data};localStorage.setItem('__themeMockDocs',JSON.stringify(window.__docs));};
export const runTransaction=()=>{};export const getCountFromServer=async()=>({data:()=>({count:0})});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',groupId:'A',menus:['chat','food','todo','finance']}));
  window.__docs=JSON.parse(localStorage.getItem('__themeMockDocs')||'null')||{'groups/A':{members:['alice'],name:'我們的日常'},'userSettings/alice':{accountId:'alice',order:['todo','food'],modules:{todo:true,food:true},appearance:{theme:'honey'}}};window.__writes=[];
 });
 await page.goto(base+'/settings.html');
 await page.locator('#fontSizeSettings summary').click();
 const sample=page.locator('.font-size-preview h3');
 const baseSize=await sample.evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
 for(const size of [80,90,100,110,120]){
  await page.locator(`[data-font-size="${size}"]`).click();
  assert.equal(await page.evaluate(()=>NexusFontSize.current),size);
  assert.ok(Math.abs(await sample.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))-baseSize*size/100)<.1);
  assert.equal(await page.locator(`[data-font-size="${size}"]`).getAttribute('aria-checked'),'true');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.setViewportSize({width:320,height:720});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-font-cancel]').click();assert.equal(await page.evaluate(()=>NexusFontSize.current),100);
 await page.locator('#fontSizeRange').fill('110');
 assert.equal(await page.evaluate(()=>NexusFontSize.current),110);
 await page.evaluate(()=>window.__failSave=true);await page.locator('[data-font-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-font-status]').textContent.includes('尚未儲存'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('nexus.font-size.v1:alice')), '100');
 await page.evaluate(()=>window.__failSave=false);await page.locator('[data-font-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-font-status]').textContent.includes('已儲存'));
 const write=await page.evaluate(()=>__writes.at(-1));assert.deepEqual(write.data.appearance,{fontScale:110});assert.equal(write.options.merge,true);
 await page.reload();await page.locator('#fontSizeSettings summary').click();assert.equal(await page.evaluate(()=>NexusFontSize.current),110);
 await page.locator('[data-font-size="120"]').click();
 await page.locator('#appearanceSettings summary').click();await page.locator('[data-theme-id="grape"]').click();await page.locator('[data-theme-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-theme-status]').textContent.includes('已儲存'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('nexus.font-size.v1:alice')),'110');
 await page.locator('[data-font-cancel]').click();
 for(const target of ['index.html','todo.html','food-decision.html']){
  await page.goto(base+'/'+target);assert.equal(await page.evaluate(()=>NexusFontSize.current),110);
 }
 await page.evaluate(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'bob'}));NexusTheme.refresh();});
 assert.equal(await page.evaluate(()=>NexusFontSize.current),100);
 await page.evaluate(()=>{NexusFontSize.hydrate('alice',{fontScale:120});});assert.equal(await page.evaluate(()=>NexusFontSize.current),100);
 await page.evaluate(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',groupId:'A',menus:['todo','food']})));
 await page.addInitScript(()=>window.__delayPreferences=true);
 await page.goto(base+'/settings.html',{waitUntil:'domcontentloaded'});
 await page.locator('#fontSizeSettings summary').click();
 await page.locator('[data-font-size="120"]').click();
 await page.waitForFunction(()=>typeof window.__releasePreferences==='function');
 await page.evaluate(()=>window.__releasePreferences());
 await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>NexusFontSize.current),120,'late cloud settings must preserve active preview');
 assert.deepEqual(errors,[]);
 console.log('PASS font scale five sizes, computed typography, slider, undo, save retry, cross-page persistence, theme coexistence, account isolation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
