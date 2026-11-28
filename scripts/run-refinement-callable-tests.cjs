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
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_CONFIG','NODE_OPTIONS'])delete env[k];
 return{...env,PATH:path.dirname(process.execPath)+path.delimiter+(env.PATH||''),GCLOUD_PROJECT:PROJECT,GOOGLE_CLOUD_PROJECT:PROJECT,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8092',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098',FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9008',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9198',GCE_METADATA_HOST:'127.0.0.1:9',METADATA_SERVER_DETECTION:'none',FIREBASE_CLI_DISABLE_MOTD:'true'};
}
function result(text,exitCode,expected=6){
 const n=k=>Number(text.match(new RegExp('^# '+k+' (\\d+)\\s*$','m'))?.[1]||0),counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(k=>[k,n(k)]));
 return{...counts,exitCode,passed:exitCode===0&&counts.tests===expected&&counts.pass===expected&&!counts.fail&&!counts.cancelled&&!counts.skipped&&!/^not ok /m.test(text)};
}
function parse(args){if(!args.length)return fs.mkdtempSync(path.join(os.tmpdir(),'nexus-callable-'));if(args.length!==2||args[0]!=='--output')throw Error('只接受 --output 空的本機目錄，不接受project/deploy/apply');return path.resolve(args[1]);}
function reserve(port){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(port+'已使用，不會停止既有程序')));s.listen(port,'127.0.0.1',()=>s.close(resolve));});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function stop(child,group=false){if(!child||child.exitCode!==null)return;const signal=s=>{try{if(group&&process.platform!=='win32')process.kill(-child.pid,s);else child.kill(s);}catch{}};signal('SIGTERM');await Promise.race([new Promise(r=>child.once('close',r)),pause(5000)]);if(child.exitCode===null)signal('SIGKILL');}
function options(args){if(args.filter(a=>a==='--full').length>1)throw Error('不可重複 --full');return{full:args.includes('--full'),out:parse(args.filter(a=>a!=='--full'))};}
async function main(args=process.argv.slice(2)){
 if(process.platform==='win32')throw Error('此runner供Linux／Cloud Shell使用；Windows請使用既有隔離驗收包');
 const {full,out}=options(args),env=childEnv(process.env),suites=full?FULL_SUITES:SUITES;fs.mkdirSync(out,{recursive:true,mode:0o700});if(fs.readdirSync(out).length)throw Error('輸出目錄非空，拒絕覆寫既有證據');
 for(const p of [8092,5008,9098,9008,9198,4400,4500])await reserve(p);
 const info=setup(),sourceSha256=require('./lib/firestore-emulator-proof.cjs').hashes(ROOT),crypto=require('node:crypto'),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex'),testHashes=Object.fromEntries([...suites,'scripts/run-refinement-callable-tests.cjs'].map(p=>[p,hash(p)]));
 execFileSync(process.execPath,['scripts/prepare-game-admin.cjs'],{cwd:ROOT,env,stdio:'inherit'});execFileSync(process.execPath,['scripts/prepare-growth-forest.cjs'],{cwd:ROOT,env,stdio:'inherit'});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-callable-source-'));
 const report={schema:1,project:PROJECT,scope:full?'Real Auth/Functions HTTP, official Firestore, Storage/RTDB and candidate Rules; excludes background triggers, App Check and physical devices':'Real Auth/Functions HTTP and official Firestore, candidate Firestore Rules; excludes RTDB, Storage, background triggers, App Check and physical devices',fullRequested:full,startedAt:new Date().toISOString(),passed:false,formalData:false,deployed:false,refinementPlayerFeaturesEnabled:false,emulator:{...PIN,jar:info.jar},sourceSha256,testHashes};
 let firestore,cli,serverFd,logFd;
 try{
  for(const [name,src]of [['live','functions'],['ops','game-admin/functions']]){
   const target=path.join(workspace,name);fs.cpSync(path.join(ROOT,src),target,{recursive:true,filter:p=>path.basename(p)!=='node_modules'&&!path.basename(p).startsWith('.env')});
   fs.symlinkSync(fs.realpathSync(path.join(ROOT,src,'node_modules')),path.join(target,'node_modules'),'dir');
   fs.writeFileSync(path.join(target,'.env.local'),'NEXUS_PRIVATE_IDENTITY_ENABLED=true\nNEXUS_FARM_BACKEND_ENABLED=true\nNEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED=false\n',{mode:0o600});
  }
  const config={functions:[{source:'live',codebase:'nexus-live',runtime:'nodejs22'},{source:'ops',codebase:'nexus-ops',runtime:'nodejs22'}],emulators:{auth:{host:'127.0.0.1',port:9098},functions:{host:'127.0.0.1',port:5008},ui:{enabled:false},singleProjectMode:true}};
  if(full){config.storage={rules:path.join(ROOT,'rules/storage.private-farm.candidate.rules')};config.database={rules:path.join(ROOT,'rules/database.private-farm.candidate.json')};config.emulators.storage={host:'127.0.0.1',port:9198};config.emulators.database={host:'127.0.0.1',port:9008};}
  const configPath=path.join(workspace,'firebase.json');fs.writeFileSync(configPath,JSON.stringify(config));serverFd=fs.openSync(path.join(out,'firestore.log'),'w');
  firestore=spawn('java',['-Duser.language=en','-cp',info.jar,PIN.mainClass,'--host','127.0.0.1','--port','8092','--project_id',PROJECT,'--single_project_mode','true','--rules',path.join(ROOT,'rules/firestore.private-farm.candidate.rules')],{cwd:workspace,env,stdio:['ignore',serverFd,serverFd]});
  let ready=false;for(let i=0;i<120;i++){if(firestore.exitCode!==null)throw Error('Firestore啟動失敗');try{const r=await fetch('http://127.0.0.1:8092/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE',signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await pause(200);}if(!ready)throw Error('Firestore未就緒');
  const cliPath=require.resolve('firebase-tools/lib/bin/firebase.js',{paths:[path.resolve(process.execPath,'../../..'),path.join(ROOT,'functions'),ROOT]}),quote=s=>"'"+s.replaceAll("'","'\\''")+"'",command=[process.execPath,'--test','--test-concurrency=1',...suites.map(p=>path.join(ROOT,p))].map(quote).join(' ');
  logFd=fs.openSync(path.join(out,'callable.log'),'w');cli=spawn(process.execPath,[cliPath,'emulators:exec','--non-interactive','--config',configPath,'--project',PROJECT,'--only',full?'auth,functions,storage,database':'auth,functions',command],{cwd:workspace,env,detached:true,stdio:['ignore',logFd,logFd]});
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{report.timedOut=true;void stop(cli,true);},240000);cli.once('error',e=>{clearTimeout(timer);reject(e);});cli.once('close',code=>{clearTimeout(timer);resolve(code);});});
  report.tests=result(fs.readFileSync(path.join(out,'callable.log'),'utf8'),exit,full?9:6);report.sourceChangedDuringRun=JSON.stringify(sourceSha256)!==JSON.stringify(require('./lib/firestore-emulator-proof.cjs').hashes(ROOT))||Object.entries(testHashes).some(([p,h])=>hash(p)!==h);report.passed=report.tests.passed&&!report.timedOut&&!report.sourceChangedDuringRun;
 }catch(e){report.error=e.message;}finally{
  await stop(cli,true);await stop(firestore);if(serverFd!==undefined)fs.closeSync(serverFd);if(logFd!==undefined)fs.closeSync(logFd);
  for(const name of ['firebase-debug.log','ui-debug.log']){const p=path.join(workspace,name);if(fs.existsSync(p))fs.copyFileSync(p,path.join(out,name));}
  fs.rmSync(workspace,{recursive:true,force:true});report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({output:out,passed:report.passed,tests:report.tests,error:report.error}));if(!report.passed)process.exitCode=1;return report;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={childEnv,result,parse,options,main};
