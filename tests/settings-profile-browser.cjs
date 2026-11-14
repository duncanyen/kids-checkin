// Isolated profile-update regression; no production Firebase requests.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.SETTINGS_BASE_URL || 'http://127.0.0.1:8012';
const sdk = `
export const doc=(_, ...parts)=>({path:parts.join('/')}),collection=doc;
export const where=(field,op,value)=>({field,value}),query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>1234;
export const getDoc=async ref=>({exists:()=>!!window.__docs[ref.path],data:()=>structuredClone(window.__docs[ref.path])});
export const getDocs=async ref=>{const docs=Object.entries(window.__docs).filter(([path,data])=>path.startsWith(ref.path+'/')&&(ref.filters||[]).every(f=>data[f.field]===f.value)).map(([path,data])=>({ref:{path},data:()=>structuredClone(data)}));return{docs,empty:!docs.length};};
export const setDoc=async(ref,data)=>{window.__docs[ref.path]={...window.__docs[ref.path],...data};};
export const updateDoc=async(ref,data)=>{if(window.__failUpdate)throw Error('offline');window.__docs[ref.path]={...window.__docs[ref.path],...data};};
export const addDoc=async()=>({id:'log'}),deleteDoc=async()=>{},getFirestore=()=>({});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('**/js/identity-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=false;'}));
 await page.route('https://www.gstatic.com/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await page.route('**/js/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.addInitScript(()=>{
  const user={accountId:'alice',name:'原名稱',pin:'1234',menus:['todo']};
  sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('familyCheckInUser',JSON.stringify(user));
  window.__docs={'users/alice':user,'users/bob':{accountId:'bob',name:'別人的名稱'},'userSettings/alice':{accountId:'alice',order:['todo'],modules:{todo:true}}};
 });
 await page.goto(base+'/settings.html');await page.waitForFunction(()=>document.getElementById('settingsDisplayName').textContent==='原名稱');
 const save=page.getByRole('button',{name:'更新資料與密碼',exact:true});
 await page.fill('#settingsName','  新名稱  ');await page.fill('#oldPin','1234');
 await page.evaluate(()=>window.__failUpdate=true);await save.click();await page.waitForFunction(()=>document.getElementById('loadingView').style.display==='none');
 assert.equal(await page.locator('#settingsDisplayName').innerText(),'原名稱');
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).name),'原名稱');
 await page.evaluate(()=>window.__failUpdate=false);await save.click();await page.waitForFunction(()=>document.getElementById('settingsDisplayName').textContent==='新名稱');
 assert.equal(await page.evaluate(()=>window.__docs['users/alice'].name),'新名稱');
 assert.deepEqual(await page.evaluate(()=>window.__docs['users/alice'].nameHistory),['原名稱']);
 for(const storage of ['sessionStorage','localStorage'])assert.equal(await page.evaluate(key=>JSON.parse(window[key].getItem('familyCheckInUser')).name,storage),'新名稱');
 await page.fill('#settingsName','別人的名稱');await page.fill('#oldPin','1234');await save.click();await page.waitForFunction(()=>document.getElementById('loadingView').style.display==='none');
 assert.equal(await page.locator('#settingsDisplayName').innerText(),'新名稱');
 assert.deepEqual(errors,[]);
 console.log('PASS: saved name updates profile header immediately, trimmed names and caches agree, failed writes and duplicate names preserve the previous header.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
