/** Trusted entry-only encounter policy. Defaults preserve the shipped encounter distribution. */
const D=require('./domain.cjs');
const NAMES={wolf:'大野狼',tiger:'老虎',dragon:'烈火龍',gorilla:'金剛',eagle:'巨飛鷹',cobra:'眼鏡蛇王',giant:'遠古巨人',mole:'地鼠',hornet:'虎頭蜂'};
const BOSS_ORDER=['gorilla','dragon','eagle','hornet'],MILESTONE_ORDER=['cobra','giant','mole'];
const KILL_TYPES=['wolf','tiger','eagle'];
const scope=(enabled,minLevel,rate)=>({enabled,minLevel,rate});
const DEFAULTS={
 wolf:{enabled:true,home:scope(false,1,0),visit:scope(true,1,10)},
 tiger:{enabled:true,home:scope(false,1,0),visit:scope(true,1,100/30)},
 dragon:{enabled:true,home:scope(true,2,5),visit:scope(true,2,100/30)},
 gorilla:{enabled:true,home:scope(true,3,100/30),visit:scope(true,3,100/30)},
 eagle:{enabled:true,home:scope(true,3,5),visit:scope(true,3,5)},
 hornet:{enabled:true,home:scope(true,2,100/30),visit:scope(true,2,100/30)},
 cobra:{enabled:true,home:scope(true,2,100),visit:scope(true,2,100),interval:100,killTypes:['wolf','tiger','eagle']},
 giant:{enabled:true,home:scope(true,3,100),visit:scope(true,3,100),interval:50,killTypes:['wolf','tiger']},
 mole:{enabled:true,home:scope(true,2,100),visit:scope(true,2,100),interval:30}
};
const bool=v=>{if(typeof v!=='boolean')D.fail('invalid-argument','怪物開關須為布林值');return v;};
const rate=v=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)D.fail('invalid-argument','出現機率須為 0–100%');return v;};
function validate(kind,value){
 D.enumValue(kind,Object.keys(NAMES));if(!value||typeof value!=='object')D.fail('invalid-argument','缺少怪物出現設定');
 const out={enabled:bool(value.enabled)};
 for(const key of ['home','visit']){const s=value[key];if(!s)D.fail('invalid-argument','缺少進場條件');out[key]={enabled:bool(s.enabled),minLevel:D.integer(s.minLevel,1,5),rate:rate(s.rate)};}
 if(['wolf','tiger'].includes(kind)&&out.home.enabled)D.fail('invalid-argument','野狼與老虎目前僅支援拜訪村落戰鬥');
 if(MILESTONE_ORDER.includes(kind))out.interval=D.integer(value.interval,1,1000000);
 if(['cobra','giant'].includes(kind)){
  if(!Array.isArray(value.killTypes)||!value.killTypes.length||value.killTypes.length>3||new Set(value.killTypes).size!==value.killTypes.length||value.killTypes.some(id=>!KILL_TYPES.includes(id)))D.fail('invalid-argument','累計擊退類型僅可選現有追蹤的野狼、老虎與巨飛鷹');
  out.killTypes=[...value.killTypes];
 }
 return out;
}
function validateAll(monsters){
 const result=Object.fromEntries(Object.keys(NAMES).map(id=>[id,validate(id,monsters[id]??DEFAULTS[id])]));
 for(const place of ['home','visit'])for(let level=1;level<=5;level++){
  const sum=BOSS_ORDER.reduce((n,id)=>{const v=result[id],s=v[place];return n+(v.enabled&&s.enabled&&level>=s.minLevel?s.rate:0);},0);
  if(sum>100+1e-9)D.fail('invalid-argument',`${place==='home'?'自家':'拜訪'}等級 ${level} 的金剛、烈火龍、巨飛鷹與虎頭蜂合計機率不可超過 100%`);
 }
 return result;
}
function mergeSaved(saved={}){
 const monsters=Object.fromEntries(Object.keys(NAMES).map(id=>[id,validate(id,saved[id]??DEFAULTS[id])])),notes=[];
 // Existing operators may already allocate 100% to old monsters. Do not silently
 // scale their saved rates or make entry fail when introducing a new default.
 if(!Object.hasOwn(saved,'hornet'))for(const place of ['home','visit']){
  if([1,2,3,4,5].some(level=>BOSS_ORDER.reduce((n,id)=>n+(available(monsters[id],place,level)?monsters[id][place].rate:0),0)>100+1e-9)){
   monsters.hornet[place].enabled=false;notes.push(`${place==='home'?'自家':'拜訪'}舊設定的互斥機率已滿，虎頭蜂暫未啟用；請調整機率後再啟用。`);
  }
 }
 return{monsters,notes};
}
async function config(db,t){const snap=await(t?t.get(db.doc('ops_game_config/encounters')):db.doc('ops_game_config/encounters').get()),raw=snap.data()||{},merged=mergeSaved(raw.monsters||{});return{monsters:validateAll(merged.monsters),notes:merged.notes,revision:raw.revision||0,updatedAt:raw.updatedAt||null};}
const hit=(rate,random)=>rate===100||rate>0&&random()*100<rate;
function available(value,place,level){return value.enabled&&value[place].enabled&&level>=value[place].minLevel;}
function milestone(kind,value,farm,place){
 if(!available(value,place,farm.coopLevel||1))return null;
 const count=kind==='mole'?Math.max(0,Math.trunc(farm.gardenCatchCount||0)):value.killTypes.reduce((n,k)=>n+Math.max(0,Math.trunc(farm.combatKills?.[k]||0)),0);
 const last=Math.max(0,Number(farm[kind+'LastMilestone']||0)),next=(Math.floor(last/value.interval)+1)*value.interval;
 return count>=next?next:null;
}
function rollMilestone(settings,farm,place,random,requested){
 for(const kind of requested?[requested]:MILESTONE_ORDER){const value=settings.monsters[kind],next=milestone(kind,value,farm,place);if(next!==null&&hit(value[place].rate,random))return{kind,milestone:next};}
 return null;
}
function rollRandom(settings,place,level,random){
 const eligible=BOSS_ORDER.filter(id=>available(settings.monsters[id],place,level)&&settings.monsters[id][place].rate>0);
 if(eligible.length){let roll=random()*100;for(const id of eligible){roll-=settings.monsters[id][place].rate;if(roll<0)return id;}}
 if(place==='visit')for(const id of ['tiger','wolf']){const v=settings.monsters[id];if(available(v,place,level)&&hit(v[place].rate,random))return id;}
 return null;
}
module.exports={NAMES,DEFAULTS,BOSS_ORDER,MILESTONE_ORDER,KILL_TYPES,validate,validateAll,mergeSaved,config,hit,milestone,rollMilestone,rollRandom};
