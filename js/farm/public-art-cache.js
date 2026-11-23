import {FARM_ART_REVISION} from './art-cache-revision.js';
let preparation;
/** Public images/atlas metadata only; never stores accounts, saves or API results. */
export function prepareFarmArtCache(){
 if(preparation)return preparation;
 if(!globalThis.isSecureContext||!('serviceWorker' in navigator))return Promise.resolve(false);
 preparation=(async()=>{
  const worker=new URL('../../farm-daily-sw.js',import.meta.url);worker.searchParams.set('v',FARM_ART_REVISION);worker.searchParams.set('art',FARM_ART_REVISION);
  const registration=await navigator.serviceWorker.register(worker,{scope:new URL('../../farmgame.html',import.meta.url).href,updateViaCache:'none'});
  if(navigator.serviceWorker.controller?.scriptURL===worker.href&&registration.active)return true;
  return new Promise(resolve=>{
   let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve(value);};
   const changed=()=>{if(navigator.serviceWorker.controller?.scriptURL===worker.href)finish(true);};
   const timer=setTimeout(()=>finish(false),5000);navigator.serviceWorker.addEventListener('controllerchange',changed);changed();
  });
 })().catch(()=>{preparation=null;return false;});
 return preparation;
}
/** Start alongside engine/auth downloads, with a bounded optional startup wait. */
export function artCacheStartup(promise,budget=200){
 return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),budget);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(false);});});
}
