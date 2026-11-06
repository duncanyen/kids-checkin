import {app,db} from '../firebase-config.js';
import * as sdk from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {createFirestoreStore} from './firestore-store.js';
import {createGrowthService} from './direct-service.js';
// Temporary compatibility with Nexus's existing session and Firestore access.
// These browser checks are UX guards, not a replacement for trusted backend auth.
export async function connect(context){
 const assertCurrent=()=>{
  const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
  if(user?.accountId!==context.accountId||(localStorage.getItem('lastGroupId')||user.groupId)!==context.groupId)throw Error('帳號或群組已切換，請重新開啟成長森林');
 };
 assertCurrent();
 const profiles=await sdk.getDocsFromServer(sdk.query(sdk.collection(db,'users'),sdk.where('accountId','==',context.accountId),sdk.limit(2)));
 if(profiles.size!==1)throw Error('找不到唯一的帳號資料，請返回 Nexus 重新登入。');
 const profilePath='users/'+profiles.docs[0].id,store=createFirestoreStore(sdk,db,context.groupId,assertCurrent);
 const resolveContext=async(_request,transaction)=>{
  assertCurrent();const read=ref=>transaction?transaction.get(ref):ref.get();
  const [profile,group]=await Promise.all([read(store.doc(profilePath)),read(store.doc('groups/'+context.groupId))]);
  const actor=profile.data(),family=group.data();
  if(!actor||actor.accountId!==context.accountId||actor.role==='removed'||!family?.members?.includes(context.accountId))throw Object.assign(Error('目前帳號不在此群組或已停用，請重新登入。'),{code:'permission-denied'});
  return{groupId:context.groupId,accountId:context.accountId,actor:{accountId:actor.accountId,name:actor.name||actor.accountId,role:actor.role||'member'},group:family,parent:['admin','parent'].includes(actor.role)};
 };
 const service=createGrowthService({db:store,resolveContext,markCutover:false});
 await resolveContext();
 return{
  async api(action,payload={},mutate=false){
   assertCurrent();let key,requestId;
   if(mutate){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,payload})));key=`nexus.growth.pending:${context.groupId}:${context.accountId}:`+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');requestId=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,requestId);}
   const result=await service.handle({data:{groupId:context.groupId,action,payload,...(requestId?{requestId}:{})}});
   if(key)localStorage.removeItem(key);return result;
  },
  watchAppearance(receive,error=()=>{}){
   return sdk.onSnapshot(sdk.doc(db,'userSettings',context.accountId),snapshot=>{try{assertCurrent();receive(snapshot.data()?.appearance);}catch(e){error(e);}},error);
  },
  subscribe(_parent,refresh,error){
   // The shared revision reacts to all forest writes without composite indexes.
   const root=`groups/${context.groupId}`,sources=[sdk.doc(db,root),sdk.doc(db,root,'growthSync','main'),sdk.doc(db,root,'growthProfiles',context.accountId),sdk.doc(db,root,'growthSettings','main')];
   const stops=sources.map(source=>sdk.onSnapshot(source,()=>{try{assertCurrent();refresh();}catch(e){error(e);}},error));return()=>stops.forEach(stop=>stop());
  },
  async upload(file){
   const c=await resolveContext();if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('考卷請使用 5 MB 以下的 JPG、PNG 或 WebP');
   const url=URL.createObjectURL(file),image=new Image();
   try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('無法讀取這張照片'));image.src=url;});
    const ratio=Math.min(1,1280/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
    const drawing=canvas.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,canvas.width,canvas.height);drawing.drawImage(image,0,0,canvas.width,canvas.height);
    let quality=.8,dataUrl=canvas.toDataURL('image/jpeg',quality);while(dataUrl.length>650000&&quality>.3){quality-=.1;dataUrl=canvas.toDataURL('image/jpeg',quality);}if(dataUrl.length>650000)throw Error('照片壓縮後仍太大，請裁切後再上傳。');
    const id='firestore_'+crypto.randomUUID();await sdk.setDoc(sdk.doc(db,`groups/${context.groupId}/growthExamPhotos/${id}`),{accountId:c.accountId,groupId:c.groupId,dataUrl,contentType:'image/jpeg',createdAt:Date.now()});
    return `growth-exams/${context.groupId}/${context.accountId}/${id}.jpg`;
   }finally{URL.revokeObjectURL(url);}
  },
  async photo(path){
   const c=await resolveContext(),parts=path.split('/');if(parts.length!==4||parts[0]!=='growth-exams'||parts[1]!==c.groupId||(parts[2]!==c.accountId&&!c.parent))throw Error('無法讀取此帳號的照片');
   const id=parts[3].replace(/\.jpg$/,'');
   if(id.startsWith('firestore_')){const image=await sdk.getDocFromServer(sdk.doc(db,`groups/${context.groupId}/growthExamPhotos/${id}`));const row=image.data();if(!row||row.accountId!==parts[2]||row.groupId!==c.groupId||typeof row.dataUrl!=='string'||!row.dataUrl.startsWith('data:image/jpeg;base64,')||row.dataUrl.length>650000)throw Error('找不到有效的考卷照片');return(await fetch(row.dataUrl)).blob();}
   // Existing Storage photos, if any, still use the existing project's policy.
   const storage=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');return storage.getBlob(storage.ref(storage.getStorage(app),path));
  },
  async removePhoto(path){const c=await resolveContext(),parts=path.split('/');if(parts.length!==4||parts[1]!==c.groupId||parts[2]!==c.accountId)throw Error('照片不屬於目前帳號');const id=parts[3].replace(/\.jpg$/,'');if(!id.startsWith('firestore_'))throw Error('此照片需由原儲存方式處理');await sdk.deleteDoc(sdk.doc(db,`groups/${context.groupId}/growthExamPhotos/${id}`));},
  close(){}
 };
}
