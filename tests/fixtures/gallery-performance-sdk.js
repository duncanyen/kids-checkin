// Isolated Firestore substitute: no requests or writes to any Firebase project.
export * from '/tests/fixtures/navigation-performance-sdk.js';
const state=()=>window.__galleryTest;
export const startAfter=s=>({after:s.id,point:s.data().timestamp.toMillis()}),endAt=s=>({end:s.id,point:s.data().timestamp.toMillis()}),limit=n=>({limit:n});
const snap=(id,value)=>({id,exists:()=>true,data:()=>({...structuredClone(value),timestamp:{toDate:()=>new Date(value.timestamp),toMillis:()=>value.timestamp}})});
function select(q){
 let entries=Object.entries(window.__perfStore).filter(([p])=>p.startsWith(q.path+'/'));
 for(const f of q.filters||[])if(f.field)entries=entries.filter(([,v])=>v[f.field]===f.value);
 entries.sort((a,b)=>b[1].timestamp-a[1].timestamp||b[0].localeCompare(a[0]));
 const bound=id=>({timestamp:q.filters.find(f=>f.after===id||f.end===id).point});
 const after=q.filters?.find(f=>f.after)?.after,end=q.filters?.find(f=>f.end)?.end;
 const cmp=(path,v,id)=>bound(id)?(bound(id).timestamp-v.timestamp||('photos/'+id).localeCompare(path)):0;
 if(after)entries=entries.filter(([p,v])=>cmp(p,v,after)>0);
 if(end)entries=entries.filter(([p,v])=>cmp(p,v,end)<=0);
 const cap=q.filters?.find(f=>f.limit)?.limit;if(cap)entries=entries.slice(0,cap);
 const docs=entries.map(([p,v])=>snap(p.split('/').at(-1),v));return{metadata:{fromCache:!!state().cache},docs,size:docs.length,empty:!docs.length,forEach:cb=>docs.forEach(cb)};
}
const wait=()=>new Promise(r=>setTimeout(r,state().delay));
export async function getDocs(q){
 if(q.path!=='photos')return {docs:[],empty:true,forEach:()=>{}};
 state().requests++;await wait();if(state().fail){state().fail=false;throw Error('network fixture');}
 const result=select(q);state().reads+=result.size;return result;
}
export function onSnapshot(q,next,error){
 const test=state();let active=true,first=true;
 const emit=async()=>{
  await wait();if(!active)return;
  if(test.failLive){test.failLive=false;test.listeners.delete(emit);error?.(Error('listener fixture'));return;}
  const result=select(q);test.reads+=first?result.size:0;first=false;next(result);
 };
 test.listeners.add(emit);emit();return()=>{if(active){active=false;test.listeners.delete(emit);}};
}
export const arrayUnion=(...values)=>({union:values}),arrayRemove=(...values)=>({remove:values});
export async function updateDoc(ref,patch){
 const value=window.__perfStore[ref.path];
 for(const [key,v] of Object.entries(patch))value[key]=v.union?[...(value[key]||[]),...v.union.filter(x=>!(value[key]||[]).some(y=>JSON.stringify(x)===JSON.stringify(y)))]:v.remove?(value[key]||[]).filter(x=>!v.remove.some(y=>JSON.stringify(x)===JSON.stringify(y))):v;
 window.__galleryTest.emit();
}
export async function deleteDoc(ref){delete window.__perfStore[ref.path];window.__galleryTest.emit();}
