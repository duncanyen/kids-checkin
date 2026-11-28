#!/usr/bin/env node
/** Local Auth/Functions + official SDK Firestore. Never deploys or accepts a project override. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const {setup,PIN}=require('./setup-firestore-emulator.cjs');
const ROOT=path.resolve(__dirname,'..'),PROJECT='demo-nexus-private-farm';
const SUITES=['game-admin/tests/private-callables.emulator.cjs','game-admin/tests/private-farm-rules.emulator.cjs'];
const FULL_SUITES=[...SUITES,'game-admin/tests/private-storage.emulator.cjs','game-admin/tests/private-realtime.emulator.cjs'];
function childEnv(source){
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(source[k]&&source[k]!==PROJECT)throw Error('拒絕非demo專案環境');
 const env={...source};
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_CONFIG','NODE_OPTIONS','FIRESTORE_EMULATOR_BINARY_PATH','DATABASE_EMULATOR_BINARY_PATH','STORAGE_EMULATOR_BINARY_PATH'])delete env[k];
 return{...env,PATH:path.dirname(process.execPath)+path.delimiter+(env.PATH||''),GCLOUD_PROJECT:PROJECT,GOOGLE_CLOUD_PROJECT:PROJECT,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8092',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098',FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9008',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9198',GCE_METADATA_HOST:'127.0.0.1:9',METADATA_SERVER_DETECTION:'none',FIREBASE_CLI_DISABLE_MOTD:'true'};
}
function result(text,exitCode,expected=6){
 const n=k=>Number(text.match(new RegExp('^# '+k+' (\\d+)\\s*$','m'))?.[1]||0),counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(k=>[k,n(k)]));
 const summaryPresent=['tests','pass','fail','cancelled','skipped'].every(k=>new RegExp('^# '+k+' \\d+\\s*$','m').test(text));
 const observedPass=(text.match(/^ok \d+ - /gm)||[]).length,observedFail=(text.match(/^not ok \d+ - /gm)||[]).length;
 return{...counts,summaryPresent,observedPass,observedFail,exitCode,passed:summaryPresent&&exitCode===0&&counts.tests===expected&&counts.pass===expected&&!counts.fail&&!counts.cancelled&&!counts.skipped&&!observedFail};
}
function parse(args){if(!args.length)return fs.mkdtempSync(path.join(os.tmpdir(),'nexus-callable-'));if(args.length!==2||args[0]!=='--output')throw Error('只接受 --output 空的本機目錄，不接受project/deploy/apply');return path.resolve(args[1]);}
function reserve(port){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(port+'已使用，不會停止既有程序')));s.listen(port,'127.0.0.1',()=>s.close(resolve));});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function stop(child,group=false){if(!child||child.exitCode!==null)return;const signal=s=>{try{if(group&&process.platform!=='win32')process.kill(-child.pid,s);else child.kill(s);}catch{}};signal('SIGTERM');await Promise.race([new Promise(r=>child.once('close',r)),pause(5000)]);if(child.exitCode===null)signal('SIGKILL');}
function options(args){if(args.filter(a=>a==='--full').length>1)throw Error('不可重複 --full');return{full:args.includes('--full'),out:parse(args.filter(a=>a!=='--full'))};}
function assertRuntime(version){if(String(version).split('.')[0]!=='22')throw Error('需要 Node 22，目前為 '+version+'；請先切換 Node，不會啟動 Emulator');}
function resolveCli(){try{return require.resolve('firebase-tools/lib/bin/firebase.js',{paths:[...(process.env.NEXUS_FIREBASE_TOOLS_DIR?[process.env.NEXUS_FIREBASE_TOOLS_DIR]:[]),path.resolve(process.execPath,'../../..'),path.join(ROOT,'functions'),ROOT]});}catch{throw Error('找不到 Firebase CLI；請設定 NEXUS_FIREBASE_TOOLS_DIR 為 tools 安裝目錄');}}
function emulatorPlan(full,root=ROOT){
 const config={functions:[{source:'live',codebase:'nexus-live',runtime:'nodejs22'},{source:'ops',codebase:'nexus-ops',runtime:'nodejs22'}],emulators:{auth:{host:'127.0.0.1',port:9098},functions:{host:'127.0.0.1',port:5008},ui:{enabled:false},singleProjectMode:true}};
 if(full){config.firestore={rules:path.join(root,'rules/firestore.private-farm.candidate.rules'),indexes:path.join(root,'firestore.indexes.json')};config.storage={rules:path.join(root,'rules/storage.private-farm.candidate.rules')};config.database={rules:path.join(root,'rules/database.private-farm.candidate.json')};config.emulators.firestore={host:'127.0.0.1',port:8092};config.emulators.storage={host:'127.0.0.1',port:9198};config.emulators.database={host:'127.0.0.1',port:9008};}
 return{config,externalFirestore:!full,only:full?'auth,functions,firestore,storage,database':'auth,functions',expectedTests:full?9:6};
}
function artifactDefinitions(cliPath,env){const metadata=require(path.join(path.dirname(path.dirname(path.dirname(cliPath))),'lib/emulator/downloadableEmulatorInfo.json')),cache=env.FIREBASE_EMULATORS_PATH||path.join(os.homedir(),'.cache/firebase/emulators');return ['firestore','database','storage'].map(name=>{const x=metadata[name];if(!x?.expectedChecksumSHA256)throw Error('Firebase CLI缺少官方套件SHA256：'+name);return{name,version:x.version,file:path.join(cache,x.downloadPathRelativeToCacheDir),expectedSha256:x.expectedChecksumSHA256};});}
function verifyArtifacts(definitions){const crypto=require('node:crypto');return definitions.map(x=>{const actualSha256=fs.existsSync(x.file)?crypto.createHash('sha256').update(fs.readFileSync(x.file)).digest('hex'):null;return{...x,actualSha256,verified:actualSha256===x.expectedSha256};});}
async function main(args=process.argv.slice(2)){
 assertRuntime(process.versions.node);
 if(process.platform==='win32')throw Error('此runner供Linux／Cloud Shell使用；Windows請使用既有隔離驗收包');
 const {full,out}=options(args),env=childEnv(process.env),suites=full?FULL_SUITES:SUITES,plan=emulatorPlan(full),cliPath=resolveCli();fs.mkdirSync(out,{recursive:true,mode:0o700});if(fs.readdirSync(out).length)throw Error('輸出目錄非空，拒絕覆寫既有證據');
 for(const p of [8092,5008,9098,9008,9198,4400,4500,...(full?[9150]:[])])await reserve(p);
 const info=full?{distribution:'firebase-tools',artifacts:artifactDefinitions(cliPath,env)}:{distribution:'cloud-sdk',...setup()};
 execFileSync(process.execPath,['scripts/prepare-game-admin.cjs'],{cwd:ROOT,env,stdio:'inherit'});execFileSync(process.execPath,['scripts/prepare-growth-forest.cjs'],{cwd:ROOT,env,stdio:'inherit'});
 const sourceSha256=require('./lib/firestore-emulator-proof.cjs').hashes(ROOT),crypto=require('node:crypto'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex'),testHashes=Object.fromEntries([...suites,'scripts/run-refinement-callable-tests.cjs'].map(p=>[p,hash(p)]));
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-callable-source-'));
 const report={schema:1,project:PROJECT,scope:full?'CLI-managed Auth/Functions/Firestore/Storage/RTDB and candidate Rules; background triggers registered but not individually accepted; excludes App Check and physical devices':'Real Auth/Functions HTTP and official Firestore, candidate Firestore Rules; excludes RTDB, Storage, background triggers, App Check and physical devices',fullRequested:full,startedAt:new Date().toISOString(),passed:false,formalData:false,deployed:false,refinementPlayerFeaturesEnabled:false,emulator:info,firestoreManagedBy:full?'firebase-cli':'external-sdk',sourceSha256,testHashes};
 let firestore,cli,serverFd,logFd;
 try{
  for(const [name,src]of [['live','functions'],['ops','game-admin/functions']]){
   const target=path.join(workspace,name);fs.cpSync(path.join(ROOT,src),target,{recursive:true,filter:p=>path.basename(p)!=='node_modules'&&!path.basename(p).startsWith('.env')});
   fs.symlinkSync(fs.realpathSync(path.join(ROOT,src,'node_modules')),path.join(target,'node_modules'),'dir');
   fs.writeFileSync(path.join(target,'.env.local'),'NEXUS_PRIVATE_IDENTITY_ENABLED=true\nNEXUS_FARM_BACKEND_ENABLED=true\nNEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED=false\n',{mode:0o600});
  }
  const configPath=path.join(workspace,'firebase.json');fs.writeFileSync(configPath,JSON.stringify(plan.config));
  if(plan.externalFirestore){serverFd=fs.openSync(path.join(out,'firestore.log'),'w');
  firestore=spawn('java',['-Duser.language=en','-cp',info.jar,PIN.mainClass,'--host','127.0.0.1','--port','8092','--project_id',PROJECT,'--single_project_mode','true','--rules',path.join(ROOT,'rules/firestore.private-farm.candidate.rules')],{cwd:workspace,env,stdio:['ignore',serverFd,serverFd]});
  let ready=false;for(let i=0;i<120;i++){if(firestore.exitCode!==null)throw Error('Firestore啟動失敗');try{const r=await fetch('http://127.0.0.1:8092/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE',signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await pause(200);}if(!ready)throw Error('Firestore未就緒');}
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'",command=[process.execPath,'--test','--test-concurrency=1',...suites.map(p=>path.join(ROOT,p))].map(quote).join(' ');
  logFd=fs.openSync(path.join(out,'callable.log'),'w');cli=spawn(process.execPath,[cliPath,'emulators:exec','--non-interactive','--config',configPath,'--project',PROJECT,'--only',plan.only,command],{cwd:workspace,env,detached:true,stdio:['ignore',logFd,logFd]});
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{report.timedOut=true;void stop(cli,true);},240000);cli.once('error',e=>{clearTimeout(timer);reject(e);});cli.once('close',code=>{clearTimeout(timer);resolve(code);});});
  report.tests=result(fs.readFileSync(path.join(out,'callable.log'),'utf8'),exit,plan.expectedTests);report.sourceChangedDuringRun=JSON.stringify(sourceSha256)!==JSON.stringify(require('./lib/firestore-emulator-proof.cjs').hashes(ROOT))||Object.entries(testHashes).some(([p,h])=>hash(p)!==h);if(full)report.artifacts=verifyArtifacts(info.artifacts);report.passed=report.tests.passed&&!report.timedOut&&!report.sourceChangedDuringRun&&(!full||report.artifacts.every(x=>x.verified));
 }catch(e){report.error=e.message;}finally{
  await stop(cli,true);await stop(firestore);if(serverFd!==undefined)fs.closeSync(serverFd);if(logFd!==undefined)fs.closeSync(logFd);
  for(const name of ['firebase-debug.log','ui-debug.log','firestore-debug.log','database-debug.log']){const p=path.join(workspace,name);if(fs.existsSync(p))fs.copyFileSync(p,path.join(out,name));}
  if(full&&fs.existsSync(path.join(out,'firestore-debug.log')))fs.copyFileSync(path.join(out,'firestore-debug.log'),path.join(out,'firestore.log'));
  fs.rmSync(workspace,{recursive:true,force:true});report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({output:out,passed:report.passed,tests:report.tests,error:report.error}));if(!report.passed)process.exitCode=1;return report;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={childEnv,result,parse,options,assertRuntime,emulatorPlan,artifactDefinitions,verifyArtifacts,main};
