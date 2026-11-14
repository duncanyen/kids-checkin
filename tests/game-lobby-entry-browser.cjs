// 真實大廳與延遲群組驗證；Firebase 全部隔離，不連正式資料。
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.GAME_BASE_URL||'http://127.0.0.1:8032';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];let release,membership,farmEntries=0;
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&new URL(frame.url()).pathname==='/farmgame.html')farmEntries++;});
  const delayMembership=()=>{membership=new Promise(resolve=>release=resolve);};
  await page.exposeFunction('__waitGameMembership',()=>membership);
  await page.route('**/js/game-members.js',r=>r.fulfill({contentType:'text/javascript',body:'export const requireGameMembership=()=>window.__waitGameMembership();'}));
  await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
  await page.route('**/js/app-navigation.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/js/ui-icons.js',r=>r.fulfill({contentType:'text/javascript',body:'export const icon=()=>"";'}));
  await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
   export const doc=(_, ...parts)=>({path:parts.join('/')}),collection=doc,query=ref=>ref,where=()=>({}),orderBy=()=>({}),limit=()=>({});
   export const getDocs=async()=>({forEach:()=>{}}),setDoc=async()=>{},addDoc=async()=>({id:'fixture'}),serverTimestamp=()=>1;
   export const onSnapshot=(_,callback)=>{queueMicrotask(()=>callback({exists:()=>false}));return()=>{};};
  `}));
  await page.route('**/farmgame.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><a href="games.html" id="returnLobby">返回遊戲大廳</a>'}));
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'player',name:'Player',groupId:'A'}));localStorage.setItem('lastGroupId','A');});
  for(let visit=0;visit<2;visit++){
   delayMembership();
   if(visit===0)await page.goto(base+'/games.html');else await page.locator('#returnLobby').click();
   await page.locator('[data-game="farm"]').click();
   await page.waitForFunction(()=>document.querySelector('#gameLobbyStatus').textContent.includes('確認遊戲權限'));
   assert.equal(await page.evaluate(()=>typeof window.selectGame),'undefined');
   await page.locator('[data-game="farm"]').click();
   assert.equal(new URL(page.url()).pathname,'/games.html');
   release();await page.waitForURL('**/farmgame.html');
  }
  assert.equal(farmEntries,2,'初次及返回後各只導向村落一次');
  membership=Promise.resolve();await page.goto(base+'/games.html');
  await page.locator('[data-game="rps"]').click();await page.waitForFunction(()=>document.querySelector('#kidGameContainer').style.display==='block');
  await page.locator('#btnBack').click();await page.locator('[data-game="g2048"]').click();
  await page.waitForFunction(()=>document.querySelector('#g2048Container').style.display==='block');
  assert.equal(await page.locator('.g2048-cell').count(),16);
  await page.route('**/js/games.js',r=>r.fulfill({contentType:'text/javascript',body:"throw Error('fixture module failure');"}));
  await page.goto(base+'/games.html');
  await page.waitForFunction(()=>document.querySelector('#gameLobbyStatus').textContent.includes('載入失敗'));
  await page.locator('[data-game="farm"]').click();
  await page.waitForFunction(()=>document.querySelector('#gameLobbyStatus').textContent.includes('載入失敗'));
  assert.equal(new URL(page.url()).pathname,'/games.html');assert.deepEqual(errors,[]);
  console.log('PASS delayed membership, repeated clicks, farm/lobby return, RPS/2048 and handled module failure; no selectGame ReferenceError');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
