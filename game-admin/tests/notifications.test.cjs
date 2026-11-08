const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,uid}=require('./fixture.cjs');
const feed=(f,name='alice')=>f.service.announcements({...f.request(name),data:{groupId:'A',channel:'notifications'}});

test('system notifications target all or selected accounts without appearing as announcements',async()=>{
 const f=await fixture();
 await f.admin('saveNotification',f.announcement({title:'全體系統通知',status:'published'}));
 const targeted=await f.admin('saveNotification',f.announcement({title:'指定帳號通知',status:'published',targetType:'accounts',targetAccountIds:['alice']}));
 assert.equal(targeted.record.notificationId,targeted.id);
 assert.deepEqual((await feed(f)).rows.map(r=>r.title).sort(),['全體系統通知','指定帳號通知']);
 assert.deepEqual((await feed(f,'bob')).rows.map(r=>r.title),['全體系統通知']);
 assert.equal((await f.service.announcements(f.request())).rows.length,0);
 const forged=f.request('bob');forged.data={groupId:'A',channel:'notifications',accountId:'alice'};
 assert.equal((await f.service.announcements(forged)).rows.length,1);
 const rows=(await f.admin('list',{kind:'notifications',search:'指定',status:'published'})).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].id,targeted.id);
});

test('notification draft, schedule, edit, expiry, archive, replay and audits use the trusted backend',async()=>{
 const f=await fixture(),payload=f.announcement({title:'排程系統通知'});
 const request={auth:f.adminAuth,data:{action:'saveNotification',payload,requestId:uid()}};
 const made=await f.service.adminAPI(request);
 assert.equal((await f.service.adminAPI(request)).id,made.id);
 assert.equal((await feed(f)).rows.length,0);
 const scheduled={...payload,id:made.id,status:'scheduled',startAt:f.now()+100,endAt:f.now()+200};
 await f.admin('saveNotification',scheduled);assert.equal((await feed(f)).rows.length,0);
 f.clock(100000100);assert.equal((await feed(f)).rows.length,1);
 assert.equal((await feed(f)).rows[0].audienceKeys,undefined);
 f.clock(100000200);assert.equal((await feed(f)).rows.length,0);
 await f.admin('saveNotification',{...scheduled,status:'archived'});assert.equal((await feed(f)).rows.length,0);
 const audits=(await f.admin('list',{kind:'audit'})).rows;
 assert.ok(audits.some(row=>row.action==='saveNotification'&&row.target==='ops_notifications/'+made.id&&row.before?.status==='scheduled'&&row.after.status==='archived'));
 await assert.rejects(f.admin('saveNotification',payload,{auth:null}),{code:'unauthenticated'});
 await assert.rejects(f.admin('saveNotification',payload,{auth:{uid:'alice',token:{role:'player'}}}),{code:'permission-denied'});
 const invalid=f.request();invalid.data.channel='audit';await assert.rejects(f.service.announcements(invalid),{code:'invalid-argument'});
});
