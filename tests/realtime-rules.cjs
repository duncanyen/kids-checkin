// Run via firebase emulators:exec --only database --project demo-nexus-live.
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('../functions/node_modules/@firebase/rules-unit-testing');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-nexus-live',database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')}});
 try{
 await env.withSecurityRulesDisabled(async context=>context.database().ref('nexus').set({
  status:{chat:true,farms:true},access:{accounts:{alice:{active:true},bob:{active:true}},groups:{A:{public:true,members:{alice:true,bob:true}},B:{public:true,members:{neighbor:true}},C:{public:false,members:{neighbor:true}}},rooms:{r:{groupKey:'A',participants:{alice:true}}}},
  farms:{A:{alice:{data:{kind:'object'}},bob:{data:{kind:'object'}}},B:{neighbor:{data:{kind:'object'}}},C:{neighbor:{data:{kind:'object'}}}},
  rooms:{A:{r:{data:{kind:'object'}}}},inboxes:{A:{alice:{r:{sortTime:1}},bob:{}}},messages:{A:{r:{m:{sortTime:1,data:{kind:'object'}}}}}
  ));
 const account=(name,group='A')=>env.authenticatedContext('uid-'+name,{accountKey:name,groupKey:group}).database();
 const alice=account('alice'),bob=account('bob');
 await assertSucceeds(alice.ref('nexus/farms/A/bob').get());
 await assertSucceeds(alice.ref('nexus/farms/B/neighbor').get());
 await assertFails(alice.ref('nexus/farms/C/neighbor').get());
 await assertFails(alice.ref('nexus/farms/B').get());
 await assertFails(env.unauthenticatedContext().database().ref('nexus/farms/A/alice').get());
 await assertSucceeds(alice.ref('nexus/inboxes/A/alice').get());
 await assertFails(bob.ref('nexus/inboxes/A/alice').get());
 await assertSucceeds(alice.ref('nexus/rooms/A/r').get());
 await assertFails(bob.ref('nexus/rooms/A/r').get());
 await assertSucceeds(alice.ref('nexus/messages/A/r').orderByChild('sortTime').limitToLast(30).get());
 await assertFails(alice.ref('nexus/messages/A/r').get());
 await assertFails(alice.ref('nexus/messages/A/r').orderByChild('sortTime').limitToLast(101).get());
 await assertFails(alice.ref('nexus/farms/A/alice').set({coins:999999}));
 await assertFails(alice.ref('nexus/access/groups/A').set({members:{alice:true}}));
 const denied=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Membership removal did not cancel listener')),5000);const ref=alice.ref('nexus/rooms/A/r');ref.on('value',()=>{},error=>{clearTimeout(timer);ref.off();resolve(error);});});
 await new Promise(resolve=>setTimeout(resolve,100));
 await env.withSecurityRulesDisabled(async context=>context.database().ref('nexus/access/groups/A/members/alice').remove());
 await denied;
 await assertFails(account('alice').ref('nexus/farms/B/neighbor').get());
 await env.withSecurityRulesDisabled(async context=>context.database().ref('nexus/access/accounts/bob/active').set(false));
 await assertFails(account('bob').ref('nexus/farms/A/bob').get());
 console.log('PASS: real RTDB rules enforce group isolation, public-village gates, own inbox and room membership, bounded message queries, no client writes, live revocation and inactive accounts');
 }finally{await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
