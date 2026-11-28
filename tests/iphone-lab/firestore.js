// Device-test adapter. Reads synthetic data only; all client writes are forbidden.
import {labFetch} from '/lab/client.js';
export const getFirestore=()=>({});
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'doc'}),collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const query=(ref,...filters)=>({...ref,filters}),where=(field,op,value)=>({field,op,value});
export const serverTimestamp=()=>Date.now();
const snapshot=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==null&&data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:false,hasPendingWrites:false}});
export const getDoc=async ref=>snapshot(ref.path,await labFetch('/lab/read',{kind:'get',path:ref.path}));
export const getDocs=async ref=>{const rows=await labFetch('/lab/read',{kind:'query',path:ref.path,filters:ref.filters||[]}),docs=rows.map(r=>snapshot(r.path,r.data));return{docs,empty:!docs.length,forEach:f=>docs.forEach(f)};};
const listeners=new Set();let working=false;
async function emit(){if(working||document.hidden)return;working=true;try{for(const l of [...listeners])try{l.callback(l.ref.kind==='query'?await getDocs(l.ref):await getDoc(l.ref));}catch(e){l.error?.(e);}}finally{working=false;}}
export const onSnapshot=(ref,callback,error)=>{const l={ref,callback,error};listeners.add(l);void emit();return()=>listeners.delete(l);};
setInterval(()=>void emit(),1500);document.addEventListener('visibilitychange',()=>void emit());
const denied=()=>{throw Error('LAB_DIRECT_FIRESTORE_WRITE_DENIED');};export const setDoc=denied,updateDoc=denied,deleteDoc=denied,addDoc=denied,runTransaction=denied;
