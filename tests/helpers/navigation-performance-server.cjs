// No Playwright routing: HTTP cache remains enabled. Firebase URLs are rewritten
// server-side to an in-memory fixture; production credentials/data are never used.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
module.exports=async function start({baseline=false,chartPath=process.env.CHART_FIXTURE||'/tmp/nexus-chart-baseline.js',delays={},failures={},overrides={},gates={}}={}){
 const baselineRef=process.env.BASELINE_REF||'55eb456';const requests=[],bodies=new Map();
 function read(file){
  if(overrides[file])return Buffer.from(overrides[file]);
  const key=baseline?'baseline:'+file:file;
  if(baseline&&bodies.has(key))return bodies.get(key);
  let body;
  if(baseline&&/\.(js|css|html)$/.test(file)&&!file.startsWith('tests/')){
   try{body=execFileSync('git',['show',`${baselineRef}:${file}`],{cwd:root,stdio:['ignore','pipe','ignore']});}catch{body=fs.readFileSync(path.join(root,file));}
  }else body=fs.readFileSync(path.join(root,file));
  if(baseline)bodies.set(key,body);return body;
 }
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture'),name=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
  let body,type='application/octet-stream';
  try{
   if(gates[url.pathname])await gates[url.pathname];
   if(delays[url.pathname])await new Promise(resolve=>setTimeout(resolve,delays[url.pathname]));
   if(failures[url.pathname]){requests.push({path:url.pathname,status:failures[url.pathname]});res.writeHead(failures[url.pathname]);res.end('fixture failure');return;}
   if(name.startsWith('__sdk/')){body=overrides.__sdk ? Buffer.from(overrides.__sdk) : fs.readFileSync(path.join(root,'tests/fixtures/navigation-performance-sdk.js'));type='text/javascript';}
   else if(name==='__cdn/chart.js'){body=fs.readFileSync(chartPath);type='text/javascript';}
   else if(name==='__avatar.svg'){body=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>');type='image/svg+xml';}
   else{
    if(name.includes('..')||name.startsWith('.git'))throw Error('invalid path');
    body=read(name);
    type=name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.webmanifest')?'application/manifest+json':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':type;
    if(/\.(html|js|css)$/.test(name)){
     body=Buffer.from(body.toString().replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.19\.0\//g,'/__sdk/')
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js(?:@[\w.-]+\/dist\/[\w.-]+\.js)?/g,'/__cdn/chart.js')
      .replaceAll('https://ui-avatars.com/api/','/__avatar.svg'));
    }
   }
   const etag='"'+crypto.createHash('sha256').update(body).digest('hex')+'"';
   const status=req.headers['if-none-match']===etag?304:200;
   requests.push({path:url.pathname,purpose:req.headers.purpose||req.headers['sec-purpose']||null,status,bodyBytes:status===200?body.length:0});
   // An explicit controlled policy, not a claim about production hosting.
   res.writeHead(status,{'Content-Type':type,'Cache-Control':name.endsWith('.html')?'no-cache':'public, max-age=300',ETag:etag,'Timing-Allow-Origin':'*'});
   res.end(status===304?undefined:body);
  }catch(e){requests.push({path:url.pathname,status:404});res.writeHead(404);res.end('Not found');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{base:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(resolve=>server.close(resolve))};
};
