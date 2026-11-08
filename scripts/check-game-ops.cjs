// Read-only preflight diagnostics. Uses curl's inherited proxy/CA configuration.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ORIGIN='https://duncanyen.github.io';
const NAMES=['gameOpsAdmin','gameOpsAnnouncements','gameOpsRedeem'];
function diagnose({status,origin,methods='',headers=''},expected=ORIGIN){
    if(!status)return {ok:false,code:'NETWORK_ERROR',message:'無法連線；請先檢查網路或環境代理，尚不能判斷線上函式狀態。'};
    if(status===404)return {ok:false,code:'NOT_FOUND',message:'找不到端點。確認專案、區域，並從 game-admin 部署 functions:nexus-ops。'};
    if(status===401||status===403)return {ok:false,code:'INGRESS_DENIED',message:'預檢遭入口拒絕。請核對 Cloud Run IAM／ingress；瀏覽器 OPTIONS 不攜帶 Google IAM 身分。'};
    if(status>=500)return {ok:false,code:'SERVER_ERROR',message:'服務無法正常回應。請檢查函式部署狀態、啟動與執行紀錄。'};
    if(status<200||status>=300)return {ok:false,code:'HTTP_ERROR',message:'預檢未成功；請檢查 HTTP 狀態及部署入口。'};
    if(origin!==expected&&origin!=='*')return {ok:false,code:'CORS_ORIGIN',message:'缺少或不符合 Access-Control-Allow-Origin。確認回應來自目前版本的 callable。'};
    if(!methods.toUpperCase().split(',').map(x=>x.trim()).includes('POST'))return {ok:false,code:'CORS_METHOD',message:'預檢未允許 POST。'};
    const allowed=headers.toLowerCase().split(',').map(x=>x.trim());
    if(!['authorization','content-type','x-firebase-appcheck'].every(h=>allowed.includes(h)))return {ok:false,code:'CORS_HEADERS',message:'預檢未允許 Firebase Auth／App Check 所需標頭。'};
    return {ok:true,code:'PREFLIGHT_OK',message:'預檢通過；這不代表登入、admin claim 或 App Check 驗證已通過。'};
}
function headerValues(raw){
    const last=raw.split(/\r?\n\r?\n/).filter(block=>/^HTTP\//i.test(block)).at(-1)||'';
    const values={};for(const line of last.split(/\r?\n/).slice(1)){const colon=line.indexOf(':');if(colon>0)values[line.slice(0,colon).toLowerCase()]=line.slice(colon+1).trim();}
    return values;
}
function probe(url){
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-ops-check-'));
    try{
        const head=path.join(temp,'headers'),body=path.join(temp,'body');
        const status=Number(execFileSync('curl',['--silent','--show-error','--max-time','20','--request','OPTIONS','--dump-header',head,'--output',body,'--write-out','%{http_code}',url,'-H',`Origin: ${ORIGIN}`,'-H','Access-Control-Request-Method: POST','-H','Access-Control-Request-Headers: authorization,content-type,x-firebase-appcheck'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
        const h=headerValues(fs.readFileSync(head,'utf8'));
        return {status,...diagnose({status,origin:h['access-control-allow-origin'],methods:h['access-control-allow-methods'],headers:h['access-control-allow-headers']})};
    }catch{return {status:0,...diagnose({status:0})};}
    finally{fs.rmSync(temp,{recursive:true,force:true});}
}
function main(args){
    const get=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
    if(args.includes('--help')){console.log('node scripts/check-game-ops.cjs [--project homebasedb] [--region asia-southeast1] [--base-url URL]');return;}
    const project=get('--project','homebasedb'),region=get('--region','asia-southeast1');
    const base=new URL(get('--base-url',`https://${region}-${project}.cloudfunctions.net`));
    if(!['http:','https:'].includes(base.protocol))throw Error('只支援 HTTP／HTTPS');
    let ok=true;
    for(const name of NAMES){const url=new URL(name,base.href.endsWith('/')?base.href:base.href+'/').href,result=probe(url);ok&&=result.ok;console.log(`${name}：HTTP ${result.status||'無回應'} / ${result.code}\n${url}\n${result.message}\n`);}
    const config=fs.readFileSync(path.resolve(__dirname,'../game-admin/site/config.js'),'utf8');
    if(/adminAppCheckRequired\s*:\s*true/.test(config)&&/appCheckSiteKey\s*:\s*(['"])\1/.test(config))console.log('管理站 appCheckSiteKey 目前為空。管理端已選擇強制 App Check，預檢通過後仍須設定 reCAPTCHA Enterprise site key。');
    if(!ok)process.exitCode=1;
}
module.exports={diagnose,headerValues};
if(require.main===module){try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
