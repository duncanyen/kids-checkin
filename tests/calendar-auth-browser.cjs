// Real calendar page with delayed default Auth restoration; isolated SDK only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const start=require('./helpers/navigation-performance-server.cjs');
let sdk=fs.readFileSync(require('node:path').resolve(__dirname,'fixtures/navigation-performance-sdk.js'),'utf8');
sdk=sdk.replace("export const initializeApp=(_,name='[DEFAULT]')=>({name})", "export const initializeApp=(_,name='[DEFAULT]')=>{window.__calendarAppCount=(window.__calendarAppCount||0)+1;return{name}}")
 .replace('export const getAuth=()=>({authStateReady:async()=>{}})',"export const getAuth=()=>({authStateReady:()=>window.__calendarAuthPromise??=new Promise(resolve=>{window.__releaseCalendarAuth=()=>{window.__calendarAuthReady=true;resolve()}})})")
 .replace('export function onSnapshot(ref,next,error){',`export function onSnapshot(ref,next,error){
  if(ref.path==='events'){
   if(!window.__calendarAuthReady){window.__calendarPremature++;throw Object.assign(Error('premature read'),{code:'permission-denied'});}
   window.__calendarActive=(window.__calendarActive||0)+1;window.__calendarSnapshotError=error;let active=true;
   record('subscribe',ref);Promise.resolve().then(async()=>{if(!active)return;if(window.__calendarDeny)error(Object.assign(Error('denied'),{code:'permission-denied'}));else next(await getDocs(ref));});
   return()=>{if(active){active=false;window.__calendarActive--;record('unsubscribe',ref)}};
  }
 `)
 .replace('export const addDoc=async(ref,value)=>{',`export const addDoc=async(ref,value)=>{if(['logs','events'].includes(ref.path)&&!window.__calendarAuthReady){window.__calendarPremature++;throw Object.assign(Error('premature write'),{code:'permission-denied'})}`);
(async()=>{
 const server=await start({overrides:{__sdk:sdk}}),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Taipei'}),errors=[],consoleErrors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
  await page.addInitScript(()=>{
   sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'Alice',menus:['calendar']}));localStorage.setItem('lastGroupId','A');
   window.__perfOperations=[];window.__calendarPremature=0;window.__perfDataDelay=10;window.__perfStore={'groups/A':{members:['alice']},'events/a':{groupId:'A',date:'2026-11-17',operator:'Alice',title:'授權後的行程',visibility:'public',isAllDay:true}};
  });
  await page.clock.setFixedTime(new Date('2026-11-17T04:00:00Z'));
  await page.goto(server.base+'/calendar.html',{waitUntil:'commit'});await page.waitForFunction(()=>typeof window.__releaseCalendarAuth==='function');
  await page.waitForTimeout(150);await page.evaluate(()=>window.dispatchEvent(new Event('load')));
  assert.equal(await page.evaluate(()=>__perfOperations.filter(o=>['events','logs'].includes(o.path)).length),0,'no calendar subscription or audit before Auth');
  await page.evaluate(()=>__releaseCalendarAuth());await page.getByText('授權後的行程',{exact:true}).first().waitFor();
  await page.waitForFunction(()=>__perfOperations.some(o=>o.kind==='addDoc'&&o.path==='logs'));
  assert.equal(await page.evaluate(()=>__calendarAppCount),1);assert.equal(await page.evaluate(()=>__calendarPremature),0);assert.equal(await page.evaluate(()=>__calendarActive),1);
  // A real listener refusal must be handled, clear stale data and offer retry.
  await page.evaluate(()=>{__calendarDeny=true;__calendarSnapshotError(Object.assign(Error('denied'),{code:'permission-denied'}));});
  await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/權限已失效/);assert.equal(await page.getByText('授權後的行程',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>__calendarActive),0);
  await page.getByRole('button',{name:'重新讀取',exact:true}).click();await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>__calendarActive),0);
  await page.screenshot({path:'/tmp/nexus-calendar-permission-retry.png'});
  await page.evaluate(()=>__calendarDeny=false);await page.getByRole('button',{name:'重新讀取',exact:true}).click();await page.getByText('授權後的行程',{exact:true}).first().waitFor();assert.equal(await page.evaluate(()=>__calendarActive),1);assert.equal(await page.getByRole('alert').count(),0);
  for(let n=0;n<3;n++){await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));assert.equal(await page.evaluate(()=>__calendarActive),0);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.waitForFunction(()=>__calendarActive===1);}
  assert.equal(await page.evaluate(()=>__perfOperations.filter(o=>o.kind==='addDoc'&&o.path==='logs').length),1);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  await page.screenshot({path:'/tmp/nexus-calendar-auth-restored.png'});
  console.log('PASS calendar Auth restoration gates events/log writes; one shared app; permission error clears stale data; retry and bfcache keep one listener and one browse log');
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
