import {labFetch} from './client.js';
const $=id=>document.getElementById(id),show=v=>{$('message').textContent=v;};
$('transport').textContent=`安全環境：${isSecureContext?'是':'否；請改用可信任 HTTPS，才能驗 PWA／Web Locks'}；Web Locks：${navigator.locks?'支援':'不支援'}；Service Worker：${'serviceWorker'in navigator?'支援':'不支援'}`;
async function status(){const s=await labFetch('/lab/status');$('identity').textContent=`${s.account.name}；Run ${s.runId}`;$('status').textContent=JSON.stringify(s,null,2);return s;}
const run=work=>async()=>{try{await work();}catch(e){show(e.message);}};
$('select').onclick=run(async()=>{const r=await fetch('/lab/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:$('tester').value})}),data=await r.json();if(!r.ok)throw Error('假帳號建立失敗');sessionStorage.setItem('gugu.iphone.lab',JSON.stringify(data.value));await status();show('已選擇假帳號，可以進入遊戲');});
$('enter').onclick=()=>{location.href='/farmgame.html';};
$('newtab').onclick=()=>{window.open('/farmgame.html','_blank');};
$('arm').onclick=run(async()=>{const value=await labFetch('/lab/control',{kind:$('fault').value,action:$('action').value});show('已設定：'+JSON.stringify(value));});
$('encounter').onclick=run(async()=>{await labFetch('/lab/control',{kind:'encounter',monster:$('monster').value});show('下次進場設定完成，請回遊戲重新進入村落');});
$('state').onclick=run(status);
$('download').onclick=run(async()=>{const result=await status(),report={...result,physicalDeviceResults:'由測試者填寫；不可由此工具自動宣稱實機通過',device:{userAgent:navigator.userAgent,standalone:matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,secureContext:isSecureContext,viewport:[innerWidth,innerHeight]},clientMetrics:JSON.parse(localStorage.getItem('gugu.lab.metrics:'+result.runId+':'+result.account.id)||'[]')};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=result.runId+'-iphone-observation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
if(sessionStorage.getItem('gugu.iphone.lab'))void status().catch(e=>show(e.message));
