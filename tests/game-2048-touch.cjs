// GAME_BASE_URL=http://127.0.0.1:8012 node tests/game-2048-touch.cjs
// Real Android-style Chromium touch input; Firebase is replaced in memory.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.GAME_BASE_URL||'http://127.0.0.1:8012';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:412,height:820},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 export const doc=(_, ...parts)=>({path:parts.join('/')});export const collection=doc;export const query=ref=>ref;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});
 export const getDoc=async ref=>({exists:()=>ref.path==='groups/A',data:()=>({members:['player']})});
 export const getDocs=async()=>({empty:true,forEach:()=>{}});export const addDoc=async()=>({id:'mock'});export const serverTimestamp=()=>Date.now();
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>false,data:()=>({})}));return()=>{};}
 export const setDoc=async(ref,data)=>{(window.__scoreWrites||=[]).push({path:ref.path,data});};
 `}));
 await context.route('**/js/games.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text())+`
 window.__test2048={set(board){g2048Board=structuredClone(board);g2048Score=0;g2048GameOver=false;render2048Board();},get(){return{board:structuredClone(g2048Board),score:g2048Score,over:g2048GameOver};}};
 `});});
 await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'player',name:'Player',groupId:'A'}));localStorage.setItem('lastGroupId','A');});
 await page.goto(base+'/games.html');await page.waitForFunction(()=>window.__test2048);await page.evaluate(()=>{selectGame('g2048');document.body.style.minHeight='1400px';});
 const cdp=await context.newCDPSession(page);
 let navigationCount=0;page.on('framenavigated',f=>{if(f===page.mainFrame())navigationCount++;});
 const empty=()=>Array.from({length:4},()=>[0,0,0,0]);
 async function fixture(row,column){const board=empty();board[row][column]=128;await page.evaluate(board=>__test2048.set(board),board);}
 async function swipe(dx,dy,{cancel=false}={}){
  await page.locator('#g2048Board').scrollIntoViewIfNeeded();
  const box=await page.locator('#g2048Board').boundingBox();const x=box.x+box.width/2-dx/2,y=box.y+box.height/2-dy/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y:y+dy*i/6,id:1}]});await page.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  await page.waitForTimeout(80);
 }
 // Down first: the original Android failure must not trigger scrolling/refresh or cancel the move.
 for(const [direction,from,to,dx,dy] of [['down',[0,1],[3,1],0,110],['up',[3,1],[0,1],0,-110],['left',[1,3],[1,0],-110,0],['right',[1,0],[1,3],110,0]]){
  await fixture(...from);const beforeScroll=await page.evaluate(()=>scrollY);await swipe(dx,dy);
  const state=await page.evaluate(()=>__test2048.get());
  assert.equal(state.board[to[0]][to[1]],128,direction+' swipe must move its tile');
  assert.equal(state.board.flat().filter(Boolean).length,2,direction+' swipe must produce exactly one move/new tile');
  assert.equal(await page.evaluate(()=>scrollY),beforeScroll,direction+' swipe must not scroll the document');
 }
 assert.equal(navigationCount,0,'No pull-to-refresh or popup navigation');
 // A cancelled gesture and a tap do not move or seed an extra tile; the next swipe works.
 await fixture(0,1);await swipe(0,110,{cancel:true});assert.equal((await page.evaluate(()=>__test2048.get())).board[0][1],128);
 await swipe(2,3);assert.equal((await page.evaluate(()=>__test2048.get())).board.flat().filter(Boolean).length,1);
 await swipe(0,110);assert.equal((await page.evaluate(()=>__test2048.get())).board[3][1],128);
 // Merging downward keeps correct score and persists only in the selected group.
 const merge=empty();merge[0][0]=2;merge[1][0]=2;await page.evaluate(b=>__test2048.set(b),merge);await swipe(0,110);
 assert.equal((await page.evaluate(()=>__test2048.get())).board[3][0],4);assert.equal(await page.locator('#g2048Score').innerText(),'4');
 assert.ok((await page.evaluate(()=>window.__scoreWrites)).some(w=>w.path==='game_records_2048/A_Player'&&w.data.accountId==='player'&&w.data.bestScore===4));
 // No-op moves, repeated swipes, restart, and leaving/returning do not lock input.
 await fixture(3,1);await swipe(0,110);assert.equal((await page.evaluate(()=>__test2048.get())).board.flat().filter(Boolean).length,1);
 for(let i=0;i<6;i++)await swipe(i%2?-110:110,0);
 await page.click('.btn-restart-2048');assert.equal((await page.evaluate(()=>__test2048.get())).board.flat().filter(Boolean).length,2);
 await page.evaluate(()=>{returnToLobby();selectGame('g2048');});await fixture(0,1);await swipe(0,110);assert.equal((await page.evaluate(()=>__test2048.get())).board[3][1],128);
 // Multi-touch cancels a move and cannot leave the board stuck.
 await fixture(0,1);const box=await page.locator('#g2048Board').boundingBox();const x=box.x+100,y=box.y+100;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1},{x:x+60,y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+90,id:1},{x:x+60,y:y+90,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal((await page.evaluate(()=>__test2048.get())).board.flat().filter(Boolean).length,1);
 await swipe(0,110);assert.equal((await page.evaluate(()=>__test2048.get())).board[3][1],128);
 await fixture(0,1);await page.keyboard.press('ArrowDown');assert.equal((await page.evaluate(()=>__test2048.get())).board[3][1],128);
 assert.equal(await page.locator('#g2048Board').evaluate(el=>getComputedStyle(el).touchAction),'none');
 assert.deepEqual(errors,[]);
 console.log('PASS: Android real-touch down/up/left/right, no scrolling/refresh, cancellation/tap/multitouch recovery, merge/score/group storage, no-op/repeated moves/restart/lobby');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
