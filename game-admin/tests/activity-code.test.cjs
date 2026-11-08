const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture.cjs');
test('announcement and system-notification codes are optional, validated, editable and included only in eligible feeds',async()=>{
 const f=await fixture();
 for(const [action,channel]of [['saveAnnouncement','announcements'],['saveNotification','notifications']]){
  const made=await f.admin(action,f.announcement({status:'published',activityCode:'test-２０２６',targetType:'accounts',targetAccountIds:['alice']}));
  assert.equal(made.record.activityCode,'TEST2026');
  const feed=name=>f.service.announcements({...f.request(name),data:{groupId:'A',channel}});
  assert.equal((await feed('alice')).rows[0].activityCode,'TEST2026');assert.equal((await feed('bob')).rows.length,0);
  await f.admin(action,{...made.record,id:made.id,activityCode:''});assert.equal((await feed('alice')).rows[0].activityCode,'');
  await assert.rejects(f.admin(action,f.announcement({activityCode:'<script>alert(1)</script>'})),{code:'invalid-argument'});
 }
});
