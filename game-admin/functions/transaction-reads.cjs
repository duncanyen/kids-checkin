/** 單次 Firestore 交易嘗試內共用文件讀取；重試時必須重新建立，不能快取跨請求的權限。 */
function reuseTransactionReads(transaction){
 const reads=new Map();let writing=false;
 return new Proxy(transaction,{
  get(target,key){
   if(key==='get')return ref=>{
    // Query 仍依原條件執行；寫入後也交回原 SDK，以保留 read-before-write 的檢查。
    if(writing||typeof ref?.path!=='string'||typeof ref.collection!=='function')return target.get(ref);
    if(!reads.has(ref.path))reads.set(ref.path,Promise.resolve().then(()=>target.get(ref)));
    return reads.get(ref.path);
   };
   const value=Reflect.get(target,key,target);
   if(['create','set','update','delete'].includes(key))return(...args)=>{writing=true;return value.apply(target,args);};
   return typeof value==='function'?value.bind(target):value;
  }
 });
}
module.exports={reuseTransactionReads};
