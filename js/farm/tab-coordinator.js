/** Web Locks are the atomic ownership boundary; BroadcastChannel only requests a handoff. */
export function createFarmTabCoordinator({scope,locks,channel,onState=()=>{},onYield=async()=>{}}){
 let owned=false,paused=false,acquiring=null,release,closed=false;const running=new Set();
 const error=()=>Object.assign(Error('此農場目前在另一分頁開啟'),{code:'ops/other-tab'});
 async function acquire(){if(closed||paused)throw error();if(owned)return;if(acquiring)return acquiring;if(!locks?.request){onState('unsupported');throw Object.assign(Error('此瀏覽器無法安全協調分頁，請更新瀏覽器'),{code:'ops/tab-unsupported'});}let accept,reject;acquiring=new Promise((r,j)=>{accept=r;reject=j;});void locks.request('nexus-farm-page:'+scope,{ifAvailable:true},async lock=>{if(!lock){onState('other-tab');reject(error());return;}if(closed||paused){reject(error());return;}owned=true;onState('active');accept();await new Promise(r=>release=r);owned=false;}).catch(reject);try{await acquiring;}finally{acquiring=null;}}
 async function yieldPage(){if(!owned||paused)return;paused=true;onState('yielding');await Promise.allSettled([...running]);await onYield();release?.();onState('yielded');}
 if(channel)channel.onmessage=event=>{if(event.data?.type==='request-yield'&&event.data.scope===scope)void yieldPage();};
 async function takeover(){if(closed)throw error();paused=false;channel?.postMessage({type:'request-yield',scope});for(let n=0;n<240;n++){try{await acquire();return;}catch(e){if(e.code!=='ops/other-tab')throw e;}await new Promise(r=>setTimeout(r,100));}throw Object.assign(Error('另一分頁尚未完成操作，請稍候或關閉該分頁後重試'),{code:'ops/other-tab'});}
 return{acquire,takeover,async run(work){await acquire();if(paused||closed)throw error();const p=Promise.resolve().then(work);running.add(p);try{return await p;}finally{running.delete(p);}},async drain(){await Promise.allSettled([...running]);},close(){closed=true;paused=true;release?.();channel?.close();},get owned(){return owned&&!paused;}};
}
