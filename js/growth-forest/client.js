import {firebaseConfig} from '../firebase-config.js';
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,setPersistence,inMemoryPersistence,signInWithCustomToken,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {getFirestore,doc,collection,query,where,orderBy,limit,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {getStorage,ref,uploadBytes,getBlob,deleteObject} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
export async function connect(context){
 const app=getApps().find(a=>a.name==='nexus-growth')||initializeApp(firebaseConfig,'nexus-growth'),auth=getAuth(app),functions=getFunctions(app,'asia-southeast1'),db=getFirestore(app),storage=getStorage(app);
 const session=await httpsCallable(functions,'photoSession')({accountId:context.accountId,groupId:context.groupId,secret:context.user.password||context.user.pin||''});
 await setPersistence(auth,inMemoryPersistence);await signInWithCustomToken(auth,session.data.token);
 const assertContext=()=>{const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');if(user?.accountId!==context.accountId||(localStorage.getItem('lastGroupId')||user.groupId)!==context.groupId)throw Error('帳號或群組已切換，請重新開啟成長森林');};
 return{
  async api(action,payload={},mutate=false){
   assertContext();let key,requestId;
   if(mutate){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,payload})));key=`nexus.growth.pending:${context.groupId}:${context.accountId}:`+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');requestId=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,requestId);}
   const result=(await httpsCallable(functions,'growthForest')({groupId:context.groupId,action,payload,...(requestId?{requestId}:{})})).data;
   if(key)localStorage.removeItem(key);return result;
  },
  subscribe(parent,refresh,error){
   const root=`groups/${context.groupId}`,sources=[doc(db,root,'growthProfiles',context.accountId),doc(db,root,'growthSettings','main'),query(collection(db,root,'growthRecords'),...(parent?[]:[where('accountId','==',context.accountId)]),orderBy('updatedAt','desc'),limit(1)),query(collection(db,root,'growthRewards'),limit(100))];
   const stops=sources.map(source=>{return onSnapshot(source,refresh,error);});return()=>stops.forEach(stop=>stop());
  },
  async upload(file){assertContext();if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('考卷請使用 5 MB 以下的 JPG、PNG 或 WebP');const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`growth-exams/${context.groupId}/${context.accountId}/${crypto.randomUUID()}.${ext}`;await uploadBytes(ref(storage,path),file,{contentType:file.type});return path;},
  async photo(path){assertContext();if(!path.startsWith(`growth-exams/${context.groupId}/`))throw Error('照片不屬於目前群組');return getBlob(ref(storage,path));},
  async removePhoto(path){assertContext();await deleteObject(ref(storage,path));},
  close(){return signOut(auth);}
 };
}
