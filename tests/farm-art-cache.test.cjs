const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build}=require('../scripts/build-farm-art-cache.cjs');
test('public-art manifest matches file contents and excludes code, saves and APIs',()=>{
 const actual=JSON.parse(fs.readFileSync('assets/farm/cache-manifest.json'));assert.deepEqual(actual,build(),'run node scripts/build-farm-art-cache.cjs after changing art');
 for(const file of Object.keys(actual.files))assert.match(file,/^assets\/farm\/.+\.(png|webp|jpe?g|gif|svg|json)$/i);
 assert.ok(actual.files['assets/farm/hen-sheet.json']);assert.ok(actual.files['assets/farm/farm-map.jpg']);
 assert.ok(!Object.keys(actual.files).some(file=>/\.js$|firebase|groups\/|ops_/.test(file)));
});
async function worker({denied=false,quota=false}={}){
 const handlers={},files={'assets/farm/coin.png':'a'.repeat(20)},requests=[],puts=[];
 const self={location:{href:'https://example.test/kids-checkin/farm-daily-sw.js?art='+('b'.repeat(20))},addEventListener:(name,fn)=>handlers[name]=fn};
 const caches={open:async()=>{if(denied)throw Error('private mode');return{match:async()=>undefined,put:async(key)=>{puts.push(String(key));if(quota)throw Error('quota');}};}};
 const fetch=async req=>{const url=typeof req==='string'?req:req.url;requests.push(url);return new Response(url.includes('cache-manifest.json')?JSON.stringify({version:1,revision:'b'.repeat(20),files}):'pixels');};
 vm.runInNewContext(fs.readFileSync('js/farm/public-art-worker.js','utf8'),{self,caches,URL,Request,Response,fetch,Map,Promise,Error,Object});
 async function get(path,options){let result;handlers.fetch({request:new Request(new URL(path,'https://example.test/kids-checkin/'),options),respondWith:p=>result=p});return result?await result:null;}
 return{get,requests,puts};
}
test('private-mode and quota failures preserve successful public image responses',async()=>{
 for(const flags of [{denied:true},{quota:true}]){const w=await worker(flags),response=await w.get('assets/farm/coin.png');assert.equal(await response.text(),'pixels');assert.match(w.requests.at(-1),/coin\.png\?v=a{20}$/);}
});
test('HTML, JavaScript, private/API requests and POST never enter the art cache',async()=>{
 const w=await worker();for(const file of ['farmgame.html','index.html','js/farm/main.js','gameOpsFarmTransaction','groups/A/users/alice','daily-api'])assert.equal(await w.get(file),null);
 assert.equal(await w.get('assets/farm/coin.png',{method:'POST'}),null);assert.equal(w.requests.length,0);
 await w.get('assets/farm/unknown.png');assert.equal(w.puts.filter(key=>key.includes('unknown')).length,0);
});
test('catalogues retain item, hen and dog art without full combat atlases',async()=>{
 const {ALL_ASSETS,SCENE_ASSETS,CATALOG_ASSETS}=await import('../js/farm/asset-manifest.js');
 for(const key of ['wolf','tiger','dragon','gorilla','eagle','cobra','mole','giant','hornet','arrow'])assert.ok(!CATALOG_ASSETS.includes(key),key);
 for(const key of ['hen','silkie','bresse','onagadori','egg','coin','honey','katana','chest_inventory','guard_dog','guard_corgi','ancient_stone','sweet_potato','ironhammer'])assert.ok(CATALOG_ASSETS.includes(key),key);
 assert.equal(SCENE_ASSETS.ShopScene,CATALOG_ASSETS);assert.equal(SCENE_ASSETS.WarehouseScene,CATALOG_ASSETS);
 assert.equal(SCENE_ASSETS.VisitScene,ALL_ASSETS,'all encounter art is still prepared before starting a server-authorized visit');
});
test('optional worker startup wait is bounded and failures fall back to normal loading',async()=>{
 const {artCacheStartup,prepareFarmArtCache}=await import('../js/farm/public-art-cache.js');
 assert.equal(await prepareFarmArtCache(),false);
 assert.equal(await artCacheStartup(Promise.resolve(true)),true);
 assert.equal(await artCacheStartup(Promise.reject(Error('offline'))),false);
 assert.equal(await artCacheStartup(new Promise(()=>{}),5),false);
});
