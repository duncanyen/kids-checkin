const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('farm-daily-sw.js','utf8');
async function run(caches,url='https://example.test/kids-checkin/assets/farm/daily-missions/v2/hen.png'){
 const handlers={},response={ok:true,type:'basic',clone(){return this;}},requests=[];
 const self={location:{href:'https://example.test/kids-checkin/farm-daily-sw.js?v=test'},addEventListener:(name,handler)=>handlers[name]=handler};
 vm.runInNewContext(source,{self,caches,URL,Request,fetch:async request=>{requests.push(request);return response;}});
 let served;handlers.fetch({request:new Request(url),respondWith:value=>served=value});
 return{served:await served,response,requests};
}
test('private-mode cache reads and quota write failures keep successful HTTP images usable',async()=>{
 const read=await run({open:async()=>{throw Error('storage denied');}});assert.equal(read.served,read.response);assert.equal(read.requests.length,1);
 const write=await run({open:async()=>({match:async()=>undefined,put:async()=>{throw Error('quota');}})});assert.equal(write.served,write.response);assert.equal(write.requests.length,1);
});
test('requests outside daily public PNGs never enter the worker cache',async()=>{
 for(const path of ['gameOpsDailyChallenges','assets/farm/daily-missions/v2/manifest.json','index.html']){
  const result=await run({open:async()=>{throw Error('must not use cache');}},'https://example.test/kids-checkin/'+path);
  assert.equal(result.served,undefined);assert.equal(result.requests.length,0);
 }
});
