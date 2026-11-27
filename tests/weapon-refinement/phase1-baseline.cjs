const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,spawnSync}=require('node:child_process'),net=require('node:net');
// Phase 1 test-only runner: existing local fixtures, no deployment or production data.
const root=path.resolve(__dirname,'../..'),out=process.env.PHASE1_BASELINE_DIR||path.join(os.tmpdir(),'nexus-phase1-baseline-'+Date.now()),node=process.execPath;
fs.mkdirSync(out,{recursive:true});
process.chdir(root);
const summary={sourceCommit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),node:process.version,startedAt:new Date().toISOString(),results:[]};
const persist=()=>fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
function run(id,args,env={}){return new Promise(resolve=>{
 const file=path.join(out,id+'.log'),fd=fs.openSync(file,'w'),start=Date.now();
 const child=spawn(node,args,{cwd:root,env:{...process.env,...env},stdio:['ignore',fd,fd]});let timedOut=false;
 const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},240000);
 child.on('error',error=>{fs.appendFileSync(file,error.message);});
 child.on('close',(code,signal)=>{clearTimeout(timeout);fs.closeSync(fd);const result={id,args,exitCode:code,signal,timedOut,durationMs:Date.now()-start,log:file,status:code===0?'passed':'failed'};summary.results.push(result);persist();console.log(id+': '+result.status);resolve(result);});
 });}
(async()=>{
 for(const script of ['scripts/prepare-game-admin.cjs','scripts/prepare-growth-forest.cjs']){const r=await run(path.basename(script,'.cjs'),[script]);if(r.status!=='passed')return;}
 const units=['tests','game-admin/tests'].flatMap(dir=>fs.readdirSync(dir).filter(name=>/\.test\.(cjs|mjs)$/.test(name)).map(name=>path.join(dir,name)));
 await run('units',['--test',...units]);
 const port=await new Promise(resolve=>{const server=net.createServer().listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 try{
  const base='http://127.0.0.1:'+port;
  for(let tries=0;tries<40;tries++){try{if((await fetch(base+'/farmgame.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  const common={AUTH_BASE_URL:base,SETTINGS_BASE_URL:base,FARM_BASE_URL:base,ADMIN_BASE_URL:base,OPS_UI_BASE:base+'/game-admin/site',NODE_OPTIONS:'--require='+path.join(__dirname,'browser-guard.cjs')};
  const jobs=['account-login','private-auth-browser','settings-profile-browser','private-admin-browser','farm-save-browser','farm-private-backend-browser','farm-public-art-cache-browser','farm-daily-assets-browser'].map(id=>({id,args:['tests/'+id+'.cjs'],env:{}}));
  jobs.push({id:'ops-management',args:['game-admin/tests/management.browser.cjs'],env:{}});
  for(const mode of ['COUNTDOWN_TESTS','CHEST_BATCH_TESTS','SHOP_STOCK_TESTS','COMBAT_FEEDBACK_TESTS','CRITICAL_FEEDBACK_TESTS','CRITICAL_ZERO_TESTS','HALLSTATT_SCENE_TESTS','VISIT_HUD_TESTS','FARM_SCENE_TESTS','ARCTIC_SCENE_TESTS','NAVIGATION_LOAD_TESTS','GUARD_RENTAL_TESTS','DAILY_GROUP_TESTS','WEEKLY_RANKING_TESTS','HORNET_TESTS','KATANA_TESTS','ENCOUNTER_CONFIG_TESTS','CHEST_FLOW_TESTS'])jobs.push({id:mode.toLowerCase(),args:['tests/farm-private-backend-browser.cjs'],env:{[mode]:'1'}});
  jobs.push({id:'chest-art-failure',args:['tests/farm-private-backend-browser.cjs'],env:{CHEST_FLOW_TESTS:'1',CHEST_ART_FAIL:'1'}});
  jobs.push({id:'scene-legacy-price',args:['tests/farm-private-backend-browser.cjs'],env:{ARCTIC_SCENE_TESTS:'1',LEGACY_SCENE_PURCHASE_BACKEND:'1'}});
  await Promise.all(Array.from({length:2},async()=>{while(jobs.length){const job=jobs.shift();await run(job.id,job.args,{...common,...job.env});}}));
 }finally{server.kill();summary.finishedAt=new Date().toISOString();persist();if(summary.results.some(r=>r.status!=='passed'))process.exitCode=1;}
})().catch(error=>{summary.error=error.message;persist();console.error(error.message);process.exitCode=1;});
