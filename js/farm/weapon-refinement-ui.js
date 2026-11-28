/** Same parchment modal, in-place details/refine/reset pages; no main HUD entry. */
import { refinementClient, pendingRefinement, startRefinement, recoverRefinement } from './refinement-client.js';
import { WEAPONS_CONFIG } from './combat-rules.js';
import { REFINEMENT_STONE } from './refinement-material.js';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;n.className=cls;return n;};
const num=n=>Number(n).toLocaleString('zh-TW'),pct=n=>`${num(n/100)}%`,delta=n=>`${n>=0?'+':''}${num(n)}`;
const MONSTERS={wolf:'大野狼',tiger:'老虎',eagle:'巨飛鷹',dragon:'烈火龍',hornet:'虎頭蜂',gorilla:'大金剛',mole:'地鼠',cobra:'毒牙眼鏡蛇王',giant:'遠古巨人'};
export function mountWeaponDetails({scene,dialog,item,rows,footer,message,onBack,onAction}){
 let detail=null,quote=null,view='details',busy=false,generation=0,disposed=false;
 const current=()=>!disposed&&dialog.isCurrent();
 const b=(label,fn,disabled=false)=>{const n=el('button',label,'farm-chest-button');n.type='button';n.disabled=disabled;n.onclick=fn;return n;};
 const back=()=>{if(busy)return;disposed=true;onBack();};
 const note=text=>rows.append(el('p',text));
 function header(){const c=WEAPONS_CONFIG[item.weaponId],head=el('div',undefined,'farm-refinement-heading');try{if(scene.textures.exists(c.icon)){const img=el('img');img.src=scene.textures.getBase64(c.icon);img.alt=c.name;head.append(img);}}catch{}head.append(el('h3',`${c.name} +${detail?.refineLevel??item.refineLevel}`));rows.append(head);}
 function table(a,z){const t=el('table',undefined,'farm-refinement-stats'),head=el('tr');for(const s of ['能力','目前','預計','變化'])head.append(el('th',s));t.append(head);for(const [label,key,isRate]of [['攻擊力','attack',false],['爆擊率','criticalRateBp',true],['連續爆擊率','chainCriticalRateBp',true]]){const row=el('tr'),d=z[key]-a[key];for(const value of [label,isRate?pct(a[key]):num(a[key]),isRate?pct(z[key]):num(z[key]),isRate?`${delta(d/100)} 百分點`:delta(d)])row.append(el('td',value));t.append(row);}rows.append(t);}
 function controls(){footer.replaceChildren();footer.append(b(view==='details'?'返回武器清單':'返回詳細資訊',view==='details'?back:()=>{view='details';quote=null;message.textContent='';render();},busy));}
 function render(){if(!current())return;dialog.panel.querySelector('h2').textContent=view==='reset'?'解除精煉':view==='refine'?'武器精煉':'武器詳細資訊';rows.replaceChildren();controls();header();
  if(pendingRefinement()){note('上次操作結果確認中，請先查回原交易；不會建立另一筆扣款。');footer.append(b('確認原交易結果',()=>void execute(true),busy));return;}
  if(!detail){note('尚未取得最新武器資訊。');footer.append(b('重新讀取',()=>void load(),busy));return;}
  if(view==='details'){
   const dl=el('dl',undefined,'farm-refinement-details');for(const [label,value]of [['原始攻擊力',num(detail.baseStats.attack)],['精煉攻擊力加成',delta(detail.attackBonus)],['最終武器攻擊力',num(detail.stats.attack)],['爆擊率',pct(detail.stats.criticalRateBp)],['連續爆擊率',pct(detail.stats.chainCriticalRateBp)],['裝備狀態',detail.equipped?'裝備中':'未裝備']])dl.append(el('dt',label),el('dd',value));rows.append(dl);
   note(`可攻擊：${detail.restrictions.allowedMonsters.map(k=>MONSTERS[k]||k).join('、')}`);note(detail.restrictions.ranged?'遠程武器，沿用原有瞄準與使用限制。':'近戰武器，不能攻擊原本不支援的飛行怪物。');
   note(detail.capabilities.combatBonusEnabled||detail.capabilities.existingBonusRetained?'已取得能力沿用伺服器戰鬥快照；暫停新精煉不移除既有加成。':'新精煉與戰鬥能力尚未開放。');if(detail.bound)note('系統綁定武器，不可出售或丟棄。');if(detail.locked)note('戰鬥進行中，武器操作鎖定。');
   footer.append(b(detail.equipped?'卸下':'裝備',()=>onAction('equipWeapon',detail),busy||detail.locked));
   if(!detail.bound)footer.append(b('出售',()=>onAction('sellItem',detail),busy||detail.equipped||detail.locked||!detail.restrictions.sellPrice));
   if(detail.capabilities.refinementEnabled)footer.append(b('精煉',()=>void preview('refine'),busy||detail.locked||detail.refineLevel>=9));
   if(detail.capabilities.resetEnabled)footer.append(b('解除精煉',()=>void preview('reset'),busy||detail.locked||detail.refineLevel===0));
   if(detail.refineLevel===9)note('已達最高等級 +9。');return;
  }
  if(!quote){note('正在確認後端報價…');return;}
  note(view==='reset'?`解除 +${quote.currentLevel} → +0`:`精煉 +${quote.currentLevel} → +${quote.targetLevel}`);table(quote.currentStats,quote.nextStats);
  if(view==='reset'){
   if(!busy)message.textContent='解除後能力與進度歸零，操作不可復原。';
   note(`預計返還 ${num(quote.refund.coins)} 金幣、${num(quote.refund.stones)} 顆精煉石`);note(`依本輪成功投入 ${num(quote.successfulCost.coins)} 金幣、${num(quote.successfulCost.stones)} 顆精煉石計算，失敗消耗不返還。`);note('解除後失去上列精煉能力、進度歸零；操作不可復原。');
   footer.replaceChildren(b('取消',()=>{view='details';quote=null;message.textContent='';render();},busy),b('確認解除',()=>void execute(false),busy));
  }else{
   note(`成功率 ${pct(quote.effectiveSuccessRateBp)}`);note(`金幣：需 ${num(quote.cost.coins)}／持有 ${num(quote.coins)}`);
   const stones=el('p',undefined,'farm-refinement-material');const img=el('img');img.src='assets/farm/'+REFINEMENT_STONE.image;img.alt='精煉石';stones.append(img,document.createTextNode(`精煉石：需 ${num(quote.cost.stones)}／持有 ${num(quote.stones)}`));rows.append(stones);
   if(quote.pity.enabled)note(`保底：已失敗 ${num(quote.pity.failures)} 次，第 ${num(quote.pity.guaranteeAttempt)} 次必定成功。`);
   note('失敗不降級、不毀損；本次金幣與精煉石仍會消耗。');note(`報價版本：${quote.configVersion}`);if(!quote.eligibility.eligible)note('資源不足，無法開始精煉。');footer.append(b('開始精煉',()=>void execute(false),busy||!quote.eligibility.eligible));
  }
 }
 async function load(){const token=++generation;try{const data=await refinementClient.details(item.instanceId);if(!current()||token!==generation)return;detail=data;render();}catch(error){if(current()){if(pendingRefinement()){render();return;}message.textContent=error.message||'讀取失敗';footer.replaceChildren(b('返回武器清單',back),b('重新讀取',()=>void load()));}}}
 async function preview(kind){if(busy||pendingRefinement())return;busy=true;view=kind;quote=null;message.textContent='確認報價中…';render();try{quote=await(kind==='reset'?refinementClient.resetPreview(item.instanceId):refinementClient.preview(item.instanceId));message.textContent='';}catch(error){view='details';message.textContent=error.message||'無法取得報價，請重新讀取';}finally{busy=false;if(current())render();}}
 async function animate(result){
  const special=result.action!=='resetRefinement'&&result.success&&[3,6,9].includes(result.refineLevel),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,duration=special?1100:450;
  if(reduced||!current())return;
  const effect=rows.animate?.([{filter:'brightness(1)'},{filter:result.success||result.action==='resetRefinement'?'brightness(1.25)':'brightness(.85)'},{filter:'brightness(1)'}],{duration});
  if(!effect)return;const skip=special?b('略過特效',()=>effect.finish()):null;if(skip)footer.append(skip);await effect.finished.catch(()=>{});skip?.remove();
 }
 async function execute(recover){if(busy)return;const started=performance.now();let settled=null;busy=true;message.textContent=recover?'確認原交易結果…':'處理中…';render();try{
   const result=await(recover?recoverRefinement():startRefinement(view==='reset'?'resetRefinement':'refineWeapon',quote));settled=result;if(!current())return;
   message.textContent=result.action==='resetRefinement'?`解除完成：返還 ${num(result.refund.coins)} 金幣、${num(result.refund.stones)} 顆精煉石。`:result.success?`精煉成功！+${result.refineLevel}`:`精煉失敗，仍為 +${result.refineLevel}；已消耗 ${num(result.actualCost.coins)} 金幣及 ${num(result.actualCost.stones)} 顆精煉石。`;
   try{await animate(result);}catch{}if(!current())return;detail=await refinementClient.details(item.instanceId);if(!current())return;
   if(result.action!=='resetRefinement'&&detail.refineLevel<9){view='refine';try{quote=await refinementClient.preview(item.instanceId);}catch{view='details';quote=null;}}else{view='details';quote=null;}
  }catch(error){if(current()){if(settled){message.textContent='原交易已結算，最新資料尚未讀取完成；請重新讀取，不會再次扣款。';view='details';quote=null;detail=null;}else{message.textContent=pendingRefinement()?'結果確認中，請查回原交易。':(error.message||'操作未完成，請重新確認');if(!pendingRefinement()){view='details';quote=null;try{detail=await refinementClient.details(item.instanceId);}catch{}}}}}
  finally{if(settled){const remainder=300-(performance.now()-started);if(remainder>0)await new Promise(resolve=>setTimeout(resolve,remainder));}busy=false;if(current())render();}
 }
 render();void load();return()=>{disposed=true;generation++;};
}
