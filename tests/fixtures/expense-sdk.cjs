module.exports = `
export const initializeApp=(_,name)=>({name}),getFirestore=app=>({app});
export const getApps=()=>[],getAuth=()=>({}),getFunctions=()=>({}),inMemoryPersistence={};
export const setPersistence=async()=>{},signInWithCustomToken=async()=>{};
export const httpsCallable=()=>async()=>({data:{token:'fixture'}});
export const setDoc=async(ref,data)=>{if(window.__failSave)throw Error('offline');window.__store[ref.path]={...window.__store[ref.path],...structuredClone(data)};};
export const collection=(_, ...parts)=>({path:parts.join('/')});
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const where=(field,op,value)=>({field,op,value});
export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>1234;
export const orderBy=(field,direction)=>({kind:'order',field,direction});
export const documentId=()=>'__name__';
export const startAfter=row=>({kind:'cursor',id:row.id});
export const limit=value=>({kind:'limit',value});
export const sum=field=>({field}),count=()=>({});
function rowsFor(ref){return Object.entries(window.__store).filter(([path,data])=>path.startsWith(ref.path+'/')&&!path.slice(ref.path.length+1).includes('/')&&(ref.filters||[]).filter(f=>!f.kind).every(f=>f.op==='=='?data[f.field]===f.value:f.op==='in'?f.value.includes(data[f.field]):f.op==='>='?data[f.field]>=f.value:data[f.field]<=f.value)).map(([path,data])=>({id:path.split('/').at(-1),data:()=>structuredClone(data)}));}
export const getAggregateFromServer=async ref=>{
 if(window.__failRead)throw Error('offline');
 const rows=rowsFor(ref);return{data:()=>({amount:rows.reduce((n,r)=>n+Number(r.data().amount),0),records:rows.length})};
};
export const getDocs=async ref=>{
 if(ref.path==='expenses'&&window.__failRead)throw Error('offline');
 const delay=ref.filters?.find(f=>f.field==='date'&&f.op==='>='&&f.value==='2026-10-01');
 if(delay&&window.__delayOctober&&ref.path==='expenses')await new Promise(resolve=>window.__releaseOctober=resolve);
 let docs=rowsFor(ref);
 if(ref.filters?.some(f=>f.kind==='order'))docs.sort((a,b)=>b.data().date.localeCompare(a.data().date)||b.id.localeCompare(a.id));
 const cursor=ref.filters?.find(f=>f.kind==='cursor');if(cursor)docs=docs.slice(docs.findIndex(r=>r.id===cursor.id)+1);
 const cap=ref.filters?.find(f=>f.kind==='limit');if(cap)docs=docs.slice(0,cap.value);
 if(ref.path==='expenses')window.__documentReads.push({limit:cap?.value,count:docs.length});
 return{docs,forEach:fn=>docs.forEach(fn)};
};
export const addDoc=async(ref,data)=>{
 if(window.__failSave)throw Error('offline');
 if(window.__delaySave)await new Promise(resolve=>window.__releaseSave=resolve);
 const id='new-'+(++window.__writes);window.__store[ref.path+'/'+id]=structuredClone(data);return{id};
};
export const deleteDoc=async ref=>{delete window.__store[ref.path];};
export const updateDoc=async(ref,patch)=>{if(window.__failSave)throw Error('offline');Object.assign(window.__store[ref.path],patch);};
export const getDoc=async ref=>({exists:()=>!!window.__store[ref.path],data:()=>window.__store[ref.path]});
export const runTransaction=async(_,change)=>{
 if(window.__delayEditSave)await new Promise(resolve=>window.__releaseEditSave=resolve);
 const writes=[];
 await change({get:getDoc,update:(ref,patch)=>writes.push({ref,patch})});
 if(window.__failSave)throw Error('offline');
 for(const {ref,patch} of writes){window.__editPatches.push(structuredClone(patch));Object.assign(window.__store[ref.path],structuredClone(patch));window.__editWrites++;}
};
`;
