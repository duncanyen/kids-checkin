const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{createRequire}=require('node:module');
const backend=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {fixture,uid}=require('./fixture.cjs');
const {createService}=require('../functions/service.cjs');
const {createCallables}=require('../functions/callables.cjs');
const {initializeApp}=backend('firebase-admin/app'),{getAuth}=backend('firebase-admin/auth');
const express=backend('express');
initializeApp({projectId:'demo-nexus-ops'});
test('optional admin App Check preserves server authorization and enables announcement writes; read-only announcements authenticate players and redemption remains enforced',async()=>{
 const f=await fixture(),app=express();app.use(express.json());
 const handlers=createCallables(f.service,{emulator:false});
 for(const [name,handler]of Object.entries(handlers))app.all('/'+name,handler);
 app.all('/strictAdmin',createCallables(f.service,{adminAppCheckRequired:true,emulator:false}).gameOpsAdmin);
 app.all('/disabledAdmin',createCallables(createService({db:f.db,auth:{getUser:async()=>({disabled:true,customClaims:{role:'admin'}})}}),{emulator:false}).gameOpsAdmin);
 app.all('/disabledAnnouncements',createCallables(createService({db:f.db,auth:{getUser:async()=>({disabled:true})}}),{emulator:false}).gameOpsAnnouncements);
 const auth=getAuth(),previous=auth.verifyIdToken;
 auth.verifyIdToken=async token=>({uid:token==='player'?'alice':'admin',role:token==='player'?'player':'admin',photoAccountId:'alice',photoGroupId:'A'});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const call=async(name,token,data={action:'dashboard'})=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});
  return {status:response.status,body:await response.json()};
 };
 try{
  assert.equal((await call('gameOpsAdmin')).status,401);
  assert.equal((await call('gameOpsAdmin','player')).status,403);
  const dashboard=await call('gameOpsAdmin','admin');assert.equal(dashboard.status,200);assert.equal(dashboard.body.result.players,3);
  const saved=await call('gameOpsAdmin','admin',{action:'saveAnnouncement',payload:f.announcement({status:'published'}),requestId:uid()});
  assert.equal(saved.status,200);assert.ok(saved.body.result.id);
  assert.equal((await f.service.announcements(f.request())).rows.length,1);
  assert.equal((await f.admin('list',{kind:'audit'})).rows.length,1);
  assert.equal((await call('strictAdmin','admin')).status,401);
  assert.equal((await call('gameOpsAnnouncements',null,{groupId:'A'})).status,401);
  const feed=await call('gameOpsAnnouncements','player',{groupId:'A'});assert.equal(feed.status,200);assert.equal(feed.body.result.rows.length,1);
  await f.admin('saveAnnouncement',f.announcement({status:'published',targetType:'accounts',targetAccountIds:['bob']}));
  const privateFeed=await call('gameOpsAnnouncements','player',{groupId:'A',accountId:'bob'});
  assert.equal(privateFeed.status,200);assert.equal(privateFeed.body.result.rows.length,1,'forged accountId cannot read another player announcement');
  assert.equal((await call('gameOpsAnnouncements','player',{groupId:'not-a-member'})).status,403);
  assert.equal((await call('gameOpsRedeem','player')).status,401,'redemption still requires App Check');
  assert.equal((await call('disabledAdmin','admin')).status,403);
  assert.equal((await call('disabledAnnouncements','player',{groupId:'A'})).status,403);
  f.revoke();assert.equal((await call('gameOpsAdmin','admin')).status,403,'revoked current admin claim is denied');
 }finally{auth.verifyIdToken=previous;await new Promise(resolve=>server.close(resolve));}
});
