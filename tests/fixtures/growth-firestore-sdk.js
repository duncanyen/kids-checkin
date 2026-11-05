// Browser Web SDK substitute, preserving document-only transaction reads and
// optimistic version checks. No Firebase project or Cloud Function is called.
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'document'});
export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'collection'});
export const where=(field,op,value)=>({field,op,value}),limit=maximum=>({maximum});
export const query=(ref,...constraints)=>({...ref,kind:'query',constraints});
const snap=row=>({id:row.path.split('/').at(-1),exists:()=>row.data!==null,data:()=>structuredClone(row.data)});
export const getDocFromServer=async ref=>snap(await window.__webDb({op:'get',path:ref.path}));
export const getDocsFromServer=async ref=>{const rows=await window.__webDb({op:'query',path:ref.path,constraints:ref.constraints});const docs=rows.map(snap);return{docs,size:docs.length,empty:!docs.length};};
const listeners=new Set();window.__webEmit=()=>Promise.all([...listeners].map(fn=>fn()));
export const onSnapshot=(ref,next,error)=>{let active=true;const emit=async()=>{try{const row=await getDocFromServer(ref);if(active)next(row);}catch(e){if(active)error?.(e);}};listeners.add(emit);emit();return()=>{active=false;listeners.delete(emit);};};
export const setDoc=async(ref,data)=>window.__webDb({op:'commit',expected:[],writes:[{path:ref.path,data}]});
export const deleteDoc=async ref=>window.__webDb({op:'commit',expected:[],writes:[{path:ref.path,delete:true}]});
export async function runTransaction(_,callback){
 for(let attempt=0;attempt<10;attempt++){
  const expected=[],writes=[];
  const result=await callback({
   async get(ref){if(ref.kind!=='document')throw Error('Web transactions cannot read queries');if(writes.length)throw Error('Read after write');const row=await window.__webDb({op:'get',path:ref.path});expected.push([ref.path,row.version]);return snap(row);},
   set(ref,data,options){writes.push({path:ref.path,data,merge:options?.merge});},
   update(ref,data){writes.push({path:ref.path,data,merge:true});}
  });
  try{await window.__webDb({op:'commit',expected,writes});return result;}catch(error){if(!error.message.includes('ABORTED'))throw error;}
 }
 throw Error('Too many transaction conflicts');
}
