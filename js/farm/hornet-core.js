import {ENEMY_HEALTH} from './combat-rules.js';
export const HORNET_CONFIG=Object.freeze({health:ENEMY_HEALTH.hornet,flightMs:10000,durationMs:50000,coinPenalty:100,size:104,arrivalMs:2000,diveEveryMs:5000});
export const HONEY_PRICE=300;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
/** Pure visual route; no damage, rewards or egg writes happen here. */
export function hornetPosition(elapsed,{coop,view,hen}){
 view={...view,right:view.right??view.left+view.width,bottom:view.bottom??view.top+view.height};
 const t=Math.max(0,elapsed),center={x:clamp(coop.x,view.left+70,view.right-70),y:clamp(coop.top-30,view.top+200,Math.max(view.top+200,view.bottom-180))};
 if(t<HORNET_CONFIG.arrivalMs){const p=1-(1-t/HORNET_CONFIG.arrivalMs)**3,from={x:view.right-16,y:view.bottom-40};return{x:from.x+(center.x-from.x)*p,y:from.y+(center.y-from.y)*p,phase:'approach'};}
 const seconds=(t-HORNET_CONFIG.arrivalMs)/1000,hover={x:center.x+Math.sin(seconds*1.8)*54,y:center.y+Math.sin(seconds*2.7)*9};
 const phase=(t-HORNET_CONFIG.flightMs)%HORNET_CONFIG.diveEveryMs;
 const amount=t>=HORNET_CONFIG.flightMs&&phase>=4000?Math.sin((phase-4000)/1000*Math.PI):0;
 const target=hen||{x:coop.x,y:coop.bottom+100};
 return{x:hover.x+(clamp(target.x,view.left+45,view.right-45)-hover.x)*amount,y:hover.y+(clamp(target.y-24,center.y+40,view.bottom-65)-hover.y)*amount,phase:amount>0?'dive':'hover'};
}
