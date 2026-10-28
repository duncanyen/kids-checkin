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
 await page.waitForSelector('.theme-option',{state:'attached'});
 await page.locator('#appearanceSettings summary').click();
 assert.equal(await page.locator('.theme-option').count(),10);
 for(const id of ['honey','walnut','terracotta','aqua','wisteria','citrus','sea','lapis','grape','evergreen']){
  await page.locator(`[data-theme-id=${id}]`).click();
  assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),id);
  assert.equal(await page.locator(`[data-theme-id=${id}]`).getAttribute('aria-checked'),'true');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.locator('[data-theme-id=lapis]').click();
 await page.screenshot({path:'/tmp/nexus-settings-dark.png',fullPage:true,animations:'disabled'});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nexus.appearance.v1:alice')).theme),'honey');
 await page.locator('[data-theme-cancel]').click();assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),'honey');
 await page.locator('[data-theme-id=grape]').click();await page.evaluate(()=>window.__failSave=true);await page.locator('[data-theme-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-theme-status]').textContent.includes('尚未儲存'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nexus.appearance.v1:alice')).theme),'honey');
 await page.evaluate(()=>window.__failSave=false);await page.locator('[data-theme-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-theme-status]').textContent.includes('主題已儲存'));
 const persisted=await page.evaluate(()=>window.__docs['userSettings/alice']);
 assert.deepEqual(persisted.order,['todo','food']);assert.equal(persisted.modules.food,true);assert.equal(persisted.appearance.theme,'grape');
 await page.goto(base+'/todo.html');assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),'grape');
 const darkSurface=await page.locator('.nexus-card').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(darkSurface,'rgb(36, 30, 50)');
 await page.goto(base+'/index.html');
 // Isolate rendering from account verification/group data; use the actual main renderer.
 await page.waitForFunction(()=>typeof window.renderDynamicModules==='function');
 await page.evaluate(async()=>{window.hideAllSections();await window.renderDynamicModules(JSON.parse(sessionStorage.getItem('familyCheckInUser')));document.getElementById('dashUserName').textContent='小明';document.getElementById('dashUserAvatar').src='Nexus.png';document.getElementById('dashboardView').style.display='block';document.getElementById('authSection').style.display='none';document.getElementById('loadingView').style.display='none';});
 assert.ok(await page.locator('.mini-widget-icon .nexus-icon').count()>=3);
 assert.ok(await page.locator('.sidebar-icon .nexus-icon').count()>=7);
 await page.screenshot({path:'/tmp/nexus-home-dark.png',fullPage:true,animations:'disabled'});
 assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),'grape');
 await page.evaluate(()=>{window.NexusTheme.apply('honey');});
 await page.screenshot({path:'/tmp/nexus-home-light.png',fullPage:true,animations:'disabled'});
 const dock=await page.locator('.app-bottom-navigation').boundingBox();assert.ok(dock.y+dock.height>800,'Bottom navigation must stay at viewport bottom');
 await page.locator('.hamburger-btn').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('sidebar').classList.contains('active'));await page.screenshot({path:'/tmp/nexus-sidebar-light.png',animations:'disabled'});await page.keyboard.press('Escape');
 assert.equal(await page.locator('.hamburger-btn').getAttribute('aria-expanded'),'false');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#dashboardView').evaluate(el=>getComputedStyle(el).opacity),'1');
 await page.setViewportSize({width:1440,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'bob',name:'另一位',menus:['food']})));
 await page.goto(base+'/food-decision.html');assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),'honey');
 await page.goto(base+'/settings.html');await page.waitForSelector('.theme-option',{state:'attached'});await page.locator('#appearanceSettings summary').click();
 await page.locator('[data-theme-id=honey]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('html').getAttribute('data-nexus-theme'),'walnut');
 assert.deepEqual(errors,[]);
 console.log('PASS: ten previews, contrast palettes, cancel, failed/retried cloud save, layout preservation, cross-page persistence, account isolation, real home icons and keyboard choice.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
