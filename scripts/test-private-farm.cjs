/** 只執行隔離驗證，不部署；失敗報告不會被標記為可上線。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process'),net=require('node:net');
const root=path.resolve(__dirname,'..');process.chdir(root);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={schema:1,unitPassed:false,browserPassed:false,emulatorPassed:false,rulesSha256:hash('rules/firestore.private-farm.candidate.rules'),storageRulesSha256:hash('rules/storage.private-farm.candidate.rules'),databaseRulesSha256:hash('rules/database.private-farm.candidate.json'),createdAt:new Date().toISOString()};
const output=process.env.PRIVATE_FARM_REPORT||'/tmp/nexus-private-verification.json';
const run=(command,args,env=process.env)=>{const r=spawnSync(command,args,{stdio:'inherit',env,timeout:240000});if(r.error||r.status!==0)throw Error('隔離驗證未通過：'+path.basename(command));};
async function main(){
 run(process.execPath,['scripts/prepare-game-admin.cjs']);run(process.execPath,['scripts/prepare-growth-forest.cjs']);
 report.codeSha256=require('./private-code-hash.cjs')();
 const units=['tests','game-admin/tests'].flatMap(dir=>fs.readdirSync(dir).filter(name=>/\.test\.(cjs|mjs)$/.test(name)).map(name=>path.join(dir,name)));
 run(process.execPath,['--test',...units]);report.unitPassed=true;
 if(!fs.existsSync(process.env.PHASER_FIXTURE||'/tmp/kids-phaser.js'))throw Error('缺少 Phaser 測試檔，請設定 PHASER_FIXTURE（目前遊戲版本 3.60.0）');
 const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{stdio:'ignore'});
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<40;i++){try{if((await fetch(base+'/index.html')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,150));}
  if(!ready)throw Error('隔離 HTTP Server 未啟動');
  const env={...process.env,AUTH_BASE_URL:base,SETTINGS_BASE_URL:base,FARM_BASE_URL:base,ADMIN_BASE_URL:base};
  for(const file of ['account-login.cjs','private-auth-browser.cjs','settings-profile-browser.cjs','private-admin-browser.cjs','farm-save-browser.cjs','farm-private-backend-browser.cjs'])run(process.execPath,['tests/'+file],env);
  for(const mode of [{ARCTIC_SCENE_TESTS:'1'},{NAVIGATION_LOAD_TESTS:'1'},{GUARD_RENTAL_TESTS:'1'},{DAILY_GROUP_TESTS:'1'},{WEEKLY_RANKING_TESTS:'1'},{HORNET_TESTS:'1'},{KATANA_TESTS:'1'},{ENCOUNTER_CONFIG_TESTS:'1'},{CHEST_FLOW_TESTS:'1'},{CHEST_FLOW_TESTS:'1',CHEST_ART_FAIL:'1'}])run(process.execPath,['tests/farm-private-backend-browser.cjs'],{...env,...mode});
  for(const file of ['farm-public-art-cache-browser.cjs','farm-daily-assets-browser.cjs'])run(process.execPath,['tests/'+file],env);
  run(process.execPath,['game-admin/tests/management.browser.cjs'],{...env,OPS_UI_BASE:'http://127.0.0.1:'+port+'/game-admin/site'});
  report.browserPassed=true;
 }finally{server.kill();}
 if(process.argv.includes('--emulator')){
  const command=process.env.FIREBASE_BIN||'firebase';
  // Cloud Shell 可能繼承正式 GOOGLE_CLOUD_PROJECT；Admin SDK 優先使用它，需與 Emulator 的 demo 專案一致。
  run(command,['emulators:exec','--config','firebase.private-farm-review.json','--project','demo-nexus-private-farm','--only','firestore,storage,database,auth,functions','node --test --test-concurrency=1 game-admin/tests/private-farm-rules.emulator.cjs game-admin/tests/private-storage.emulator.cjs game-admin/tests/private-realtime.emulator.cjs game-admin/tests/private-callables.emulator.cjs'],{...process.env,GOOGLE_CLOUD_PROJECT:'demo-nexus-private-farm',GCLOUD_PROJECT:'demo-nexus-private-farm',NEXUS_PRIVATE_IDENTITY_ENABLED:'true',NEXUS_FARM_BACKEND_ENABLED:'true'});
  report.emulatorPassed=true;
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('驗證報告：'+output);if(!report.emulatorPassed)console.log('Emulator 未通過，這份報告不能啟用正式環境。');});
