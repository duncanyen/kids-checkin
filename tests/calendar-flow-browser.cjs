// Isolated calendar workflow with the real page/module and in-memory Firebase.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const start=require('./helpers/navigation-performance-server.cjs');
const sdk=`
export const initializeApp=()=>({}),getFirestore=()=>({});
export const doc=(_, ...parts)=>({path:parts.join('/')}),collection=doc;
export const where=(field,op,value)=>({field,value}),query=(ref,...filters)=>({...ref,filters}),serverTimestamp=()=>1234;
window.__calendarListeners??=new Set();
function snapshot(ref){const docs=Object.entries(window.__events).filter(([path,data])=>path.startsWith(ref.path+'/')&&(ref.filters||[]).every(f=>data[f.field]===f.value)).map(([path,data])=>({id:path.split('/').at(-1),data:()=>structuredClone(data)}));return{forEach:fn=>docs.forEach(fn)};}
async function emit(){for(const listener of window.__calendarListeners)listener.callback(snapshot(listener.ref));}
export const onSnapshot=(ref,callback)=>{const listener={ref,callback};window.__calendarListeners.add(listener);setTimeout(()=>{if(window.__calendarListeners.has(listener)){callback(snapshot(ref));window.__calendarReady=true;}},20);return()=>window.__calendarListeners.delete(listener)};
export const addDoc=async(ref,data)=>{if(window.__failWrite)throw Error('offline');const id='new-'+(++window.__counter);window.__events[ref.path+'/'+id]=structuredClone(data);await emit();return{id};};
export const updateDoc=async(ref,data)=>{if(window.__failWrite)throw Error('offline');window.__events[ref.path]={...window.__events[ref.path],...data};await emit();};
export const deleteDoc=async ref=>{delete window.__events[ref.path];await emit();};
`;
(async()=>{
 const server=await start({overrides:{__sdk:sdk}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei',hasTouch:true});
 await context.addInitScript(()=>{
  sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'Alice',menus:['calendar']}));localStorage.setItem('lastGroupId','A');
  window.__events=JSON.parse(sessionStorage.getItem('calendarSeed')||'{}');window.__counter=0;
  if(!sessionStorage.getItem('skipCalendarTarget'))localStorage.setItem('calendar_target_date','2026-11-18');
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(10000);
 await page.clock.setFixedTime(new Date('2026-11-18T04:00:00Z'));
 await page.goto(server.base+'/calendar.html?nav=1');await page.waitForFunction(()=>window.__calendarReady);
 assert.equal(await page.locator('#eventModal').isVisible(),false,'no agenda must not open a modal');
 assert.equal(await page.evaluate(()=>localStorage.getItem('calendar_target_date')),null);
 await page.click('#btnToggleView');await page.click('#btnToggleView');
 assert.equal(await page.locator('#calendarTitle').innerText(),'2026-11-18');
 // Selecting a day must become the context when switching into day view.
 await page.click('#btnToggleView');await page.locator('#calendarGrid .date-num').filter({hasText:/^25$/}).click();
 await page.click('#btnCloseModal');await page.click('#btnToggleView');await page.click('#btnToggleView');
 assert.equal(await page.locator('#calendarTitle').innerText(),'2026-11-25');
 await page.click('#btnAddCalendarEvent');
 assert.equal(await page.locator('#formView').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.activeElement?.matches('#formView input, #formView textarea, #formView select')),false,'opening the add form must not focus an input');
 assert.equal(await page.locator('#listView').isVisible(),false);
 assert.equal(await page.inputValue('#evDate'),'2026-11-18');
 assert.equal(await page.locator('#formView input').first().getAttribute('type'),'date');
 await page.click('#btnCancelForm');assert.equal(await page.locator('#eventModal').isVisible(),false);
 await page.click('#btnAddCalendarEvent');await page.fill('#evDate','2026-12-09');await page.fill('#evTitle','跨月行程');
 await page.evaluate(()=>window.__failWrite=true);await page.click('#btnSaveEvent');
 assert.equal(await page.inputValue('#evDate'),'2026-12-09');assert.equal(await page.inputValue('#evTitle'),'跨月行程');
 await page.evaluate(()=>window.__failWrite=false);await page.click('#btnSaveEvent');
 await page.waitForFunction(()=>document.getElementById('listView').style.display==='block');
 const saved=await page.evaluate(()=>Object.entries(__events).find(([key,value])=>key.startsWith('events/')&&value.title==='跨月行程'));
 assert.equal(saved[1].date,'2026-12-09');assert.equal(saved[1].groupId,'A');
 assert.equal(await page.locator('#calendarTitle').innerText(),'2026-12-09');
 // Editing keeps existing details while changing the event's date.
 await page.locator('.event-actions .edit').click();assert.equal(await page.inputValue('#evDate'),'2026-12-09');
 await page.fill('#evDate','2026-12-10');await page.click('#btnSaveEvent');await page.waitForFunction(()=>document.getElementById('listView').style.display==='block');
 assert.equal(await page.evaluate(key=>__events[key].date,saved[0]),'2026-12-10');await page.click('#btnCloseModal');
 // The add button clears the navigation bar on small and wide screens.
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  const fab=await page.locator('#btnAddCalendarEvent').boundingBox(),nav=await page.locator('#appNavigation').boundingBox();
  assert.ok(fab.y+fab.height<=nav.y);assert.ok(fab.x>=0&&fab.x+fab.width<=width);
 }
 // Native date/time inputs remain compact and inside the modal at narrow widths.
 for(const width of [320,390,768])for(const scale of [1,1.3]){
  await page.setViewportSize({width,height:844});await page.evaluate(scale=>document.documentElement.style.setProperty('--n-font-scale',scale),scale);await page.click('#btnAddCalendarEvent');
  const allDay=page.locator('#evIsAllDay');if(await allDay.isChecked())await allDay.uncheck();await page.fill('#evDate','2026-12-31');await page.fill('#evStartTime','23:00');await page.fill('#evEndTime','23:59');
  await page.waitForTimeout(350);
  const bounds=await page.evaluate(()=>{const body=document.querySelector('#eventModal .modal-body'),box=body.getBoundingClientRect();return{left:box.left,right:box.right,clientWidth:body.clientWidth,scrollWidth:body.scrollWidth,fields:['evDate','evStartTime','evEndTime','evCategory','evVisibility'].map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect();return{id,x:r.left,right:r.right,width:r.width,value:el.value};})};});
  assert.ok(bounds.scrollWidth<=bounds.clientWidth+1,'form must not scroll horizontally');for(const field of bounds.fields){assert.ok(field.x>=bounds.left-1&&field.right<=bounds.right+1,field.id+' stays inside the modal');if(field.id==='evDate')assert.ok(field.width<240);if(field.id.includes('Time'))assert.ok(field.width<200);}
  assert.equal(await page.inputValue('#evDate'),'2026-12-31');assert.equal(await page.inputValue('#evStartTime'),'23:00');assert.equal(await page.inputValue('#evEndTime'),'23:59');if(width===320&&scale===1.3)await page.screenshot({path:'/tmp/nexus-calendar-compact-fields.png',fullPage:true});await page.click('#btnCancelForm');
 }
 await page.evaluate(()=>document.documentElement.style.removeProperty('--n-font-scale'));
 // A populated agenda still opens the requested day's details and keeps that day.
 await page.evaluate(()=>sessionStorage.setItem('calendarSeed',JSON.stringify({'events/existing':{groupId:'A',date:'2026-11-18',title:'今日行程',operator:'Alice',visibility:'public',isAllDay:true}})));
 await page.reload();await page.waitForFunction(()=>window.__calendarReady);await page.waitForSelector('.event-item');
 assert.match(await page.locator('#modalDateTitle').innerText(),/2026-11-18/);await page.click('#btnCloseModal');
 await page.click('#btnToggleView');await page.click('#btnToggleView');assert.equal(await page.locator('#calendarTitle').innerText(),'2026-11-18');
 // Month navigation clamps Jan 31 to Feb 28, then day view keeps that date.
 await page.click('#btnAddCalendarEvent');await page.fill('#evDate','2027-01-31');await page.fill('#evTitle','月底行程');await page.click('#btnSaveEvent');
 await page.waitForFunction(()=>document.getElementById('listView').style.display==='block');await page.click('#btnCloseModal');await page.click('#btnToggleView');
 await page.evaluate(()=>{
  const root=document.getElementById('calendarSwipeContainer');
  for(const [type,x] of [['touchstart',300],['touchend',0]]){const event=new Event(type);Object.defineProperty(event,'changedTouches',{value:[{screenX:x}]});root.dispatchEvent(event);}
 });
 await page.click('#btnToggleView');await page.click('#btnToggleView');assert.equal(await page.locator('#calendarTitle').innerText(),'2027-02-28');
 assert.deepEqual(errors,[]);
 console.log('PASS: empty agenda navigation, full target date, selected-day view, direct add/date default, date-first form, cancel, save retry, cross-month create/edit, and mobile FAB clearance.');
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
