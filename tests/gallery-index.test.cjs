const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const indexes=require('../firestore.indexes.json').indexes;
test('Photo Dump feed/carousel and unread-count indexes remain in deployment configuration',()=>{
 for(const order of ['ASCENDING','DESCENDING'])assert.ok(indexes.some(i=>i.collectionGroup==='photos'&&i.queryScope==='COLLECTION'&&i.fields.length===2&&i.fields[0].fieldPath==='groupId'&&i.fields[0].order==='ASCENDING'&&i.fields[1].fieldPath==='timestamp'&&i.fields[1].order===order),order);
});
test('read errors distinguish missing index, permission and network failures without exposing backend details',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../js/gallery-load-error.js'),'utf8');
 const {photoLoadError}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 assert.match(photoLoadError({code:'failed-precondition',message:'The query requires an index. private-url'}),/索引/);
 assert.doesNotMatch(photoLoadError({code:'failed-precondition',message:'The query requires an index. private-url'}),/private-url/);
 assert.match(photoLoadError({code:'firestore/permission-denied'}),/權限/);
 assert.match(photoLoadError({code:'unavailable'}),/網路/);
 assert.match(photoLoadError({code:'failed-precondition',message:'different precondition'}),/網路/);
});
test('homepage exposes a failed photo query, supports retry and clears the warning after a successful empty result',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync('js/dashboard.js','utf8');
 const section={style:{}},container={after(node){nodes[node.id]=node;}},nodes={};
 const element=()=>({append(...children){this.children=children;},setAttribute(){},remove(){delete nodes[this.id];}});
 let receive,reject,subscriptions=0,stopped=0;
 const context={window:{currentGroup:{id:'A'}},document:{getElementById:id=>id==='photoCarouselSection'?section:id==='photoCarouselContainer'?container:nodes[id],createElement:element},
  db:{},collection:()=>({}),query:()=>({}),where:()=>({}),orderBy:()=>({}),limit:()=>({}),
  carouselUnsubscribe:null,carouselProfilesUnsubscribe:null,carouselProfilesRequest:0,dashboardGeneration:1,
  watchMemberWidget:(_,next,error)=>{receive=next;reject=error;subscriptions++;return()=>stopped++;},
  photoLoadError:()=> '相簿索引尚未就緒',loadPhotoAliases:async()=>[],console:{error(){}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('window.fetchAndRenderPhotoCarousel ='),source.indexOf('const pendingPhotoLikes =')),context);
 context.window.fetchAndRenderPhotoCarousel({accountId:'alice',name:'Alice'});
 reject({code:'failed-precondition'});
 assert.equal(section.style.display,'block');
 assert.equal(nodes.photoCarouselReadError.children[0].textContent,'相簿索引尚未就緒');
 nodes.photoCarouselReadError.children[1].onclick();
 assert.equal(subscriptions,2);assert.equal(stopped,1);
 receive({empty:true});
 assert.equal(section.style.display,'none');assert.equal(nodes.photoCarouselReadError,undefined);
 await new Promise(resolve=>setImmediate(resolve));
});
