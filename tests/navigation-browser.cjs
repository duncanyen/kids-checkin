const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1)});
export const collection=doc,query=ref=>ref,where=()=>({}),orderBy=()=>({}),limit=()=>({});
export const increment=n=>n;export const initializeApp=()=>({});export const getFirestore=()=>({});export const arrayUnion=(...values)=>values,arrayRemove=(...values)=>values;export const serverTimestamp=()=>1234;
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
 await context.route('https://ui-avatars.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#eee"/></svg>'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await context.route('**/js/gallery-storage.js',r=>r.fulfill({contentType:'text/javascript',body:'export const uploadPhotoPost=async()=>({}),removePhotoFiles=async()=>{};'}));
 await context.route('https://cdn.jsdelivr.net/npm/chart.js',r=>r.fulfill({contentType:'text/javascript',body:'window.Chart=class {constructor(ctx){if(ctx?.canvas)ctx.canvas.style.maxWidth="100%";}destroy(){}};'}));
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',avatar:'Nexus.png',groupId:'A',menus:['chat','calendar','finance','todo','photodump','gamezone','wishlist','food']}));
  localStorage.setItem('lastGroupId','A');sessionStorage.setItem('nexus_active_group_id','A');
  window.__docs=JSON.parse(localStorage.getItem('__themeMockDocs')||'null')||{'groups/A':{members:['alice'],name:'我們的日常'},'userSettings/alice':{accountId:'alice',order:['todo','food'],navigation:{items:['calendar','chat','finance','todo','photodump','food']},modules:{todo:true,food:true},appearance:{theme:'honey'}}};window.__writes=[];
 });
 await page.goto(base+'/settings.html');
 await page.waitForSelector('[data-nav-options] input');
 assert.equal(await page.locator('[data-nav-options] input:checked').count(),6);
 assert.equal(await page.locator('[data-nav-options] input[value=gamezone]').isDisabled(),true);
 await page.locator('[data-nav-options] input[value=food]').uncheck();
 await page.locator('[data-nav-options] input[value=gamezone]').check();
 await page.getByRole('button',{name:'聊天室上移',exact:true}).click();
 await page.evaluate(()=>window.__failSave=true);await page.locator('[data-nav-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-nav-status]').textContent.includes('失敗'));
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('nexus.navigation.v1:alice')).items),['calendar','chat','finance','todo','photodump','food']);
 await page.evaluate(()=>window.__failSave=false);await page.locator('[data-nav-save]').click();
 await page.waitForFunction(()=>document.querySelector('[data-nav-status]').textContent.includes('已儲存'));
 const data=await page.evaluate(()=>window.__docs['userSettings/alice']);
 assert.equal(data.appearance.theme,'honey');assert.deepEqual(data.order,['todo','food']);assert.equal(data.modules.food,true);
 assert.deepEqual(data.navigation.items,['chat','calendar','finance','todo','photodump','gamezone']);
 await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof window.renderDynamicModules==='function');
 await page.evaluate(async()=>{window.hideAllSections();await window.renderDynamicModules(JSON.parse(sessionStorage.getItem('familyCheckInUser')));document.getElementById('dashboardView').style.display='block';document.getElementById('loadingView').style.display='none';});
 assert.equal(await page.locator('.app-nav-link').count(),7);
 assert.equal(await page.locator('[aria-current=page]').getAttribute('data-nav-feature'),'home');
 await page.screenshot({path:'/tmp/nexus-navigation-home.png',animations:'disabled'});
 const paths={calendar:'calendar.html',chat:'chat.html',finance:'expense.html',photodump:'gallery.html',todo:'todo.html',wishlist:'wishwall.html',food:'food-decision.html'};
 for(const [id,path] of Object.entries(paths)){
  await page.goto(base+'/'+path+'?nav=1');
  await page.waitForSelector('.app-bottom-navigation',{timeout:5000}).catch(()=>{throw Error(id+' '+page.url()+' '+JSON.stringify(errors));});
  assert.equal(await page.locator('[data-main-menu-back]').isVisible(),false,id+' return button should be hidden');
  const bar=await page.locator('.app-bottom-navigation').boundingBox();assert.ok(Math.abs(bar.y+bar.height-844)<2,id+' bar must touch screen bottom');
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error(id+' horizontal overflow '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+2).slice(0,10).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})))));
  if(['calendar','chat','finance','photodump','todo'].includes(id))assert.equal(await page.locator('.app-nav-link[aria-current=page]').getAttribute('data-nav-feature'),id);
  if(id==='finance')assert.equal(await page.locator('.page-title').innerText(),'記帳本');
  if(id==='todo'){
   const actions=await page.locator('.fixed-bottom-bar').boundingBox();assert.ok(actions.y+actions.height<=bar.y+1,'Todo add action obscured');
  }
  if(id==='photodump'){
   const fab=await page.locator('.fab-container').boundingBox();assert.ok(fab.y+fab.height<=bar.y,'Gallery create action obscured');
  }
  if(id==='food'){
   assert.equal(await page.locator('.app > .nav').evaluate(el=>getComputedStyle(el).position),'static');
   await page.screenshot({path:'/tmp/nexus-navigation-food.png',animations:'disabled'});
  }
 }
 // Actual anchor routing, current marker, game lobby exception and return to home.
 await page.goto(base+'/calendar.html?nav=1');await page.waitForSelector('.app-nav-link[data-nav-feature=chat]');
 await page.locator('.app-nav-link[data-nav-feature=chat]').click();await page.waitForURL('**/chat.html?nav=1');await page.waitForSelector('.app-nav-link[data-nav-feature=gamezone]');
 await page.locator('.app-nav-link[data-nav-feature=gamezone]').click();await page.waitForURL('**/games.html?nav=1');
 assert.equal(await page.locator('.app-bottom-navigation').count(),0);assert.equal(await page.locator('#btnBack').isVisible(),true);assert.equal(await page.locator('#gameLobby').isVisible(),true);
 for(const path of ['calendar.html','expense.html','todo.html','food-decision.html']){
  await page.goto(base+'/'+path);await page.waitForSelector('[data-main-menu-back]');assert.equal(await page.locator('[data-main-menu-back]').innerText(),'返回主選單');assert.equal(await page.locator('.app-bottom-navigation').count(),0);
 }
 // Other accounts do not inherit Alice's six shortcuts.
 await page.evaluate(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'bob',menus:['food']})));
 await page.goto(base+'/food-decision.html?nav=1');await page.waitForSelector('.app-bottom-navigation');
 assert.equal(await page.locator('.app-nav-link').count(),2);assert.equal(await page.locator('[data-nav-feature=calendar]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: six-item settings, retry and field preservation, account/permission isolation, seven feature shells, real anchor navigation, active state, unobscured actions, return labels and game lobby exception.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
