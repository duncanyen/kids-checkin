/** Phase 2 emulator-only CLI. Default dry-run; never accepts production projects. */
const {createWeaponMigration}=require('../game-admin/functions/migrations/weapon-instances.cjs');
async function main(){
 const args=process.argv.slice(2),values={},allowed=new Set(['--project','--profile','--group','--account','--generation','--fingerprint','--step','--batch-size']);let apply=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--dry-run'){values.dryRun=true;continue;}if(args[i]==='--apply'){apply=true;continue;}if(!allowed.has(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('參數無效');values[args[i]]=args[++i];}
 if(values.dryRun&&(apply||values['--step']&&values['--step']!=='review'))throw Error('--dry-run 只能唯讀 review，不能搭配 --apply');
 const project=values['--project'],host=process.env.FIRESTORE_EMULATOR_HOST;
 if(!/^demo-[a-z0-9-]+$/.test(project||'')||!/^((127\.0\.0\.1)|(localhost)|(\[::1\])):[0-9]+$/.test(host||''))throw Error('僅允許明確指定 demo-* 專案與本機 FIRESTORE_EMULATOR_HOST；拒絕正式資料連線');
 if(process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT!==project)throw Error('專案環境不一致');
 const actor={uid:values['--profile'],groupId:values['--group'],accountId:values['--account']};const D=require('../game-admin/functions/domain.cjs');Object.values(actor).forEach(D.id);
 const sdk=require('./firebase-admin-sdk.cjs'),{initializeApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore'),app=initializeApp({projectId:project});
 const migration=createWeaponMigration({db:getFirestore(app),testEnvironment:true}),step=values['--step']||'review';let result;
 if(step==='review')result=await migration.review(actor);
 else if(step==='verify')result=await migration.verify(actor);
 else {if(!apply)throw Error('寫入隔離測試資料需 --apply；預設只執行 review');if(step==='stage')result=await migration.stage(actor,{generation:values['--generation'],expectedFingerprint:values['--fingerprint']});else if(step==='resume')result=await migration.resume(actor,{batchSize:values['--batch-size']===undefined?20:Number(values['--batch-size'])});else if(step==='rollback')result=await migration.rollback(actor);else throw Error('未知 step');}
 console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.code||'migration-stopped',error.message);process.exitCode=1;});
module.exports={main};
