const test=require('node:test'),assert=require('node:assert/strict');
const {required,matches,ensure}=require('../scripts/ensure-announcement-index.cjs');
const existing={name:'projects/p/databases/(default)/collectionGroups/ops_announcements/indexes/i',queryScope:'COLLECTION',fields:[...required.fields,{fieldPath:'__name__',order:'DESCENDING'}],state:'READY'};
test('announcement index matches the audience/status/priority query without confusing unrelated indexes',()=>{
 assert.equal(matches(existing),true);assert.equal(matches({...existing,name:existing.name.replace('ops_announcements','expenses')}),false);
 assert.equal(matches({...existing,fields:existing.fields.slice(1)}),false);
});
test('existing required index is not recreated and no index is removed',()=>{
 const calls=[];ensure({project:'p',log:()=>{},run:(command,args)=>{calls.push(args);return JSON.stringify([existing]);}});
 assert.equal(calls.length,1);assert.ok(calls[0].includes('list'));
});
test('missing feed index creates only the required index in the default database',()=>{
 const calls=[];ensure({project:'p',log:()=>{},run:(command,args)=>{assert.equal(command,'gcloud');calls.push(args);return calls.length===1?'[]':'';}});
 assert.equal(calls.length,2);assert.ok(calls[1].includes('create'));assert.ok(calls[1].includes('--collection-group=ops_announcements'));
 assert.ok(calls[1].includes('--database=(default)'));assert.equal(calls[1].filter(a=>a.startsWith('--field-config=')).length,4);
 assert.ok(calls.every(args=>!args.includes('delete')));
});
test('notification rollout creates its management and audience indexes without deleting others',()=>{
 const definitions=require('../firestore.indexes.json').indexes.filter(i=>i.collectionGroup==='ops_notifications');
 assert.equal(definitions.length,9);
 const calls=[];ensure({project:'p',definitions,log:()=>{},run:(_command,args)=>{calls.push(args);return args.includes('list')?JSON.stringify([existing]):'';}});
 assert.equal(calls.length,10);
 assert.ok(calls.slice(1).every(args=>args.includes('--collection-group=ops_notifications')&&!args.includes('delete')));
 const definition=definitions.find(i=>i.fields.some(f=>f.fieldPath==='audienceKeys'));
 assert.equal(matches({...existing,name:existing.name.replace('ops_announcements','ops_notifications')},definition),true);
});
test('management rollout creates only the three event search/status indexes',()=>{
 const definitions=require('../firestore.indexes.json').indexes.filter(i=>i.collectionGroup==='ops_events');assert.equal(definitions.length,3);
 const calls=[];ensure({project:'p',definitions,log:()=>{},run:(_cmd,args)=>{calls.push(args);return args.includes('list')?'[]':'';}});
 assert.equal(calls.length,4);assert.ok(calls.slice(1).every(args=>args.includes('--collection-group=ops_events')&&!args.includes('delete')));
});
