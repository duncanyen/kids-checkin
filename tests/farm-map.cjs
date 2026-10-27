// Run the static server first, then: node tests/farm-map.cjs
// Requires Playwright, curl, and system Chromium. All Firebase operations are mocked.
// Transaction callbacks are never executed; tests count requests without writing data.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const p=await b.newPage({viewport:{width:390,height:960}}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>true,data:()=>({farm})}));return ()=>{};}
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{members:['render-test','neighbor-1','neighbor-2']}:{farm}});
 export const getDocs=async()=>({forEach:cb=>[{accountId:'render-test',name:'Self'},{accountId:'neighbor-1',name:'鄰居一'},{accountId:'neighbor-2',name:'鄰居二'}].forEach(data=>cb({data:()=>data}))});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
 export const runTransaction=async()=>{window.__transactionCount=(window.__transactionCount||0)+1;return false;};
 `}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);

 const checks=[];
 for(const key of ['MyFarmScene','VisitScene']) {
  if(key==='VisitScene'){
   await p.evaluate(()=>{Phaser.Math.Between=(min,max)=>max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'render-test',targetName:'Test'});});
   await p.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hensGroup?.length===2);
  }
  const map=await p.evaluate(key=>{
   const s=window.__farmGame.scene.getScene(key);
   const backgrounds=s.children.list.filter(o=>o.texture?.key==='farm_map');
   if(backgrounds.length!==1)throw Error('Farm map not loaded');
   const image=backgrounds[0];
   if(Math.abs(image.displayWidth/image.displayHeight-720/1280)>0.0001)throw Error('Map distorted');
   if(s.children.list.some(o=>['coop','garden_bed','cabbage'].includes(o.texture?.key)))throw Error('Duplicate painted coop or garden');
   if(s.gardenPlants.length!==42||s.gardenPlants.some(o=>!o.input?.enabled))throw Error('Painted cabbage hit zones missing');
   for(const h of s.hensGroup)if(h.getBounds().top<s.coop.getBounds().bottom||h.getBounds().bottom>s.gardenBounds.top)throw Error('Hen outside clearing');
   const farm=key==='MyFarmScene'?s.farmData:s.targetFarmData;
   farm.cleanliness=20;
   return {coop:{x:s.coop.x,y:s.coop.y},first:{x:s.gardenPlants[0].x,y:s.gardenPlants[0].y},last:{x:s.gardenPlants[41].x,y:s.gardenPlants[41].y},plants:s.gardenPlants.length};
  },key);
  const box=await p.locator('canvas').boundingBox();
  const click=async pos=>p.mouse.click(box.x+pos.x*box.width/390,box.y+pos.y*box.height/844);
  await click(map.coop);
  await p.waitForFunction(key=>window.__farmGame.scene.getScene(key).dialogContainer.visible,key);
  await p.evaluate(key=>window.__farmGame.scene.getScene(key).dialogContainer.setVisible(false),key);
  await p.evaluate(()=>{Phaser.Math.Between=(min,max)=>max===500?500:Math.ceil((min+max)/2);});
  for(const [index,point]of [[0,map.first],[41,map.last]]){
   await click(point);
   const animated=await p.evaluate(({key,index})=>window.__farmGame.scene.getScene(key).gardenPlants[index].isAnimating,{key,index});
   if(!animated)throw Error('Painted plant click failed');
   await p.waitForTimeout(300);
  }
  if(key==='MyFarmScene'){
   await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').prepareToLayEgg());
   await p.waitForTimeout(2300);
   await p.evaluate(()=>{
    const s=window.__farmGame.scene.getScene('MyFarmScene');
    if(s.hensGroup.some(h=>h.getBounds().top<s.coop.getBounds().bottom||h.getBounds().bottom>s.gardenBounds.top))throw Error('Egg laying moved hens outside clearing');
   });
  }
  if(process.env.FARM_SCREENSHOTS)await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/farm-map-'+key+'.png',fullPage:true});
  checks.push({scene:key,plants:map.plants,coopClick:'passed',plantClicks:'passed'});
 }
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({passed:true,checks,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
