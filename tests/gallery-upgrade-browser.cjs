// Real browser interactions; Firestore/Storage use one isolated in-memory backend.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.GALLERY_BASE_URL || 'http://127.0.0.1:8012';
const image = require('node:fs').readFileSync('Nexus.png');
const store = {
 'users/a': { accountId: 'alice', name: 'New Alice', nameHistory: ['Old Alice', 'Older Alice'] },
 'photos/p': { groupId: 'A', uploader: 'Old Alice', uploaderAccountId: 'alice', timestamp: 1000, imageUrls: [base+'/test-photo.png', base+'/test-photo.png?second'], likes: ['Old Alice', 'Older Alice'], comments: [] },
 'photos/other': { groupId: 'B', uploader: 'Other', timestamp: 1, likes: [], comments: [] }
};
const leases=new Map();
let queue=Promise.resolve(), failCommit=false, uploads=[], deleted=[];
const sdk=`
export const initializeApp=()=>({}),getApps=()=>[],getFirestore=()=>({}),getAuth=()=>({}),getFunctions=()=>({}),getStorage=()=>({});
export const setPersistence=async()=>{},inMemoryPersistence={},signInWithCustomToken=async()=>({user:{uid:'alice-uid'}}),httpsCallable=()=>async()=>({data:{token:'test'}});
export const collection=(_,path)=>({path}),doc=(ref,...parts)=>({path:parts.length?parts.join('/'):ref.path+'/new',id:parts.at(-1)||'new'});
export const where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=n=>({limit:n}),startAfter=()=>({}),endAt=()=>({}),query=(ref,...filters)=>({...ref,filters}),serverTimestamp=()=>1000;
function snap(row){return {id:row.id,exists:()=>!!row.value,data:()=>({...row.value,...(row.value.timestamp&&typeof row.value.timestamp==='number'?{timestamp:{toDate:()=>new Date(row.value.timestamp),toMillis:()=>row.value.timestamp}}:{})})};}
export const getDocs=async ref=>{const rows=await window.__db({op:'query',ref});const docs=rows.map(snap);return{docs,empty:!docs.length,metadata:{fromCache:false},forEach:fn=>docs.forEach(fn)};};
window.__listeners??=new Set();window.__emit=()=>Promise.all([...window.__listeners].map(fn=>fn()));
export const onSnapshot=(ref,callback)=>{let active=true;const emit=async()=>{const result=await getDocs(ref);if(active)callback(result);};window.__listeners.add(emit);emit();return()=>{active=false;window.__listeners.delete(emit)};};
export const addDoc=async()=>({id:'log'}),setDoc=async()=>{},deleteDoc=async ref=>{await window.__db({op:'delete',ref});await window.__emit();};
export async function runTransaction(_,callback){await window.__db({op:'begin'});try{const writes=[];const result=await callback({get:async ref=>{const value=await window.__db({op:'get',ref});return{exists:()=>!!value,data:()=>value}},update:(ref,patch)=>writes.push({ref,patch})});await window.__db({op:'commit',writes});await window.__emit();return result;}finally{await window.__db({op:'release'})}}
export const ref=(_,path)=>path,uploadString=async(path,data)=>window.__db({op:'upload',path,data}),getDownloadURL=async path=>location.origin+'/test-photo.png?path='+encodeURIComponent(path),deleteObject=async path=>window.__db({op:'removeFile',path});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 await context.exposeBinding('__db',async({page:sourcePage},event)=>{
  if(event.op==='query'){
   let rows=Object.entries(store).filter(([path])=>path.startsWith(event.ref.path+'/'));
   for(const f of event.ref.filters||[])if(f.field)rows=rows.filter(([,value])=>value[f.field]===f.value);
   const cap=event.ref.filters?.find(f=>f.limit)?.limit;if(cap)rows=rows.slice(0,cap);
   return rows.map(([path,value])=>({id:path.split('/').at(-1),value:structuredClone(value)}));
  }
  if(event.op==='get')return structuredClone(store[event.ref.path]);
  if(event.op==='begin'){const previous=queue;let unlock;queue=new Promise(resolve=>unlock=resolve);await previous;leases.set(sourcePage,unlock);return;}
  if(event.op==='release'){leases.get(sourcePage)();leases.delete(sourcePage);return;}
  if(event.op==='commit'){if(failCommit)throw Error('offline');for(const write of event.writes)Object.assign(store[write.ref.path],structuredClone(write.patch));return;}
  if(event.op==='upload'){uploads.push(event.path);return;}
  if(event.op==='removeFile'){deleted.push(event.path);return;}
  if(event.op==='delete')delete store[event.ref.path];
 });
 await context.route('https://www.gstatic.com/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await context.route('**/test-photo.png*',route=>route.fulfill({contentType:'image/png',body:image}));
 await context.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'New Alice',password:'test'}));localStorage.setItem('lastGroupId','A');});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(10000);
 await page.goto(base+'/gallery.html');await page.waitForSelector('.photo-card');
 await page.waitForFunction(()=>document.querySelector('.btn-like')?.getAttribute('aria-pressed')==='true');
 assert.equal(await page.locator('.likes-count').innerText(),'1','two historical names count once');
 // Concurrent stale "like" requests from two tabs still create one account ID.
 const second=await context.newPage();second.on('dialog',dialog=>dialog.accept());await second.goto(base+'/gallery.html');await second.waitForSelector('.photo-card');
 await Promise.all([page.evaluate(()=>toggleLike('p',false)),second.evaluate(()=>toggleLike('p',false))]);
 assert.deepEqual(store['photos/p'].likeAccountIds,['alice']);assert.deepEqual(store['photos/p'].likes,[]);
 await page.reload();await page.waitForSelector('.photo-card');
 assert.equal(await page.locator('.likes-count').innerText(),'1');
 // Opening, real two-touch pinch, one-finger pan, reset and swipe.
 await page.locator('.card-image').first().click();await page.waitForSelector('#photoViewerModal');
 const cdp=await context.newCDPSession(page);
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id,radiusX:2,radiusY:2,force:1}))});
 await touch('touchStart',[[150,400,1],[240,400,2]]);
 await touch('touchMove',[[80,400,1],[310,400,2]]);
 await touch('touchEnd',[]);
 assert.ok(Number(await page.locator('#viewerImage').getAttribute('data-scale'))>2);
 assert.equal(await page.locator('#viewerCounter').innerText(),'1 / 2','pinch does not switch image');
 const transform=await page.locator('#viewerImage').evaluate(node=>node.style.transform);
 await touch('touchStart',[[180,400,3]]);await touch('touchMove',[[250,450,3]]);await touch('touchEnd',[]);
 assert.notEqual(await page.locator('#viewerImage').evaluate(node=>node.style.transform),transform);
 await page.click('[aria-label="下一張照片"]');assert.equal(await page.locator('#viewerImage').getAttribute('data-scale'),'1');
 assert.equal(await page.locator('#viewerCounter').innerText(),'2 / 2');
 await page.waitForTimeout(400);
 await Promise.all([touch('touchStart',[[195,400,90]]),touch('touchEnd',[]),touch('touchStart',[[195,400,91]]),touch('touchEnd',[])]);
 assert.equal(await page.locator('#viewerImage').getAttribute('data-scale'),'2.5');
 await Promise.all([touch('touchStart',[[195,400,90]]),touch('touchEnd',[]),touch('touchStart',[[195,400,91]]),touch('touchEnd',[])]);
 assert.equal(await page.locator('#viewerImage').getAttribute('data-scale'),'1');
 await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedFiles=data.files.map(file=>({name:file.name,size:file.size}));}});});
 const downloadEvent=page.waitForEvent('download');await page.click('[data-viewer-download]');
 const download=await downloadEvent;assert.match(download.suggestedFilename(),/^photo-dump-.*\.png$/);
 await page.click('[data-viewer-share]');assert.equal(await page.evaluate(()=>window.__sharedFiles.length),1);
 // CORS/network failure gives an explicit original-image fallback.
 await page.route('**/download-fails.png',route=>route.abort());
 await page.evaluate(()=>{viewerQueue.push(location.origin+'/download-fails.png');openPhotoViewer(2);});
 await page.click('[data-viewer-download]');await page.waitForSelector('[data-viewer-original]:not([hidden])');
 assert.match(await page.locator('[data-viewer-status]').innerText(),/無法直接下載/);
 await page.click('[aria-label="關閉照片"]');
 // Failed photo comment retains drafts and removes staged files; retry saves once.
 const uploadImage={name:'comment.png',mimeType:'image/png',buffer:image};
 await page.locator('.comment-file-input').setInputFiles([uploadImage]);await page.waitForSelector('.comment-preview img');
 await page.locator('.comment-input').fill('<script>test</script>');
 failCommit=true;await page.evaluate(()=>submitComment('p'));
 assert.match(await page.locator('.comment-status').innerText(),/已保留/);
 assert.equal(await page.locator('.comment-preview').count(),1);assert.equal(store['photos/p'].comments.length,0);
 assert.equal(deleted.length,1,'failed metadata write removes staged comment image');
 failCommit=false;await Promise.all([page.evaluate(()=>submitComment('p')),page.evaluate(()=>submitComment('p'))]);
 assert.equal(store['photos/p'].comments.length,1);
 const comment=store['photos/p'].comments[0];assert.equal(comment.senderAccountId,'alice');assert.equal(comment.imageUrls.length,1);assert.equal(comment.storagePaths.length,1);
 assert.equal(await page.locator('.comment-image').count(),1);assert.equal(await page.locator('.comment-content script').count(),0);
 assert.equal(await page.locator('.comment-preview').count(),0);
 await page.locator('.comment-image').click();assert.equal(await page.locator('#viewerCounter').innerText(),'3 / 3');await page.click('[aria-label="關閉照片"]');
 // Image-only comments are allowed, but a fourth attachment is rejected.
 await page.locator('.comment-file-input').setInputFiles([uploadImage,uploadImage,uploadImage,uploadImage]);
 assert.match(await page.locator('.comment-status').innerText(),/最多三張/);
 await page.locator('.comment-file-input').setInputFiles([uploadImage]);await page.waitForSelector('.comment-preview');
 await page.evaluate(()=>submitComment('p'));assert.equal(store['photos/p'].comments.length,2);assert.equal(store['photos/p'].comments[1].text,'');
 // Deleting a photo comment also removes its file; rename retains ownership.
 await page.evaluate(()=>deleteComment('p',0));assert.equal(store['photos/p'].comments.length,1);assert.ok(deleted.includes(comment.storagePaths[0]));
 // Identity/group switch blocks late writes.
 await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));await page.evaluate(()=>toggleLike('p',true));assert.deepEqual(store['photos/p'].likeAccountIds,['alice']);
 assert.deepEqual(errors,[]);
 console.log('PASS: real pinch/pan, image reset, file download and fallback, historical-name likes, concurrent tabs, account IDs, photo comments, retries/rollback, image-only comments, attachment limits, viewer integration, escaped text, cleanup and group guard.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
