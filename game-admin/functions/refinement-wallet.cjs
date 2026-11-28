/** Written in the SAME transaction as the wallet/state/receipt. No historical backfill. */
const D=require('./domain.cjs'),W=require('./weapon-repository.cjs');
const path=(actor,id)=>'ops_refinement_wallet/'+D.hash(actor.uid+':'+id);
function record(t,db,{actor,id,fingerprint,action,before,after,amount,stamp}){
 const scope=W.scope(actor),receiptPath='ops_refinement_transactions/'+D.hash(actor.uid+':'+id),balance=v=>({coins:D.integer(v.coins,0,Number.MAX_SAFE_INTEGER),stones:D.integer(v.stones,0,Number.MAX_SAFE_INTEGER)}),b=balance(before),a=balance(after),cost=balance(amount),sign=action==='resetRefinement'?1:-1;
 if(!['refineWeapon','resetRefinement'].includes(action)||!['coins','stones'].every(k=>BigInt(b[k])+BigInt(sign)*BigInt(cost[k])===BigInt(a[k])))D.fail('failed-precondition','資源帳本與交易不符');
 const row={schemaVersion:1,ownerId:scope,transactionId:id,receiptPath,fingerprint,action,before:b,after:a,amount:cost,createdAt:stamp};t.create(db.doc(path(actor,id)),row);
}
module.exports={path,record};
