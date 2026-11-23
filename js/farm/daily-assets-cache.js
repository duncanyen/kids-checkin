import { prepareFarmArtCache } from './public-art-cache.js';
/** Bump this revision whenever the T1/T2 derivatives change. No Firebase data is cached. */
export const DAILY_ART_REVISION='20261113-1';
let preparation;
const decoded=[];
export function prepareDailyAssets(){
    if(preparation)return preparation;
    preparation=(async()=>{
        const folder=new URL('../../assets/farm/daily-missions/v2/',import.meta.url);
        await prepareFarmArtCache();
        const response=await fetch(new URL('manifest.json',folder));
        if(!response.ok)return;
        const manifest=await response.json();
        // Decode small public UI images in the background; never delay the game boot.
        await Promise.allSettled(Object.values(manifest.assets).filter(asset=>/^[a-z0-9-]+\.png$/.test(asset.file)).map(async asset=>{
            const image=new Image();image.decoding='async';image.src=new URL(asset.file,folder).href;decoded.push(image);
            if(image.decode)await image.decode();
        }));
    })().catch(()=>{preparation=null;});
    return preparation;
}
