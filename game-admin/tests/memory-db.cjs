// Transactional test double. Emulator suite runs the same service against real Firestore.
const crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks');
const fieldValue=(data,key)=>key.split('.').reduce((v,k)=>v?.[k],data);
const copy=value=>value===undefined?undefined:structuredClone(value);
function applyUpdate(previous,patch){const value=copy(previous);for(const [field,next]of Object.entries(patch)){const keys=field.split('.');let at=value;for(const key of keys.slice(0,-1))at=at[key]&&typeof at[key]==='object'?at[key]:(at[key]={});at[keys.at(-1)]=copy(next);}return value;}
class Ref{
    constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').at(-1);}
    async get(){return this.db.snapshot(this.path);}
    collection(name){return new Query(this.db,this.path+'/'+name);}
    async set(value,options={}){this.db.data.set(this.path,options.merge?{...this.db.data.get(this.path),...copy(value)}:copy(value));}
    async update(value){if(!this.db.data.has(this.path))throw Error('not found');this.db.data.set(this.path,applyUpdate(this.db.data.get(this.path),value));}
}
class Query{
    constructor(db,path,filters=[],sorts=[],size=Infinity,cursor=null){Object.assign(this,{db,path,filters,sorts,size,cursor});}
    where(...filter){return new Query(this.db,this.path,[...this.filters,filter],this.sorts,this.size,this.cursor);}
    orderBy(...sort){return new Query(this.db,this.path,this.filters,[...this.sorts,sort],this.size,this.cursor);}
    limit(size){return new Query(this.db,this.path,this.filters,this.sorts,size,this.cursor);}
    startAfter(cursor){return new Query(this.db,this.path,this.filters,this.sorts,this.size,cursor);}
    doc(id=crypto.randomUUID()){return new Ref(this.db,this.path+'/'+id);}
    async add(value){const ref=this.doc();await ref.set(value);return ref;}
    count(){return{get:async()=>{const result=await this.get();return{data:()=>({count:result.size})};}};}
    async get(){
        let rows=[...this.db.data.entries()].filter(([path])=>(this.path.startsWith('**/')?path.split('/').at(-2)===this.path.slice(3):path.startsWith(this.path+'/')&&path.split('/').length===this.path.split('/').length+1)).map(([path])=>this.db.snapshot(path));
        for(const [key,op,value]of this.filters)rows=rows.filter(row=>{const v=fieldValue(row.data(),key);return op==='=='?v===value:op==='in'?value.includes(v):op==='array-contains'?v?.includes(value):op==='array-contains-any'?value.some(x=>v?.includes(x)):op==='<='?v<=value:op==='>='?v>=value:op==='<'?v<value:op==='>'?v>value:false;});
        rows.sort((a,b)=>{for(const [field,direction]of this.sorts){const av=fieldValue(a.data(),field),bv=fieldValue(b.data(),field);if(av!==bv)return(av<bv?-1:1)*(direction==='desc'?-1:1);}return(a.id<b.id?-1:1)*(this.sorts.at(-1)?.[1]==='desc'?-1:1);});
        if(this.cursor){const index=rows.findIndex(r=>r.id===this.cursor.id);rows=rows.slice(index+1);}
        rows=rows.slice(0,this.size);return{docs:rows,size:rows.length,empty:!rows.length};
    }
}
class MemoryDB{
    constructor(){this.data=new Map();this.queue=Promise.resolve();this.failAward=false;this.context=new AsyncLocalStorage();}
    collectionGroup(name){return new Query(this,'**/'+name);}
    doc(path){return new Ref(this,path);}collection(path){return new Query(this,path);}
    snapshot(path){const value=copy(this.data.get(path));return{ref:this.doc(path),id:path.split('/').at(-1),exists:value!==undefined,data:()=>copy(value)};}
    runTransaction(callback){
        const execute=async()=>{
            const writes=[];
            const result=await this.context.run(this,()=>callback({get:ref=>{if(writes.length)throw Error('Read after write');return ref.get();},set:(ref,data)=>writes.push(['set',ref,data]),create:(ref,data)=>writes.push(['create',ref,data]),update:(ref,data)=>writes.push(['update',ref,data]),delete:ref=>writes.push(['delete',ref])}));
            if(this.failAward&&writes.some(([,ref])=>ref.path.startsWith('groups/'))){this.failAward=false;throw Error('simulated storage failure');}
            const next=new Map(this.data);
            for(const [type,ref,value]of writes){if(type==='delete'){next.delete(ref.path);continue;}if(type==='create'&&next.has(ref.path))throw Error('already exists');if(type==='update'&&!next.has(ref.path))throw Error('not found');next.set(ref.path,type==='update'?applyUpdate(next.get(ref.path),value):copy(value));}
            this.data=next;return result;
        };
        // An independent rate-limit transaction may run while the economic
        // transaction is open, matching Admin SDK's disjoint-document writes.
        if(this.context.getStore()===this)return execute();
        const promise=this.queue.then(execute);this.queue=promise.catch(()=>{});return promise;
    }
}
module.exports={MemoryDB};
