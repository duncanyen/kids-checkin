// Web 交易不能讀 Query：先找有界候選，再於交易重讀文件，並以群組修訂鎖協調森林寫入。
/**
 * 將共用服務需要的 db 介面轉接至 Firebase Web SDK，延後所有寫入直到讀取完成。
 * @param {Object} sdk - Firebase Firestore Web SDK。
 * @param {Object} firebaseDb - Firestore 實例。
 * @param {string} groupId - growthSync/main 修訂鎖的群組範圍。
 * @param {Function} [assertCurrent] - 每次讀寫前確認帳號與群組未切換。
 * @returns {Object} doc、collection 與 runTransaction 相容介面。
 * @description Web 交易不能讀 Query；先取候選再逐份重讀，最多 2000 筆，超限拒絕。
 */
export function createFirestoreStore(sdk, firebaseDb, groupId, assertCurrent = () => {}) {
    const MAX_ROWS=2000;
    const wrap=snap=>({id:snap.id,exists:snap.exists(),data:()=>snap.data()});
    const value=(row,key)=>key==='__name__'?row.id:row.data()?.[key];
    const comparable=v=>v?.toMillis?.()??v;
    const match=(v,op,w)=>op==='=='?v===w:op==='in'?w.includes(v):op==='array-contains'?Array.isArray(v)&&v.includes(w):op==='>='?v>=w:op==='<='?v<=w:op==='>'?v>w:op==='<'?v<w:false;
    class Document {
        constructor(path){this.path=path;this.id=path.split('/').at(-1);this.kind='document';this.native=sdk.doc(firebaseDb,...path.split('/'));}
        async get(){assertCurrent();return wrap(await sdk.getDocFromServer(this.native));}
    }
    class Query {
        constructor(path,filters=[],orders=[],maximum=Infinity,cursor=null){Object.assign(this,{path,filters,orders,maximum,cursor,kind:'query'});}
        doc(id){return new Document(this.path+'/'+id);}
        where(...filter){return new Query(this.path,[...this.filters,filter],this.orders,this.maximum,this.cursor);}
        orderBy(...order){return new Query(this.path,this.filters,[...this.orders,order],this.maximum,this.cursor);}
        limit(maximum){return new Query(this.path,this.filters,this.orders,maximum,this.cursor);}
        startAfter(cursor){return new Query(this.path,this.filters,this.orders,this.maximum,cursor);}
        compare(a,b){for(const [key,direction]of this.orders){const x=comparable(value(a,key)),y=comparable(value(b,key));if(x!==y)return(x<y?-1:1)*(direction==='desc'?-1:1);}return a.id.localeCompare(b.id)*(this.orders.at(-1)?.[1]==='desc'?-1:1);}
        select(rows){
            let result=rows.filter(row=>row.exists&&this.filters.every(([key,op,w])=>match(comparable(value(row,key)),op,w))&&this.orders.every(([key])=>value(row,key)!==undefined));
            result.sort((a,b)=>this.compare(a,b));if(this.cursor)result=result.filter(row=>this.compare(row,this.cursor)>0);
            const docs=result.slice(0,this.maximum);return{docs,size:docs.length,empty:!docs.length};
        }
        async candidates(){
            assertCurrent();
            // 暫行模式只將 accountId 的等值／in 條件送往伺服器，避免依賴未部署的複合索引；其餘篩選排序本機處理並設上限。
            const scope=this.filters.find(([key,op])=>key==='accountId'&&['==','in'].includes(op));
            const source=sdk.query(sdk.collection(firebaseDb,...this.path.split('/')),...(scope?[sdk.where(...scope)]:[]),sdk.limit(MAX_ROWS+1));
            const result=await sdk.getDocsFromServer(source);
            if(result.size>MAX_ROWS)throw Object.assign(Error('目前資料量超過前端暫行模式上限，請改用後端模式處理。'),{code:'resource-exhausted'});
            return result.docs.map(wrap);
        }
        async get(){return this.select(await this.candidates());}
    }
    const revision=new Document(`groups/${groupId}/growthSync/main`);
    return{
        doc:path=>new Document(path),collection:path=>new Query(path),
        runTransaction:callback=>sdk.runTransaction(firebaseDb,async native=>{
            assertCurrent();const version=wrap(await native.get(revision.native)),writes=[],reads=new Map();
            const readDoc=ref=>{if(!reads.has(ref.path))reads.set(ref.path,native.get(ref.native));return reads.get(ref.path);};
            const queue=(kind,ref,data,options)=>{if(kind==='create'&&writes.some(w=>w.ref.path===ref.path))throw Object.assign(Error('同一交易重複建立相同文件'),{code:'already-exists'});writes.push({kind,ref,data,options});};
            const transaction={
                async get(source){
                    if(source.kind==='document')return wrap(await readDoc(source));
                    const candidates=await source.candidates(),rows=await Promise.all(candidates.map(row=>readDoc(new Document(source.path+'/'+row.id)).then(wrap)));
                    return source.select(rows);
                },
                create:(ref,data)=>queue('create',ref,data),set:(ref,data,options)=>queue('set',ref,data,options),update:(ref,data)=>queue('update',ref,data)
            };
            const result=await callback(transaction);
            assertCurrent();
            // 包含 create 存在檢查在內，所有讀取必須先於 Web SDK 寫入。
            for(const write of writes.filter(w=>w.kind==='create'))if((await readDoc(write.ref)).exists())throw Object.assign(Error('此紀錄已存在，請重新整理。'),{code:'already-exists'});
            assertCurrent();
            for(const write of writes){if(write.kind==='update')native.update(write.ref.native,write.data);else if(write.options)native.set(write.ref.native,write.data,write.options);else native.set(write.ref.native,write.data);}
            if(writes.length)native.set(revision.native,{revision:(version.data()?.revision||0)+1,updatedAt:Date.now()});
            return result;
        })
    };
}
