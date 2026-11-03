import { BREEDS, poultryState, settlePoultry, poultryPatch } from './poultry.js';
export const MIN_OUTDOOR_HENS = 6;
export function outdoorHens(farm) {
    const hens=poultryState(farm).hens,minimum=Math.min(MIN_OUTDOOR_HENS,hens.length);
    const selected=[],remaining=[];const used={};
    for(const h of hens){
        const value=farm.outdoorHensByBreed?.[h.breed];
        const limit=Number.isSafeInteger(value)&&value>=0?value:Infinity;
        if((used[h.breed]||0)<limit){selected.push(h);used[h.breed]=(used[h.breed]||0)+1;}else remaining.push(h);
    }
    selected.push(...remaining.slice(0,Math.max(0,minimum-selected.length)));
    return selected;
}
export function outdoorCounts(farm){const counts=Object.fromEntries(Object.keys(BREEDS).map(key=>[key,0]));for(const h of outdoorHens(farm))counts[h.breed]++;return counts;}
export function housingPatch(farm,counts){
    const hens=poultryState(farm).hens,total=hens.length,patch={};let selected=0;
    for(const key of Object.keys(BREEDS)){
        const owned=hens.filter(h=>h.breed===key).length,value=counts[key]??owned;
        if(!Number.isSafeInteger(value)||value<0||value>owned)throw Error('雞隻數量已變更，請重新調整');
        patch[key]=value;selected+=value;
    }
    if(selected<Math.min(MIN_OUTDOOR_HENS,total))throw Error(`至少需要放出 ${Math.min(MIN_OUTDOOR_HENS,total)} 隻雞`);
    return {'farm.outdoorHensByBreed':patch};
}
export function treatmentPatch(farm,{id,roll=0,now=Date.now()}={}){
    const state=settlePoultry(farm,now),sick=state.hens.filter(h=>h.isSick);
    const hen=id?state.hens.find(h=>h.id===id&&h.isSick):sick[Math.min(sick.length-1,Math.floor(Math.max(0,Math.min(.999999,roll))*sick.length))];
    if(!hen)throw Error('雞隻已售出、離世或已康復，無需消耗藥品');
    if(!(farm.medicines>=1))throw Error('藥品不足，請先到商店購買');
    hen.isSick=false;hen.laidAt=now;delete hen.sickTimestamp;delete hen.pausedFull;
    return {...poultryPatch(state),'farm.medicines':farm.medicines-1};
}
