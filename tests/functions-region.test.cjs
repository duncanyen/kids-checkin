const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const live=['nexusIdentity','photoSession','liveSession','growthForest'];
const ops=['gameOpsAdmin','gameOpsAnnouncements','gameOpsFarmTransaction','gameOpsGuardDog','gameOpsDailyChallenges','gameOpsRedeem'];
function endpoints(file,emulator){
 const code=`const f=require('./${file}');console.log(JSON.stringify(Object.fromEntries(Object.entries(f).map(([k,v])=>[k,{region:v.__endpoint.region,callable:!!v.__endpoint.callableTrigger,event:!!v.__endpoint.eventTrigger}]))));`;
 return JSON.parse(execFileSync(process.execPath,['-e',code],{cwd:root,encoding:'utf8',env:{...process.env,FUNCTIONS_EMULATOR:String(emulator)}}));
}
for(const emulator of [false,true])test(`deployment metadata: ${emulator?'Emulator keeps original endpoints':'ten callables serve both regions; seven triggers remain single-region'}`,()=>{
 let triggerCount=0;
 for(const [file,names] of [['functions/index.cjs',live],['game-admin/functions/index.cjs',ops]]){
  const rows=endpoints(file,emulator);
  for(const name of names){assert.equal(rows[name].callable,true,name);assert.deepEqual(rows[name].region,emulator?['asia-southeast1']:['asia-southeast1','asia-east1'],name);}
  for(const [name,row] of Object.entries(rows))if(!names.includes(name)){assert.equal(row.event,true,name);assert.deepEqual(row.region,['asia-southeast1'],name);triggerCount++;}
 }
 assert.equal(triggerCount,7);
});

test('production clients select Taiwan without moving RTDB; admin Emulator retains old endpoints',()=>{
 const fs=require('node:fs');
 for(const file of ['js/private-auth-client.js','js/farm/operations-client.js','js/growth-forest/cloud-client.js','js/personal-ledger.js','js/gallery-storage.js','js/live-read-config.js','game-admin/site/config.js']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(source.includes("'asia-east1'"),file);
  assert.ok(!source.includes('asia-southeast1'),file);
 }
 const runtime=fs.readFileSync(path.join(root,'game-admin/site/runtime.js'),'utf8');
 assert.ok(runtime.includes("getFunctions(app,localEmulator?'asia-southeast1':config.region)"));
 assert.ok(fs.readFileSync(path.join(root,'js/firebase-config.js'),'utf8').includes('https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app'));
});
