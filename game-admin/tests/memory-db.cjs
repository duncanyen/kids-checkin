// Transactional test double. Emulator suite runs the same service against real Firestore.
const crypto=require('node:crypto');
const copy=value=>value===undefined?undefined:structuredClone(value);
class Ref{
    constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').at(-1);}
    async get(){return this.db.snapshot(this.path);}
    collection(name){return new Query(this.db,this.path+'/'+name);}
    async set(value){this.db.data.set(this.path,copy(value));}
    async update(value){if(!this.db.data.has(this.path))throw Error('not found');this.db.data.set(this.path,{...this.db.data.get(this.path),...copy(value)});}
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
        let rows=[...this.db.data.entries()].filter(([path])=>path.startsWith(this.path+'/')&&path.split('/').length===this.path.split('/').length+1).map(([path])=>this.db.snapshot(path));
        for(const [key,op,value]of this.filters)rows=rows.filter(row=>{const v=row.data()[key];return op==='=='?v===value:op==='in'?value.includes(v):op==='array-contains'?v?.includes(value):op==='array-contains-any'?value.some(x=>v?.includes(x)):op==='<='?v<=value:op==='>'?v>value:false;});
        rows.sort((a,b)=>{for(const [field,direction]of this.sorts){const av=a.data()[field],bv=b.data()[field];if(av!==bv)return(av<bv?-1:1)*(direction==='desc'?-1:1);}return(a.id<b.id?-1:1)*(this.sorts.at(-1)?.[1]==='desc'?-1:1);});
        if(this.cursor){const index=rows.findIndex(r=>r.id===this.cursor.id);rows=rows.slice(index+1);}
        rows=rows.slice(0,this.size);return{docs:rows,size:rows.length,empty:!rows.length};
    }
}
class MemoryDB{
    constructor(){this.data=new Map();this.queue=Promise.resolve();this.failAward=false;}
    doc(path){return new Ref(this,path);}collection(path){return new Query(this,path);}
    snapshot(path){const value=copy(this.data.get(path));return{id:path.split('/').at(-1),exists:value!==undefined,data:()=>copy(value)};}
    runTransaction(callback){
        const promise=this.queue.then(async()=>{
            const writes=[];
            const result=await callback({get:ref=>{if(writes.length)throw Error('Read after write');return ref.get();},set:(ref,data)=>writes.push(['set',ref,data]),create:(ref,data)=>writes.push(['create',ref,data]),update:(ref,data)=>writes.push(['update',ref,data])});
            if(this.failAward&&writes.some(([,ref])=>ref.path.startsWith('groups/'))){this.failAward=false;throw Error('simulated storage failure');}
            const next=new Map(this.data);
            for(const [type,ref,value]of writes){if(type==='create'&&next.has(ref.path))throw Error('already exists');if(type==='update'&&!next.has(ref.path))throw Error('not found');next.set(ref.path,type==='update'?{...next.get(ref.path),...copy(value)}:copy(value));}
            this.data=next;return result;
        });this.queue=promise.catch(()=>{});return promise;
    }
}
module.exports={MemoryDB};
