// Test-only MemoryDB IO counter; never connects to Firebase.
const {fixture}=require('../../game-admin/tests/helpers/refinement-fixture.cjs');
(async()=>{
 const f=await fixture(),base=f.db.runTransaction.bind(f.db),phases=[];
 f.db.runTransaction=callback=>base(async t=>{const stats={reads:0,writes:0};const tx=new Proxy(t,{get(target,key){if(key==='get')return async ref=>{const value=await target.get(ref);stats.reads+=value.docs?Math.max(1,value.size):1;return value;};if(['set','create','update','delete'].includes(key))return(...args)=>{stats.writes++;return target[key](...args);};return target[key];}});const result=await callback(tx);phases.push(stats);return result;});
 const quote=await f.quote(),quotePhases=phases.splice(0),id=require('node:crypto').randomUUID();await f.execute(quote,id);const executePhases=phases.splice(0);await f.execute(quote,id);const replayPhases=phases.splice(0);await f.call('getRefinementResult',{transactionId:id});const queryPhases=phases.splice(0);
 const result={environment:'MemoryDB / direct refinement service, fake actor validation, no throttle, no Auth RPC, no automatic retries, no report/mirror triggers',quotePhases,executePhases,replayPhases,queryPhases};console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
