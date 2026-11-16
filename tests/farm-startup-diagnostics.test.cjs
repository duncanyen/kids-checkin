const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/farm/startup-diagnostics.js'),'utf8');
function fixture(){
 const alerts=[],jobs=[],listeners=new Map();
 const window={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name),setTimeout:fn=>jobs.push(fn),alert:text=>alerts.push(text)};
 const document={querySelector:()=>null,body:null,addEventListener:()=>{}};
 vm.runInNewContext(source,{window,document});
 return{api:window.farmStartupDiagnostics,window,listeners,alerts,flush:()=>{while(jobs.length)jobs.shift()();}};
}
test('startup alerts redact credentials/query strings and deduplicate the same caught error',()=>{
 const f=fixture(),error={name:'TypeError',message:'password="secret-test" token=opaque https://example.test/a.js?key=private#hidden',stack:'at https://example.test/a.js?token=secret:4:8'};
 f.api.report(error,{stage:'game-module',file:'https://example.test/a.js?token=secret',line:4,column:8});f.api.report(error);f.flush();
 assert.equal(f.alerts.length,1);assert.match(f.alerts[0],/game-module/);assert.match(f.alerts[0],/位置：4:8/);
 for(const secret of ['secret-test','opaque','?key=','?token=','#hidden'])assert.ok(!f.alerts[0].includes(secret),secret);
});
test('uncaught errors and rejections are captured without suppressing events; alerts stop after startup',()=>{
 const f=fixture();let prevented=false;
 f.listeners.get('error')({target:f.window,message:'uncaught',filename:'farm.js',lineno:12,colno:7,preventDefault:()=>{prevented=true;}});
 f.listeners.get('unhandledrejection')({reason:Error('async failure'),preventDefault:()=>{prevented=true;}});f.flush();
 assert.equal(prevented,false);assert.equal(f.alerts.length,2);
 f.api.finish();assert.equal(f.listeners.size,0);f.api.report(Error('runtime'));f.flush();assert.equal(f.alerts.length,2);
});
test('unrelated resource errors do not consume alerts and repeated frame errors cannot flood the page',()=>{
 const f=fixture();f.listeners.get('error')({target:{tagName:'IMG',src:'favicon.ico'}});
 f.api.report('repeated');f.api.report('repeated');f.api.report('second');f.api.report('third');f.api.report('fourth');f.flush();assert.equal(f.alerts.length,3);
});
