// Performance fixture only. Served by the isolated HTTP harness, never imported by the app.
const data=()=>window.__perfStore;
const pause=()=>new Promise(r=>setTimeout(r,window.__perfDataDelay||60));
const record=(kind,ref)=>{window.__perfOperations.push({kind,path:ref.path,filters:ref.filters,time:performance.now()});};
const snapshot=(path,value)=>({id:path.split('/').at(-1),ref:{path},exists:()=>value!==undefined,data:()=>structuredClone(value)});
export const initializeApp=(_,name='[DEFAULT]')=>({name}),getApps=()=>[],getFirestore=()=>window.__perfDb??=( {} );
export const doc=(base, ...p)=>{if(!p.length&&base?.path)p=[base.path,'new-photo'];return{path:p.join('/'),id:p.at(-1),kind:'doc'};},collection=(_, ...p)=>({path:p.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value}),orderBy=(field,direction)=>({order:field,direction}),limit=n=>({limit:n});
export const query=(ref,...filters)=>({...ref,filters}),serverTimestamp=()=>Date.now(),increment=n=>n,arrayUnion=(...v)=>v,arrayRemove=(...v)=>v;
export async function getDoc(ref){record('getDoc',ref);await pause();return snapshot(ref.path,data()[ref.path]);}
export async function getDocs(ref){
 record('getDocs',ref);await pause();if(ref.path===window.__perfFailPath)throw Error('fixture permission denied');
 let values=Object.entries(data()).filter(([path])=>path.startsWith(ref.path+'/')&&path.split('/').length===ref.path.split('/').length+1);
 for(const f of ref.filters||[]){if(!f.field)continue;values=values.filter(([,d])=>f.op==='in'?f.value.includes(d[f.field]):f.op==='array-contains'?d[f.field]?.includes(f.value):f.op==='>='?d[f.field]>=f.value:f.op==='<='?d[f.field]<=f.value:f.op==='>'?d[f.field]>f.value:d[f.field]===f.value);}
 const cap=ref.filters?.find(f=>f.limit)?.limit;if(cap)values=values.slice(0,cap);
 const docs=values.map(([path,value])=>snapshot(path,value));return{docs,empty:!docs.length,size:docs.length,forEach:cb=>docs.forEach(cb)};
}
export function onSnapshot(ref,next,error){record('subscribe',ref);let active=true;(ref.kind==='doc'?getDoc(ref):getDocs(ref)).then(s=>{if(active)next(s);},e=>error?.(e));return()=>{active=false;record('unsubscribe',ref);};}
export const getCountFromServer=async ref=>{record('count',ref);await pause();return{data:()=>({count:0})};};
export const addDoc=async(ref,value)=>{record('addDoc',ref);await pause();return{id:'new-item'};};
export const setDoc=async(ref,value)=>{record('setDoc',ref);data()[ref.path]=value;},updateDoc=async(ref,value)=>{record('updateDoc',ref);data()[ref.path]={...data()[ref.path],...value};},deleteDoc=async ref=>{record('deleteDoc',ref);delete data()[ref.path];};
export const runTransaction=async(_,fn)=>fn({get:getDoc,set:()=>{}});
export const getAuth=()=>({}),setPersistence=async()=>{},inMemoryPersistence={},signInWithCustomToken=async()=>({user:{uid:'fixture'}});
export const getFunctions=()=>({}),httpsCallable=(_,name)=>async()=>{record('callable',{path:name});return{data:{token:'fixture'}};};
export const getStorage=()=>({}),ref=(_,path)=>({path}),uploadString=async()=>{},getDownloadURL=async()=>'/Nexus.png',deleteObject=async()=>{};

export const startAfter=s=>({after:s.id}),endAt=s=>({end:s.id});
