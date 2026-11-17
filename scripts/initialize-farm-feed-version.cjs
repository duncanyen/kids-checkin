// Run after deploying both version triggers. Existing versions are never reset.
const {createRequire}=require('node:module'),path=require('node:path'),crypto=require('node:crypto');
const local=createRequire(path.resolve(__dirname,'../game-admin/functions/package.json'));
async function main(){
 const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];
 if(!args.includes('--project')||!project||project.startsWith('--'))throw Error('請指定 --project');
 const {initializeApp}=local('firebase-admin/app'),{getFirestore}=local('firebase-admin/firestore');
 initializeApp({projectId:project});const ref=getFirestore().doc('ops_feed_versions/global'),snapshot=await ref.get();
 if(snapshot.data()?.revision){console.log('公告版本已存在，保留原值');return;}
 if(!args.includes('--apply')){console.log('唯讀檢查：尚未初始化；加 --apply 才會建立版本');return;}
 // Avoid racing a real announcement publication or a version trigger.
 if(snapshot.exists)throw Error('版本文件格式異常，停止覆寫');
 try{await ref.create({revision:crypto.randomUUID()});console.log('公告版本初始化完成');}catch(error){if(error.code===6||error.code==='already-exists')console.log('版本已由其他請求建立，保留原值');else throw error;}
}
if(require.main===module)main().catch(error=>{console.error('公告版本初始化失敗：',error.code||error.message);process.exitCode=1;});
