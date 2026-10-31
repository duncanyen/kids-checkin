import test from 'node:test';
import assert from 'node:assert/strict';
import {roomIdentity,roomHasMember,roomIdentityPatch,senderId,creatorId,readFor,unreadFor} from '../js/chat-identity-core.js';
const profiles=[{accountId:'alice',name:'新名字',nameHistory:['Alice']},{accountId:'bob',name:'Bob'}];
test('legacy migration freezes identities and preserves read/unread across renames',()=>{
 const legacy={participants:['Alice','Bob'],creator:'Alice',unreadCount:{Alice:4,Bob:2},readTimestamps:{Alice:123,Bob:456}};
 const room={...legacy,...roomIdentityPatch(legacy,profiles)};
 assert.deepEqual(room.participantIds,['alice','bob']);assert.equal(creatorId(room,profiles),'alice');
 assert.equal(unreadFor(room,'alice',profiles),4);assert.equal(readFor(room,'alice',profiles),123);
 const renamed=[{accountId:'alice',name:'第三個名字'},{accountId:'bob',name:'另一個名字'}];
 assert.equal(roomHasMember(room,'alice',renamed),true);
 assert.equal(senderId({sender:'Alice'},room,renamed),'alice');
 assert.equal(senderId({sender:'第三個名字',senderAccountId:'bob'},room,renamed),'bob');
});
test('canonical removals never fall back to names; homonyms cannot inherit access or messages',()=>{
 const users=[{accountId:'alice',name:'同名'},{accountId:'other',name:'同名'}];
 const room={participantIds:['alice'],participants:['同名'],creatorAccountId:'alice'};
 assert.equal(roomHasMember(room,'other',users),false);
 assert.equal(roomHasMember({...room,participantIds:[]},'alice',users),false);
 assert.equal(senderId({sender:'同名'},room,users),null);
 assert.equal(senderId({sender:'同名',senderAccountId:'other'},room,users),'other');
 assert.deepEqual(roomIdentity({participants:['同名']},users).unresolved,['同名']);
 assert.throws(()=>roomIdentityPatch({participants:['同名']},users),/管理者/);
});
test('unknown legacy names require explicit mappings and departed members can be excluded',()=>{
 const legacy={participants:['舊名','已離開'],creator:'舊名',unreadCount:{舊名:3}};
 assert.throws(()=>roomIdentityPatch(legacy,profiles),/管理者/);
 const patch=roomIdentityPatch(legacy,profiles,{'舊名':'alice','已離開':null});
 assert.deepEqual(patch.participantIds,['alice']);assert.equal(patch.creatorAccountId,'alice');
 assert.equal(patch.unreadByAccount.alice,3);
 assert.equal(senderId({sender:'已離開'},{...legacy,...patch},profiles),null);
 assert.throws(()=>roomIdentityPatch(legacy,profiles,{'舊名':'outsider','已離開':null}),/管理者/);
});
test('historical names and account IDs are literal keys, including dots and prototype-like names',()=>{
 const users=[{accountId:'__proto__',name:'constructor'},{accountId:'old.id',name:'Other'}];
 const room={participants:['constructor','Other'],creator:'constructor'};
 const patch=roomIdentityPatch(room,users);
 assert.deepEqual(patch.participantIds,['__proto__','old.id']);
 assert.equal(patch.creatorAccountId,'__proto__');
 assert.equal(unreadFor({...room,...patch},'__proto__',users),0);
 assert.equal(readFor({...room,...patch},'old.id',users),0);
});
