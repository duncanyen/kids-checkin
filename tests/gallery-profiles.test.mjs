import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {photoPerson,photoAvatar} from '../js/gallery-profile-core.js';
const profiles=[{accountId:'alice',name:'Alice 最新',nameHistory:['Alice 舊名'],avatar:'alice-current.jpg'},{accountId:'bob',name:'Alice 舊名',avatar:'bob.jpg'}];
test('stable author/comment IDs select current names even when old names now belong to someone else',()=>{
 assert.equal(photoPerson('alice','Alice 舊名',profiles).name,'Alice 最新');
 assert.equal(photoAvatar(photoPerson('alice','Alice 舊名',profiles)),'alice-current.jpg');
 assert.equal(photoPerson('missing','Alice 舊名',profiles).accountId,'missing');
 assert.equal(photoPerson('missing','Alice 舊名',profiles).avatar,undefined);
 assert.deepEqual(photoPerson(null,'Alice 舊名',profiles),{name:'Alice 舊名'});
 assert.equal(photoPerson(null,'Alice 舊名',[profiles[0]]).accountId,'alice');
});
test('homepage Photo Dump rerenders current profile labels/avatars without rewriting stored uploader',async()=>{
 const source=await fs.readFile(new URL('../js/dashboard.js',import.meta.url),'utf8');let receive;
 const photo={uploader:'Alice 舊名',uploaderAccountId:'alice',imageUrl:'photo.jpg',timestamp:{toDate:()=>new Date()},likes:[]};
 const container={innerHTML:''},section={style:{}},context={window:{currentGroup:{id:'A'},groupMembers:profiles,userAvatarMap:{}},document:{getElementById:id=>id==='photoCarouselContainer'?container:id==='photoCarouselSection'?section:null},
 carouselUnsubscribe:null,carouselProfilesUnsubscribe:null,carouselProfilesRequest:0,dashboardGeneration:1,db:{},collection:()=>({}),where:()=>({}),query:()=>({}),orderBy:()=>({}),limit:()=>({}),photoPerson,photoAvatar,
 photoLikes:()=>({liked:false,count:0}),icon:()=>'',loadPhotoAliases:async()=>[],watchMemberWidget:(_,next)=>{receive=next;return()=>{};},console};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('window.fetchAndRenderPhotoCarousel ='),source.indexOf('const pendingPhotoLikes =')),context);
 context.window.fetchAndRenderPhotoCarousel({accountId:'alice',name:'Alice 舊名'});
 const emit=()=>receive({empty:false,forEach:cb=>cb({id:'p',data:()=>photo})});emit();
 assert.match(container.innerHTML,/Alice 最新/);assert.match(container.innerHTML,/alice-current.jpg/);assert.ok(!container.innerHTML.includes('bob.jpg'));
 context.window.groupMembers=[{...profiles[0],name:'再次改名 <img src=x>',avatar:'new-avatar.jpg'}];emit();
 assert.match(container.innerHTML,/再次改名 &lt;img src=x&gt;/);assert.match(container.innerHTML,/new-avatar.jpg/);assert.equal(photo.uploader,'Alice 舊名');
 await new Promise(r=>setTimeout(r,0));
});
let sequence=0;
test('profile watchers query only member account IDs, update names live and release listeners',async()=>{
 const source=(await fs.readFile(new URL('../js/gallery-profiles.js',import.meta.url),'utf8')).replace(/^import .*;\n/, 'const {collection,doc,getDoc,query,where,onSnapshot}=globalThis.__photoProfileSdk;\n');
 const watchers=[],updates=[];let released=0;
 globalThis.__photoProfileSdk={collection:(_,path)=>({path}),doc:(_,path,id)=>({path:path+'/'+id}),getDoc:async()=>({exists:()=>true,data:()=>({members:['alice','bob']})}),query:(ref,...filters)=>({...ref,filters}),where:(field,op,value)=>({field,op,value}),onSnapshot:(query,next)=>{watchers.push({query,next});return()=>released++;}};
 const {watchPhotoProfiles}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n//'+sequence++).toString('base64'));
 const stop=watchPhotoProfiles({},'A','alice',rows=>updates.push(rows));await new Promise(r=>setTimeout(r,0));
 assert.equal(watchers[0].query.filters[0].field,'accountId');assert.deepEqual(watchers[0].query.filters[0].value,['alice','bob']);
 const emit=rows=>watchers[0].next({docs:rows.map(p=>({data:()=>p}))});emit([...profiles,{accountId:'outside',name:'外人'}]);assert.equal(updates[0].length,2);
 emit([{...profiles[0],name:'Alice 又改名'},profiles[1]]);assert.equal(updates.at(-1)[0].name,'Alice 又改名');
 stop();emit(profiles);assert.equal(released,1);assert.equal(updates.length,2);
});
test('like aliases share concurrent work but refresh after the first response',async()=>{
 const source=(await fs.readFile(new URL('../js/gallery-identity.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'const {collection,getDocs,query,where,limit}=globalThis.__photoAliasSdk;\n');let name='Old',calls=0;
 globalThis.__photoAliasSdk={collection:()=>({}),query:()=>({}),where:()=>({}),limit:()=>({}),getDocs:async()=>{calls++;return{docs:[{data:()=>({name})}]};}};
 const {loadPhotoAliases}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')),db={},user={accountId:'a',name:'Session'};
 await Promise.all([loadPhotoAliases(db,user),loadPhotoAliases(db,user)]);assert.equal(calls,1);name='Newest';assert.ok((await loadPhotoAliases(db,user)).includes('Newest'));assert.equal(calls,2);
});
