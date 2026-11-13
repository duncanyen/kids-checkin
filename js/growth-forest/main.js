/**
 * 成長森林頁面協調器：森林、紀錄、夢想獎勵、家長管理與成員唯讀森林。
 * client.js 選取資料傳輸；pagehide 解除資料／外觀監聽、計時器、Object URL 及 Phaser。
 * @module
 */
import '../app-navigation.js';
import {readGameContext,getSelectedGameGroupId} from '../game-context.js';
import {ReadingClock} from './reading-clock.js';
import {STAGE_NAMES} from './art.js';
import {PLOTS_PER_PAGE} from './layout.js';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dates=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}),today=()=>dates.format(new Date());
const labels={pending:'待審核',approved:'已核准',rejected:'已退回',revoked:'已撤銷',legacy:'歷史紀錄',requested:'申請中',processing:'準備中',completed:'已發放',cancelled:'已取消'};
const context=readGameContext(),clock=new ReadingClock(localStorage,`nexus.growth.clock:${context.groupId}:${context.accountId}`);
let parentGeneration=0,refreshGeneration=0,forestPage=0,pageLoading=false,visitAccountId=null,visitPage=0,visitData=null,visitGame=null,visitPending=null,visitGeneration=0,noticeTimer;
let client,data,game,gamePending,stopped=false,busy=false,view='forest',parentMode='records',targetId=null,recordCursor=null,recordRows=[],recordFilters={},recordGeneration=0,timer,refreshTimer,unsubscribe,stopAppearance,photoUrls=[];
let lowPower=localStorage.getItem('nexus.growth.lowPower')==='1'||matchMedia('(prefers-reduced-motion:reduce)').matches;
$('powerMode').setAttribute('aria-pressed',String(lowPower));
const status=(message,error=false)=>{$('status').textContent=message;$('status').className=error?'error':'success';$('status').hidden=!error;};
function toast(text){clearTimeout(noticeTimer);$('operationNotice').textContent=text;$('operationNotice').hidden=false;noticeTimer=setTimeout(()=>{$('operationNotice').hidden=true;},4000);}
const message=error=>({'unavailable':'Firestore 暫時無法連線，請保留內容後重試。','functions/unauthenticated':'登入已失效，請返回 Nexus 重新登入。','functions/not-found':'找不到紀錄或森林後端尚未部署。','functions/unavailable':'目前無法連線；請保留畫面後重試。','functions/internal':'後端暫時無法完成操作，請保留內容後重試。'}[error.code]||error.message||'操作失敗，請稍後重試。');
function field(label,name,type='text',value='',attrs=''){return `<label${type==='date'?' class="date-field"':''}>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}></label>`;}
function select(label,name,options,value=''){return `<label>${esc(label)}<select name="${esc(name)}">${options.map(o=>{const v=typeof o==='string'?o:o.value,l=typeof o==='string'?o:o.label;return `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`;}).join('')}</select></label>`;}
const note=(label='備註（選填）',name='note',value='')=>`<label class="full">${esc(label)}<textarea name="${name}" maxlength="1000">${esc(value)}</textarea></label>`;
const formEnd=(text='儲存')=>`<p class="form-error full" role="status"></p><footer class="full"><button type="button" data-close class="outline">取消</button><button type="submit">${esc(text)}</button></footer></form>`;
const available=()=>Math.round((data.wallet.pointsBalance-data.wallet.pointsReserved)*100)/100;
// 暫停動畫不代表停止 Phaser 的原生輸入；分頁、背景與對話框共同控制輸入。
function syncForestInput(){game?.setInputEnabled(view==='forest'&&!document.hidden&&!$('sheet').open&&!stopped);}
function sheet(title,html){delete $('sheet').dataset.recordId;delete $('sheet').dataset.recordStatus;photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];game?.setInputEnabled(false);$('sheetTitle').textContent=title;$('sheetBody').innerHTML=html;if(!$('sheet').open)$('sheet').showModal();$('sheetBody').querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeSheet());updateTimer();}
function closeSheet(){if(busy)return;$('sheet').close();photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];}
$('closeSheet').onclick=closeSheet;$('sheet').addEventListener('close',()=>{syncForestInput();photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];});$('sheet').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
/**
 * 鎖定表單、送出變更並重讀畫面；資源計算由 service 的交易處理。
 * @param {string} action - 成長森林服務操作名稱。
 * @param {Object} payload - 經各表單整理的操作內容。
 * @param {Object} [options] - close 控制成功後是否關閉表單。
 * @returns {Promise<void>} 結果以提示與最新畫面呈現；失敗保留錯誤資訊。
 */
async function action(action,payload,{close=true}={}){
 if(busy||!client)return null;busy=true;const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(c=>!c.disabled);controls.forEach(c=>c.disabled=true);
 try{const result=await client.api(action,payload,true);try{await refresh();}catch(error){if(close)$('sheet').close();status('操作已儲存，但畫面同步延遲。請重新連線後再操作。',true);$('retry').hidden=false;return result;}if(close)$('sheet').close();const notice=result.status==='pending'?'紀錄成功！等待家長確認後，就能獲得成長獎勵。':rewardMessage(result);status(notice);toast(notice);return result;}
 catch(error){status(message(error),true);const panel=$('sheetBody').querySelector('.form-error');if(panel)panel.textContent=message(error);return null;}
 finally{busy=false;controls.filter(c=>c.isConnected).forEach(c=>c.disabled=false);}
}
function rewardMessage(result){const r=result.rewards;if(r&&Object.values(r).some(n=>n>0))return `努力已化成養分：星星 +${r.points}、水滴 +${r.water}、金幣 +${r.coins}。`;return result.watered?`已澆水 ${result.watered} 滴。`:'操作已完成。';}
async function refresh(){
 if(stopped||!client)return;const generation=++refreshGeneration,incoming=await client.api('snapshot',{page:forestPage});if(stopped||generation!==refreshGeneration)return;const previous=data;data=incoming;forestPage=data.gardenPage.page;if(previous&&!busy&&['pointsBalance','waterBalance','coinBalance'].some(key=>data.wallet[key]>previous.wallet[key]))status('你的努力有回報！森林資源已更新。');
 updateHeader();
 $('pointsBalance').textContent=available().toLocaleString();$('waterBalance').textContent=data.wallet.waterBalance.toLocaleString();$('coinBalance').textContent=data.wallet.coinBalance.toLocaleString();$('parentNav').hidden=!data.parent;
 $('reservedNote').textContent=`可用 ${available()} 點 · 兌換保留 ${data.wallet.pointsReserved} 點。獎品發放時才會正式扣除保留積分。`;
 $('sceneMessage').textContent=data.gardenPage.plots.every(p=>!p.plantId)?(Object.values(data.garden.seeds).some(n=>n>0)?'選一塊土壤，種下背包裡的種子。':'這區還有空地，可以先到種子小舖購買種子。'):'每一株植物，都記得你的努力。';
 game?.set(data);
 const section=data.gardenPage;

 $('forestPageLabel').textContent=`第 ${section.page+1} / ${section.totalPages} 區 · 共 ${data.garden.plotCount} 塊土地`;
 $('previousForest').disabled=section.page===0||pageLoading;$('nextForest').disabled=section.page===section.totalPages-1||pageLoading;
 $('forestGame').setAttribute('aria-label',`我的森林，第 ${section.page+1} 區，共 ${data.garden.plotCount} 塊土地`);
 $('buyPlot').textContent=`開墾新土地 · ${data.plotPrice.coins} 金幣＋${data.plotPrice.water} 水滴`;
 if(view==='rewards')renderRewards();if(view==='parent'&&!document.querySelector('#parentContent form:focus-within'))await renderParent();if(view==='records')await loadRecords(true);if(view==='members')await renderMembers();if(view==='visit')await refreshVisit();
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(stopped)return;if(busy){scheduleRefresh();return;}refresh().catch(error=>status(message(error),true));},220);}
async function openView(next){
 if(!data||busy||next==='parent'&&!data.parent)return;if(next==='parent'&&view!=='parent')$('parentRecordSection')?.removeAttribute('open');view=next;syncForestInput();updateHeader();if(next!=='visit'){visitGame?.pause();visitGeneration++;}
 for(const item of ['forest','records','rewards','parent','members','visit'])$(item+'View').hidden=item!==view;
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if(view==='forest'){
  if(!game&&!gamePending){gamePending=import('./scene.js').then(m=>m.createForest($('forestGame'),index=>{if(view==='forest'&&!document.hidden&&!$('sheet').open)plot(index);},lowPower)).then(g=>{if(stopped){g.destroy();return;}game=g;g.set(data);syncForestInput();if(view!=='forest'||document.hidden)g.pause();}).catch(e=>status(message(e),true)).finally(()=>gamePending=null);}
  game?.resume();
 }else game?.pause();
 if(view==='members')await renderMembers();
 if(view==='records'){renderFilters($('recordFilters'),false);await loadRecords(true);}if(view==='rewards')renderRewards();if(view==='parent')await renderParent();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view).catch(e=>status(message(e),true)));
function updateHeader(){
 const visiting=view==='visit';if(visiting)$('operationNotice').hidden=true;document.body.classList.toggle('visiting-forest',visiting);
 $('greeting').textContent=visiting?(visitData?visitData.owner.name+'的成長森林':'成員的成長森林'):(data?.actor.name?data.actor.name+'的成長森林':'我的成長森林');
 document.querySelector('.resource-strip').hidden=visiting;document.querySelector('.forest-nav').hidden=visiting;$('resourceGuide').hidden=visiting;
 $('forestBack').textContent=visiting?'‹':view==='members'?'返回我的森林':'返回主選單';
 $('forestBack').setAttribute('aria-label',visiting||view==='members'?'返回自己的成長森林':'返回主選單');
}
$('forestBack').onclick=event=>{if(view==='visit'||view==='members'){event.preventDefault();visitGeneration++;visitGame?.pause();openView('forest').catch(error=>status(message(error),true));}};
function avatarURL(value){
 if(typeof value!=='string')return null;if(/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value))return value;
 try{const url=new URL(value,location.href);if(value&&['https:','http:'].includes(url.protocol))return url.href;}catch{}return null;
}
let membersGeneration=0;
async function renderMembers(){
 const generation=++membersGeneration,result=await client.api('members');if(view!=='members'||generation!==membersGeneration)return;
 const root=$('forestMembers');root.replaceChildren();
 if(!result.members.length){root.textContent='目前沒有可瀏覽的群組成員。';return;}
 for(const member of result.members){
  const button=document.createElement('button');button.type='button';button.className='forest-member';button.dataset.memberAccount=member.accountId;button.setAttribute('aria-label','查看'+member.name+'的成長森林');
  const avatar=document.createElement('span');avatar.className='forest-member-avatar';avatar.textContent=member.name.slice(0,1)||'?';
  const src=avatarURL(member.avatar);if(src){const image=new Image();image.src=src;image.alt='';image.loading='lazy';image.onerror=()=>{image.remove();};avatar.append(image);}
  const label=document.createElement('span');label.textContent=member.name+(member.accountId===context.accountId?'（自己）':'');button.append(avatar,label);
  button.onclick=()=>{if(member.accountId===context.accountId)openView('forest').catch(error=>status(message(error),true));else openMemberForest(member.accountId).catch(error=>status(message(error),true));};root.append(button);
 }
}
async function openMemberForest(accountId){
 if(busy)return;visitAccountId=accountId;visitPage=0;visitData=null;visitGame?.pause();visitGame?.set({gardenPage:{start:0,plots:[]},plants:[]});$('visitGame').hidden=true;$('visitPagination').hidden=true;await openView('visit');await refreshVisit();
}
async function refreshVisit(){
 if(view!=='visit'||!visitAccountId)return;const generation=++visitGeneration,accountId=visitAccountId;
 let incoming;try{incoming=await client.api('memberForest',{accountId,page:visitPage});}catch(error){if(view==='visit'&&generation===visitGeneration){$('visitGame').hidden=true;$('visitPagination').hidden=true;visitGame?.pause();}throw error;}if(view!=='visit'||generation!==visitGeneration||accountId!==visitAccountId)return;
 visitData=incoming;visitPage=incoming.gardenPage.page;updateHeader();$('visitGame').hidden=false;
 $('visitGame').setAttribute('aria-label',incoming.owner.name+'的成長森林，第 '+(visitPage+1)+' 區');
 $('visitPagination').hidden=incoming.gardenPage.totalPages<=1;$('visitPageLabel').textContent=`第 ${visitPage+1} / ${incoming.gardenPage.totalPages} 區`;
 $('visitPrevious').disabled=visitPage===0;$('visitNext').disabled=visitPage===incoming.gardenPage.totalPages-1;
 if(!visitGame&&!visitPending){visitPending=import('./scene.js').then(m=>m.createForest($('visitGame'),()=>{},lowPower)).then(game=>{if(stopped){game.destroy();return;}visitGame=game;if(visitData)game.set(visitData);game.setInputEnabled(false);if(view!=='visit'||document.hidden)game.pause();}).catch(error=>status(message(error),true)).finally(()=>visitPending=null);await visitPending;}
 if(view==='visit'&&generation===visitGeneration){visitGame?.set(incoming);visitGame?.setInputEnabled(false);visitGame?.resume();}
}
async function changeVisitPage(delta){
 if($('visitPrevious').disabled&&delta<0||$('visitNext').disabled&&delta>0)return;const previous=visitPage;visitPage+=delta;$('visitPrevious').disabled=true;$('visitNext').disabled=true;
 try{await refreshVisit();}catch(error){visitPage=previous;status(message(error),true);$('visitPrevious').disabled=visitPage===0;$('visitNext').disabled=visitPage===(visitData?.gardenPage.totalPages||1)-1;}
}
$('visitPrevious').onclick=()=>changeVisitPage(-1);$('visitNext').onclick=()=>changeVisitPage(1);
$('powerMode').onclick=async()=>{lowPower=!lowPower;localStorage.setItem('nexus.growth.lowPower',lowPower?'1':'0');$('powerMode').setAttribute('aria-pressed',String(lowPower));game?.destroy();game=null;if(view==='forest')await openView('forest');};

function plot(index){
 if(view!=='forest'||document.hidden||!data||busy||!data.gardenPage.plots.some(slot=>slot.positionIndex===index))return;const plant=data.plants.find(p=>p.positionIndex===index);
 if(!plant){sheet('種下新的可能',`<p class="body-copy">位置 ${index+1} · 選一顆背包裡的種子；不足時可到種子小舖購買。</p><div class="seed-grid">${Object.entries(data.plantCatalog).map(([type,c])=>`<article class="seed"><img src="assets/growth-forest/${type}-2.svg" alt="${esc(c.name)}"><h3>${esc(c.name)}</h3><p>背包 ${data.garden.seeds[type]||0} 顆</p><button data-plant="${type}" ${!(data.garden.seeds[type]>0)?'disabled':''}>種下</button></article>`).join('')}</div><button class="text-link" id="shopFromPlant">前往種子小舖</button>`);
  $('sheetBody').querySelectorAll('[data-plant]').forEach(b=>b.onclick=async()=>{const r=await action('plant',{plantType:b.dataset.plant,positionIndex:index});if(r)game?.effect(index,'growth');});$('shopFromPlant').onclick=seedShop;return;
 }
 const next=[0,20,40,70,100][plant.growthStage],required=plant.growthRequired,remaining=Math.max(0,required-plant.growthValue),maximum=Math.min(remaining,data.wallet.waterBalance);
 let selected=Math.min(10,maximum);
 sheet(data.plantCatalog[plant.plantType].name,`<div class="plant-info"><img src="assets/growth-forest/${plant.plantType}-${plant.growthStage}.svg" alt="${esc(STAGE_NAMES[plant.growthStage-1])}"><div><h3>Lv.${plant.growthStage} ${esc(STAGE_NAMES[plant.growthStage-1])}</h3><p>目前成長 ${plant.growthValue} / ${required}</p><progress value="${plant.growthValue}" max="${required}"></progress><p>${plant.growthStage===5?'已經成熟，謝謝你的照顧。':`下一階段：${Math.ceil(next/100*required)} 滴`}</p><p>水滴餘額 ${data.wallet.waterBalance} · 還需 ${remaining} 滴成熟</p></div></div><div class="water-picker" ${remaining===0?'hidden':''}><p id="waterLabel">本次澆水數量</p><div class="water-quantity" role="group" aria-labelledby="waterLabel"><button type="button" id="waterMinus" class="outline" aria-label="減少10滴">−</button><output id="waterAmount" aria-live="polite"></output><button type="button" id="waterPlus" class="outline" aria-label="增加10滴">＋</button><button type="button" id="waterMax" class="outline">MAX</button></div><p class="hint">每次增減 10 滴；MAX 取剩餘需求與水滴餘額的較小值，最後不足 10 滴也能使用。</p><p id="waterPreview" aria-live="polite"></p></div><div class="water-actions"><button type="button" class="outline" data-close>取消</button><button type="button" id="waterPlant"></button></div><p class="form-error" role="status"></p>`);
 const updateQuantity=()=>{
  $('waterAmount').textContent=`${selected} 滴`;
  $('waterMinus').disabled=selected<=Math.min(10,maximum);$('waterPlus').disabled=selected>=maximum;$('waterMax').disabled=maximum===0||selected===maximum;
  $('waterPlant').disabled=selected===0;$('waterPlant').textContent=remaining===0?'已成熟':selected===0?'水滴不足':`確認澆水 · ${selected} 滴`;
  $('waterPreview').textContent=maximum>0?`澆水後：成長 ${plant.growthValue+selected} / ${required}，水滴餘額 ${data.wallet.waterBalance-selected}。`:'目前沒有可使用的水滴，取得獎勵後再來照顧植物。';
 };
 $('waterMinus').onclick=()=>{selected=Math.max(Math.min(10,maximum),selected%10?Math.floor(selected/10)*10:selected-10);updateQuantity();};
 $('waterPlus').onclick=()=>{selected=Math.min(maximum,selected+10);updateQuantity();};$('waterMax').onclick=()=>{selected=maximum;updateQuantity();};updateQuantity();
 $('waterPlant').onclick=async()=>{const r=await action('water',{id:plant.id,amount:selected});if(r){game?.effect(index,'water');plot(index);}};
}
function seedShop(){
 if(!data||busy)return;
 sheet('種子小舖',`<p class="body-copy">金幣餘額 ${data.wallet.coinBalance} · 種子買下後會放進背包，再選位置種下。</p><div class="seed-grid">${Object.entries(data.plantCatalog).map(([type,c])=>`<article class="seed"><img src="assets/growth-forest/${type}-5.svg" alt="${esc(c.name)}成熟樣貌"><h3>${esc(c.name)}</h3><p>${c.price} 金幣</p><button data-buy="${type}">購買種子</button></article>`).join('')}</div><p class="form-error" role="status"></p>`);
 $('sheetBody').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{const c=data.plantCatalog[b.dataset.buy];sheet('確認購買',`<p>花費 ${c.price} 金幣購買一顆${esc(c.name)}種子？</p><form id="buyForm">${formEnd('確認購買')}`);$('buyForm').onsubmit=async e=>{e.preventDefault();await action('buySeed',{plantType:b.dataset.buy});};});
}
$('seedShop').onclick=seedShop;
async function changeForestPage(page){
 if(!data||busy||pageLoading)return;const previous=forestPage;pageLoading=true;forestPage=page;$('previousForest').disabled=true;$('nextForest').disabled=true;
 try{await refresh();if($('sheet').open&&$('sheetTitle').textContent==='我的植物')myPlants();}
 catch(error){forestPage=previous;status(message(error),true);}
 finally{pageLoading=false;$('previousForest').disabled=data.gardenPage.page===0;$('nextForest').disabled=data.gardenPage.page===data.gardenPage.totalPages-1;}
}
$('previousForest').onclick=()=>changeForestPage(Math.max(0,forestPage-1));$('nextForest').onclick=()=>changeForestPage(forestPage+1);
function myPlants(){
 if(!data||busy)return;const section=data.gardenPage;
 sheet('我的植物',`<p class="body-copy">共 ${data.garden.plotCount} 塊土地 · 第 ${section.page+1} / ${section.totalPages} 區</p><div class="record-list">${section.plots.map(slot=>{const p=data.plants.find(p=>p.id===slot.plantId);return `<div class="record-row"><div><strong>${p?esc(data.plantCatalog[p.plantType].name):'等待種下新植物'}</strong><p>${p?`Lv.${p.growthStage} · ${p.growthValue} / ${p.growthRequired} 滴`:'還有一塊空地'}</p></div><button data-open-plot="${slot.positionIndex}">位置 ${slot.positionIndex+1}</button></div>`;}).join('')}</div><div class="forest-pages"><button id="plantPrevious" class="outline" ${section.page===0?'disabled':''}>上一區</button><button id="plantNext" class="outline" ${section.page===section.totalPages-1?'disabled':''}>下一區</button></div><button id="expandFromPlants" class="outline wide">開墾新土地</button>`);
 $('sheetBody').querySelectorAll('[data-open-plot]').forEach(b=>b.onclick=()=>plot(Number(b.dataset.openPlot)));
 $('plantPrevious').onclick=()=>changeForestPage(forestPage-1);$('plantNext').onclick=()=>changeForestPage(forestPage+1);$('expandFromPlants').onclick=buyPlotForm;
}
$('openPlants').onclick=myPlants;
function buyPlotForm(){
 if(!data||busy)return;const cost=data.plotPrice,enough=data.wallet.coinBalance>=cost.coins&&data.wallet.waterBalance>=cost.water;
 sheet('開墾新土地',`<p>花費 ${cost.coins} 森林金幣與 ${cost.water} 成長水滴，增加一塊永久土地。可持續購買，不扣星星積分。</p><p class="body-copy">目前共有 ${data.garden.plotCount} 塊土地。餘額：${data.wallet.coinBalance} 金幣、${data.wallet.waterBalance} 水滴。${enough?'':'資源不足，請先完成考試或閱讀並取得獎勵。'}</p><form id="buyPlotForm">${formEnd('確認開墾')}`);
 $('buyPlotForm').querySelector('[type=submit]').disabled=!enough;
 $('buyPlotForm').onsubmit=async e=>{e.preventDefault();const result=await action('buyPlot',{});if(result){await changeForestPage(Math.floor(result.positionIndex/PLOTS_PER_PAGE));status(`已開墾位置 ${result.positionIndex+1}，可以種植新植物了。`);}};
}
$('buyPlot').onclick=buyPlotForm;
$('resourceGuide').onclick=()=>{
 if(!data||busy)return;const s=data.settings,n=esc;
 sheet('資源怎麼獲得？',`<p>星星積分可申請夢想獎勵；成長水滴用於澆水與開墾；森林金幣用於購買種子與開墾。</p><h3>考試：依目前群組規則</h3><p>${s.examApproval?'家長核准後，三種資源才會一起入帳。':'提交有效紀錄後，三種資源自動入帳。'}分數先換算為百分制，再套用下列區間。</p><div class="resource-table"><table><thead><tr><th>百分制區間</th><th>星星積分</th><th>成長水滴</th><th>森林金幣</th></tr></thead><tbody>${s.examBands.map((b,i)=>`<tr><td>${n(b.min)}${i?`～未滿 ${n(s.examBands[i-1].min)}`:'～100'} 分</td><td>${n(b.points)}</td><td>${n(b.water)}</td><td>${n(b.coins)}</td></tr>`).join('')}</tbody></table></div><p>同科目、同考試類型與前一次有效成績比較，進步時僅額外增加星星：${s.improvementBands.map(b=>`進步至少 ${n(b.min)} 個百分點，額外 ${n(b.points)} 點`).join('；')}。只取符合的最高區間，不累加；首次紀錄沒有進步加分。</p><h3>閱讀</h3><p>每筆達 ${n(s.reading.minutes)} 分鐘可獲得一份：星星 ${n(s.reading.points)}、水滴 ${n(s.reading.water)}、金幣 ${n(s.reading.coins)}。每位使用者每日最多 ${n(s.reading.dailyLimit)} 份；未滿門檻仍保留紀錄，不發資源。${s.readingApproval?'需家長核准後一起入帳。':'目前採自動核准，不必等待家長。'}</p><h3>家長個別獎勵</h3><p>家長可以手動調整星星積分並填寫原因；手動調整不會增加水滴或金幣。既有歷史積分保留，不補發水滴或金幣。規則變更只影響之後提交的紀錄。</p>`);
};
function examForm(){
 if(!data||busy)return;
 sheet('紀錄考試',`<form id="examForm" class="form-grid">${field('考試日期','eventDate','date',today(),`required max="${today()}"`)}${select('科目','subject',['國文','英文','數學','自然','社會','自訂'],'數學')}${field('自訂科目（選自訂時填寫）','customSubject','text','','maxlength="40"')}${select('考試類型','examType',['小考','段考','期中考','期末考','練習測驗'])}${field('考試分數','score','number','','required min="0" max="10000" step="0.01" inputmode="decimal"')}${field('考試滿分','maxScore','number',100,'required min="0.01" max="10000" step="0.01"')}${note()}<label class="full">考卷照片（選填，最大 5 MB）<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="hint full">${data.settings.examApproval?'成績需家長核准後才發放獎勵。':'目前考試採自動核准。'} 不同滿分會換算為百分制比較。</p>${formEnd('提交考試紀錄')}`);
 $('examForm').elements.photo.onchange=()=>{delete $('examForm').dataset.photoPath;};
 $('examForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;const form=e.currentTarget,fd=new FormData(form),subject=fd.get('subject')==='自訂'?fd.get('customSubject'):fd.get('subject');if(!String(subject).trim()){form.querySelector('.form-error').textContent='請輸入自訂科目';return;}
  const payload={type:'exam',eventDate:fd.get('eventDate'),subject,examType:fd.get('examType'),score:Number(fd.get('score')),maxScore:Number(fd.get('maxScore')),note:fd.get('note')};
  if(payload.score>payload.maxScore){form.querySelector('.form-error').textContent='分數不可高於滿分';return;}
  const file=fd.get('photo');let photoPath=form.dataset.photoPath||null;
  try{if(file?.size&&!photoPath){busy=true;form.querySelector('button[type=submit]').disabled=true;photoPath=await client.upload(file);form.dataset.photoPath=photoPath;}}
  catch(error){form.querySelector('.form-error').textContent=message(error);return;}
  finally{busy=false;form.querySelector('button[type=submit]').disabled=false;}
  await action('createRecord',{...payload,photoPath});
 };
}
$('openExam').onclick=examForm;
function readingForm(){
 if(!data||busy)return;
 sheet('閱讀紀錄',`<form id="readingForm" class="form-grid"><div class="timer-panel"><output id="readingTime">00:00:00</output><button type="button" id="startClock">${clock.running?'計時中':'開始／繼續'}</button><button type="button" id="pauseClock" class="outline">暫停</button><button type="button" id="finishClock" class="outline">完成並帶入分鐘</button><p class="hint">離開頁面也會保留計時。可使用下方手動輸入，計時並非閱讀證明。</p></div>${field('閱讀日期','eventDate','date',today(),`required max="${today()}"`)}${field('書籍名稱','bookName','text','','required maxlength="150"')}${field('閱讀分鐘（可手動輸入）','readingMinutes','number',0,'required min="0" max="1440" step="0.01" inputmode="decimal"')}${field('閱讀頁數','readingPages','number',0,'required min="0" max="10000" step="1"')}${field('閱讀章節（選填）','chapter','text','','maxlength="100"')}${note('閱讀心得（選填）')}<p class="hint full">${data.settings.readingApproval?'需家長確認後發獎。':'閱讀紀錄自動核准。'}每 ${data.settings.reading.minutes} 分鐘可獲獎，每日上限 ${data.settings.reading.dailyLimit} 份；未達門檻也會保留紀錄。</p>${formEnd('記下今天的閱讀')}`);
 $('startClock').onclick=()=>{clock.start();updateTimer();};$('pauseClock').onclick=()=>{clock.pause();updateTimer();};$('finishClock').onclick=()=>{$('readingForm').elements.readingMinutes.value=clock.finish();updateTimer();};
 $('readingForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);await action('createRecord',{type:'reading',eventDate:fd.get('eventDate'),bookName:fd.get('bookName'),readingMinutes:Number(fd.get('readingMinutes')),readingPages:Number(fd.get('readingPages')),chapter:fd.get('chapter'),note:fd.get('note')});};
}
$('openReading').onclick=readingForm;
function updateTimer(){const out=$('readingTime');if(!out)return;const secs=Math.floor(clock.elapsed()/1000);out.textContent=[Math.floor(secs/3600),Math.floor(secs/60)%60,secs%60].map(n=>String(n).padStart(2,'0')).join(':');$('startClock').disabled=clock.running||busy;}
function memberOptions(){return data.members.map(m=>({value:m.accountId,label:m.name}));}
function childName(id){return data.members.find(m=>m.accountId===id)?.name||id;}
// 依目前顯示文字計算原生選單寬度，並保留箭頭與觸控空間。
function fitMemberSelect(container){
 const control=container.querySelector('select[name=accountId],select[name=parentTarget]');if(!control)return;
 const canvas=document.createElement('canvas'),drawing=canvas.getContext('2d');drawing.font=getComputedStyle(control).font;
 control.style.width=Math.ceil(Math.max(108,drawing.measureText(control.selectedOptions[0]?.textContent||'').width+54))+'px';control.style.maxWidth='100%';
}
function renderFilters(container,parent){
 container.innerHTML=`<form class="filters record-filters" data-forest-filters>${parent?`<div class="filter-member">${select('成員','accountId',[{value:'all',label:'全部成員'},...memberOptions()],recordFilters.accountId||'all')}</div>`:''}${select('類型','type',[{value:'',label:'全部'},{value:'exam',label:'考試'},{value:'reading',label:'閱讀'}],recordFilters.type||'')}<div class="filter-status-pair">${select('狀態','status',[{value:'',label:'全部'},...['pending','approved','rejected','revoked'].map(v=>({value:v,label:labels[v]}))],recordFilters.status||'')}${field('考試類型','examType','text',recordFilters.examType||'')}</div><div class="filter-date-range">${field('開始日期','from','date',recordFilters.from||'')}${field('結束日期','to','date',recordFilters.to||'')}</div>${field('科目','subject','text',recordFilters.subject||'')}${field('書名包含','bookName','text',recordFilters.bookName||'')}<button>套用篩選</button></form>`;
 fitMemberSelect(container);
 container.querySelector('[name=accountId]')?.addEventListener('change',()=>fitMemberSelect(container));
 container.querySelector('form').onsubmit=async e=>{e.preventDefault();recordFilters=Object.fromEntries(new FormData(e.currentTarget));await loadRecords(true,parent);};
}
async function loadRecords(reset=false,parent=view==='parent'){
 if(!client)return;const container=parent?$('parentRecords'):$('recordList');if(!container)return;
 const generation=++recordGeneration,rows=reset?[]:recordRows.slice(),cursor=reset?null:recordCursor,scroll=parent?$('parentRecordScroll'):null,scrollTop=!reset?scroll?.scrollTop||0:0;
 try{const result=await client.api('list',{kind:'records',...recordFilters,accountId:parent?(recordFilters.accountId||'all'):context.accountId,cursor});if(generation!==recordGeneration||!container.isConnected||(parent?view!=='parent':view!=='records'))return;recordRows=[...rows,...result.rows];recordCursor=result.cursor;
  container.innerHTML=recordRows.length?recordRows.map(recordRow).join(''):'<p class="empty">這裡會記得你的每一份努力。<br>目前沒有符合條件的紀錄。</p>';
  container.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>recordDetail(recordRows.find(r=>r.id===b.dataset.record)));
  const open=recordRows.find(r=>r.id===$('sheet').dataset.recordId);if($('sheet').open&&open&&open.approvalStatus!==$('sheet').dataset.recordStatus)recordDetail(open);
  if(parent){$('parentRecordCount').textContent=`已載入 ${recordRows.length} 筆`;if(scroll)scroll.scrollTop=scrollTop;}
  const more=parent?$('parentMore'):$('recordMore');more.hidden=!result.hasMore;more.onclick=()=>loadRecords(false,parent);
 }catch(error){status(message(error),true);}
}
function recordRow(r){const title=r.type==='exam'?`${r.subject} · ${r.score} / ${r.maxScore}`:`${r.bookName} · ${r.readingMinutes} 分鐘`;return `<article class="record-row"><div><time>${esc(r.eventDate)} · ${esc(childName(r.accountId))}</time><strong>${esc(title)}</strong><p>${r.type==='exam'?esc(r.examType):`${r.readingPages} 頁 · ${esc(r.chapter)}`}</p><p>${r.approvalStatus==='approved'?`星星 +${r.rewardPoints} · 水滴 +${r.rewardWater} · 金幣 +${r.rewardCoins}`:'獎勵依審核結果發放'}</p></div><div class="row-actions"><span class="status-pill ${esc(r.approvalStatus)}">${esc(labels[r.approvalStatus]||r.approvalStatus)}</span><button class="outline" data-record="${esc(r.id)}">查看${data.parent&&r.approvalStatus==='pending'?'／審核':''}</button></div></article>`;}
function recordDetail(r){
 sheet(r.type==='exam'?'考試紀錄':'閱讀紀錄',`<div class="record-detail">${esc(childName(r.accountId))} · ${esc(r.eventDate)}\n${r.type==='exam'?esc(`${r.subject}／${r.examType}：${r.score} / ${r.maxScore}`):esc(`${r.bookName}\n${r.readingMinutes} 分鐘 · ${r.readingPages} 頁 · ${r.chapter}`)}\n${esc(r.note)}\n狀態：${esc(labels[r.approvalStatus])}\n${r.reviewNote?'家長備註：'+esc(r.reviewNote):''}\n${r.approvalStatus==='approved'?`星星 ${r.rewardPoints} · 水滴 ${r.rewardWater} · 金幣 ${r.rewardCoins}`:''}${r.improvementBonus?`\n進步 ${r.improvement} 百分點，加獎 ${r.improvementBonus} 星星`:''}</div>${r.photoPath?'<button id="viewPhoto" class="outline">查看考卷照片</button><div id="photoContainer"></div>':''}${data.parent&&r.approvalStatus==='pending'?'<div class="row-actions"><button id="approveRecord">核准並發放</button><button id="rejectRecord" class="outline">退回</button></div>':''}${data.parent&&r.approvalStatus==='approved'?'<div class="row-actions"><button id="correctRecord" class="outline">更正紀錄</button><button id="revokeRecord" class="danger">撤銷並沖回獎勵</button></div>':''}${['pending','rejected'].includes(r.approvalStatus)?'<button id="editPending" class="outline">編輯並重新送審</button>':''}<p class="form-error"></p>`);
 $('sheet').dataset.recordId=r.id;$('sheet').dataset.recordStatus=r.approvalStatus;
 if(['pending','rejected'].includes(r.approvalStatus))$('editPending').onclick=()=>editPendingForm(r);
 if(r.photoPath)$('viewPhoto').onclick=async()=>{try{const blob=await client.photo(r.photoPath),url=URL.createObjectURL(blob);photoUrls.push(url);const image=new Image();image.src=url;image.alt='考卷照片';image.className='exam-photo';$('photoContainer').replaceChildren(image);}catch(e){status(message(e),true);}};
 if(data.parent&&r.approvalStatus==='pending'){$('approveRecord').onclick=()=>action('reviewRecord',{id:r.id,accountId:r.accountId,status:'approved'});$('rejectRecord').onclick=()=>reasonForm('退回紀錄','reviewRecord',{id:r.id,accountId:r.accountId,status:'rejected'});}
 if(data.parent&&r.approvalStatus==='approved'){$('revokeRecord').onclick=()=>reasonForm('撤銷並沖回獎勵','correctRecord',{id:r.id,accountId:r.accountId,revoke:true});$('correctRecord').onclick=()=>correctForm(r);}
}
function editPendingForm(r){
 sheet('編輯並重新送審',`<form id="editPendingForm" class="form-grid">${field('日期','eventDate','date',r.eventDate,`required max="${today()}"`)}${r.type==='exam'?field('科目','subject','text',r.subject,'required maxlength="40"')+select('考試類型','examType',['小考','段考','期中考','期末考','練習測驗',r.examType].filter((v,i,a)=>a.indexOf(v)===i),r.examType)+field('分數','score','number',r.score,'required min="0" step="0.01"')+field('滿分','maxScore','number',r.maxScore,'required min="0.01" step="0.01"'):field('書名','bookName','text',r.bookName,'required maxlength="150"')+field('分鐘','readingMinutes','number',r.readingMinutes,'required min="0" step="0.01"')+field('頁數','readingPages','number',r.readingPages,'required min="0" step="1"')+field('章節','chapter','text',r.chapter)}${note('備註','note',r.note)}${formEnd('重新送審')}`);
 $('editPendingForm').onsubmit=e=>{e.preventDefault();const fields=Object.fromEntries(new FormData(e.currentTarget));for(const key of ['score','maxScore','readingMinutes','readingPages'])if(key in fields)fields[key]=Number(fields[key]);action('editRecord',{id:r.id,fields});};
}
function reasonForm(title,actionName,payload){sheet(title,`<form id="reasonForm" class="form-grid"><p class="hint full">請說明原因。系統會保留操作紀錄；若可用資源不足，撤銷會被拒絕，原紀錄不會被覆蓋。</p>${note('原因（必填）','reason')}${formEnd('確認')}`);$('reasonForm').onsubmit=e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get('reason');if(!reason.trim())return e.currentTarget.querySelector('.form-error').textContent='請填寫原因';action(actionName,{...payload,reason});};}
function correctForm(r){sheet('更正已核准紀錄',`<form id="correctForm" class="form-grid">${r.type==='exam'?field('分數','score','number',r.score,'required min="0" step="0.01"')+field('滿分','maxScore','number',r.maxScore,'required min="0.01" step="0.01"'):field('書名','bookName','text',r.bookName,'required maxlength="150"')+field('分鐘','readingMinutes','number',r.readingMinutes,'required min="0" step="0.01"')+field('頁數','readingPages','number',r.readingPages,'required min="0" step="1"')+field('章節','chapter','text',r.chapter)}${note('備註','note',r.note)}${note('更正原因（必填）','reason')}<p class="hint full">沿用提交時獎勵規則，以差額交易調整，不重發原獎勵。日期、科目與考試類型若有誤，請先撤銷再新增。</p>${formEnd('確認更正')}`);$('correctForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget),fields={};for(const key of r.type==='exam'?['score','maxScore']:['bookName','readingMinutes','readingPages','chapter'])fields[key]=['score','maxScore','readingMinutes','readingPages'].includes(key)?Number(fd.get(key)):fd.get(key);fields.note=fd.get('note');action('correctRecord',{id:r.id,accountId:r.accountId,fields,reason:fd.get('reason')});};}
function renderRewards(parent=false){
 const container=parent?$('parentRewards'):$('rewardList');if(!container)return;
 const rewards=data.rewards.filter(r=>parent||r.status==='active');container.innerHTML=rewards.length?rewards.map(r=>`<article class="reward"><p class="eyebrow">DREAM REWARD</p><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><p><strong>${r.cost}</strong> 星星積分${parent?' · '+(r.status==='active'?'已上架':'已下架'):''}</p><button data-reward="${esc(r.id)}">${parent?'編輯獎品':'申請兌換'}</button></article>`).join(''):'<p class="empty">夢想正在準備中。請家長加入第一個獎勵。</p>';
 container.querySelectorAll('[data-reward]').forEach(b=>b.onclick=()=>{const r=data.rewards.find(r=>r.id===b.dataset.reward);if(parent)return rewardForm(r);sheet('申請夢想獎勵',`<form id="requestForm" class="form-grid"><p class="full">${esc(r.name)} · 需要 ${r.cost} 點<br>目前可用 ${available()} 點。申請後先保留積分，待家長確認發放。</p>${note('想對家長說的話（選填）','detail')}${formEnd('確認申請')}`);$('requestForm').onsubmit=e=>{e.preventDefault();action('requestReward',{giftId:r.id,detail:new FormData(e.currentTarget).get('detail')});};});
}
function rewardForm(r={}){sheet(r.id?'編輯夢想獎勵':'新增夢想獎勵',`<form id="rewardForm" class="form-grid">${field('獎品名稱','name','text',r.name||'','required maxlength="100"')}${field('所需星星積分','cost','number',r.cost||10,'required min="0.01" step="0.01"')}${select('上架狀態','status',[{value:'active',label:'上架'},{value:'inactive',label:'下架'}],r.status||'active')}${note('獎品說明','description',r.description||'')}${formEnd('儲存獎品')}`);$('rewardForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget);action('saveReward',{...(r.id?{id:r.id}:{}),name:fd.get('name'),cost:Number(fd.get('cost')),status:fd.get('status'),description:fd.get('description')});};}
async function requestList(container,legacy=false,cursor=null,append=false,isCurrent=()=>true){
 try{const result=await client.api(legacy?'legacyList':'list',{kind:'requests',accountId:view==='parent'?targetId:context.accountId,cursor}),html=result.rows.map(r=>`<article class="record-row"><div><strong>${esc(r.name)}</strong><p>${esc(childName(r.accountId))} · ${r.cost} 點 · ${esc(labels[r.status]||r.status)}</p><p>${esc(r.detail||r.reason||'')}</p></div><div class="row-actions">${data.parent&&['requested','approved','processing'].includes(r.status)?['approved','processing','completed','rejected'].filter(s=>s!==r.status&&!(r.status==='processing'&&s==='approved')).map(s=>`<button data-request="${esc(r.id)}" data-status="${s}">${esc(labels[s])}</button>`).join(''):r.accountId===context.accountId&&r.status==='requested'?`<button data-request="${esc(r.id)}" data-status="cancelled">取消申請</button>`:''}</div></article>`).join('')||'<p class="empty">目前沒有兌換申請。</p>';
  if(!container?.isConnected||!isCurrent())return;
  if(!append){container._requestRows=new Map();container.innerHTML='<div class="requests-rows"></div><button class="more-requests outline" hidden>載入更多</button>';}for(const r of result.rows)container._requestRows.set(r.id,r);container.querySelector('.requests-rows').insertAdjacentHTML('beforeend',html);
  container.querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>{const r=container._requestRows.get(b.dataset.request);if(!r)return;reasonForm('更新為'+labels[b.dataset.status],'changeRewardRequest',{id:r.id,accountId:r.accountId,status:b.dataset.status});});
  const more=container.querySelector('.more-requests');more.hidden=!result.hasMore;more.onclick=()=>requestList(container,legacy,result.cursor,true,isCurrent);
 }catch(error){if(container?.isConnected&&isCurrent())status(message(error),true);}
}
$('rewardRequests').onclick=async()=>{if(!data||busy)return;sheet('我的兌換申請','<div id="myRequests"></div><button id="oldRequests" class="text-link">查看改版前申請</button>');await requestList($('myRequests'));$('oldRequests').onclick=()=>requestList($('myRequests'),true);};
async function transactions(container,accountId,cursor=null,append=false,isCurrent=()=>true){
 const result=await client.api('list',{kind:'transactions',accountId,cursor});const html=result.rows.map(r=>`<article class="record-row"><div><time>${esc(new Date(r.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</time><strong>${esc(({ 'legacy-opening':'歷史積分銜接','record-award':'成長獎勵','parent-adjustment':'家長積分調整','seed-purchased':'購買種子','plant-watered':'植物澆水','record-corrected':'紀錄更正','record-revoked':'紀錄撤銷','reward-reserved':'申請保留','reward-completed':'獎品已發放','reward-rejected':'兌換退回','reward-cancelled':'兌換取消' })[r.kind]||r.kind)}</strong><p>星星 ${r.delta.points>=0?'+':''}${r.delta.points} · 水滴 ${r.delta.water} · 金幣 ${r.delta.coins}</p><p>${esc(r.reason)}<br>來源 ${esc(r.source.kind)}／${esc(r.source.id)}</p><p>交易後：星星 ${r.after.points}、保留 ${r.after.reserved||0}、水滴 ${r.after.water}、金幣 ${r.after.coins}</p></div></article>`).join('')||'<p class="empty">目前沒有資源交易。</p>';
 if(!container?.isConnected||!isCurrent())return;
 if(!append)container.innerHTML='<div class="transaction-rows"></div><button class="more-transactions outline" hidden>載入更多</button>';container.querySelector('.transaction-rows').insertAdjacentHTML('beforeend',html);const more=container.querySelector('.more-transactions');more.hidden=!result.hasMore;more.onclick=()=>transactions(container,accountId,result.cursor,true,isCurrent);
}
$('showTransactions').onclick=async()=>{if(!data||busy)return;sheet('資源交易明細','<div id="transactions"></div>');try{await transactions($('transactions'),context.accountId);}catch(e){status(message(e),true);}};
$('legacyRecords').onclick=()=>legacyRecords();
async function legacyRecords(cursor=null,append=false){
 if(!data||busy)return;
 if(!append)sheet('改版前成長紀錄','<p class="hint">保留原始紀錄與積分；這些歷史資料不會再次獲得水滴、金幣或新積分。</p><div id="oldRecordRows"></div><button id="oldRecordMore" class="outline" hidden>載入更多</button>');
 try{const r=await client.api('legacyList',{kind:'records',accountId:view==='parent'?targetId:context.accountId,cursor});$('oldRecordRows').insertAdjacentHTML('beforeend',r.rows.map(row=>`<div class="record-row"><div><time>${esc(row.eventDate||row.date||'歷史日期未提供')}</time><strong>${esc(row.subject||row.category||'歷史紀錄')}</strong><p>${esc(row.examType||row.note||'')} ${row.score!=null?esc(row.score)+' 分':''}</p></div><span class="status-pill">已保留</span></div>`).join('')||'<p class="empty">沒有可依帳號確認歸屬的歷史紀錄。</p>');$('oldRecordMore').hidden=!r.hasMore;$('oldRecordMore').onclick=()=>legacyRecords(r.cursor,true);}catch(e){status(message(e),true);}
}
async function renderParent(){
 if(!data.parent)return;const root=$('parentContent');targetId=targetId&&data.members.some(m=>m.accountId===targetId)?targetId:(data.members.find(m=>!['parent','admin'].includes(m.role))?.accountId||context.accountId);
 // 每次重新渲染使舊分頁／舊成員的非同步回應失效。
 const generation=++parentGeneration,mode=parentMode,accountId=targetId;recordGeneration++;
 const previous=$('parentRecordSection'),expanded=parentMode==='records'&&previous?.dataset.accountId===targetId&&previous.open,scrollTop=expanded?$('parentRecordScroll')?.scrollTop||0:0;
 root.innerHTML=`${parentMode==='records'?'':`<div class="filters">${select('成員','parentTarget',memberOptions(),targetId)}</div>`}<div id="parentPanel"></div>`;fitMemberSelect(root);const memberSelect=root.querySelector('[name=parentTarget]');if(memberSelect)memberSelect.onchange=e=>{targetId=e.target.value;renderParent().catch(e=>status(message(e),true));};
 const panel=$('parentPanel'),current=()=>!stopped&&view==='parent'&&generation===parentGeneration&&parentMode===mode&&targetId===accountId&&panel.isConnected;
 if(mode==='records'){
  panel.innerHTML=`<div id="parentFilters"></div><details id="parentRecordSection" class="parent-record-section" data-account-id="${esc(targetId)}" ${expanded?'open':''}><summary>成長紀錄與審核 <span id="parentRecordCount"></span></summary><div id="parentRecordScroll" class="parent-record-scroll" tabindex="0" role="region" aria-label="成長紀錄與審核清單"><div id="parentRecords" class="record-list"></div><button id="parentMore" class="outline" hidden>載入更多紀錄</button></div></details>`;
  const section=$('parentRecordSection'),region=$('parentRecordScroll');renderFilters($('parentFilters'),true);await loadRecords(true,true);if(current()&&expanded)region.scrollTop=scrollTop;return;
 }
 if(mode==='overview'){const r=await client.api('overview',{accountId});if(!current())return;panel.innerHTML=`<p class="hint">${esc(r.month)} · 統計已核准紀錄與可確認歸屬的歷史考試；未審核不列入。</p><div class="summary-grid">${[['考試次數',r.examCount],['百分制平均',r.average==null?'尚無資料':r.average],['閱讀分鐘',r.readingMinutes],['閱讀頁數',r.readingPages],['可用星星',r.available],['已兌換積分',r.redeemed]].map(([l,n])=>`<div><small>${l}</small><strong>${n}</strong></div>`).join('')}</div><button id="manualReward" class="outline">手動調整星星積分</button>`;panel.querySelector('#manualReward').onclick=()=>{sheet('調整星星積分',`<form id="manualForm" class="form-grid"><p class="full">對象：${esc(childName(targetId))}</p>${field('積分（可輸入負數扣除）','points','number','','required min="-100000" max="100000" step="0.01"')}${note('調整原因（必填）','reason')}${formEnd('確認調整')}`);$('manualForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget);action('manualReward',{accountId:targetId,points:Number(fd.get('points')),reason:fd.get('reason')});};};}
 if(mode==='settings')settingsForm(panel);
 if(mode==='rewards'){panel.innerHTML='<button id="newReward">新增夢想獎勵</button><div id="parentRewards" class="reward-grid"></div>';$('newReward').onclick=()=>rewardForm();renderRewards(true);}
 if(mode==='requests'){panel.innerHTML='<div id="parentRequests"></div><button id="oldParentRequests" class="text-link">查看改版前申請</button>';const requests=panel.querySelector('#parentRequests');await requestList(requests,false,null,false,current);if(!current())return;panel.querySelector('#oldParentRequests').onclick=()=>requestList(requests,true,null,false,current);}
 if(mode==='transactions')await transactions(panel,accountId,null,false,current);
 if(mode==='migration'){const r=await client.api('snapshot',{accountId});if(!current())return;const m=r.migration;panel.innerHTML=`<h3>舊資料已安全銜接</h3><p class="body-copy">${esc(childName(targetId))} 的歷史成績 ${m.scoreCount} 筆、兌換 ${m.requestCount} 筆。<br>原可用積分 ${m.legacyBalance}，另有 ${m.pointsReserved} 點處於舊申請保留中。<br>原始資料保留不刪除，不重新發放歷史獎勵。</p><p class="hint">缺少 accountId 或群組歸屬矛盾的舊資料不會依姓名猜測，請專案擁有者查閱遷移報告。</p><button id="parentLegacy" class="outline">查看歷史紀錄</button>`;panel.querySelector('#parentLegacy').onclick=()=>legacyRecords();}
}
const parentTabs=[...document.querySelectorAll('[data-parent]')];
parentTabs.forEach((tab,index)=>{
 tab.onclick=async()=>{
  if(busy)return;parentMode=tab.dataset.parent;
  parentTabs.forEach(item=>{const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;});
  $('parentContent').setAttribute('aria-labelledby',tab.id);
  tab.scrollIntoView({block:'nearest',inline:'nearest'});
  try{await renderParent();}catch(error){status(message(error),true);}
 };
 tab.onkeydown=event=>{
  let next;if(event.key==='ArrowRight')next=(index+1)%parentTabs.length;else if(event.key==='ArrowLeft')next=(index+parentTabs.length-1)%parentTabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=parentTabs.length-1;else return;
  event.preventDefault();parentTabs[next].focus();parentTabs[next].click();
 };
});
function settingsForm(root){
 const s=data.settings;root.innerHTML=`<form id="settingsForm"><p class="body-copy">新規則只套用於之後提交的紀錄；已提交紀錄使用當時的規則快照。</p><section class="settings-section"><h3>考試獎勵</h3>${s.examBands.map((b,i)=>`<div class="settings-row">${field('最低百分比',`examMin${i}`,'number',b.min,'required min="0" max="100" step="0.01"')}${field('星星',`examPoints${i}`,'number',b.points,'required min="0" step="0.01"')}${field('水滴',`examWater${i}`,'number',b.water,'required min="0" step="1"')}${field('金幣',`examCoins${i}`,'number',b.coins,'required min="0" step="1"')}</div>`).join('')}<label><input name="examApproval" type="checkbox" ${s.examApproval?'checked':''}> 考試需要家長審核</label></section><section class="settings-section"><h3>進步獎勵</h3>${s.improvementBands.map((b,i)=>`<div class="settings-row">${field('進步百分點',`improvementMin${i}`,'number',b.min,'required min="0.01" step="0.01"')}${field('額外星星',`improvementPoints${i}`,'number',b.points,'required min="0" step="0.01"')}</div>`).join('')}</section><section class="settings-section"><h3>閱讀獎勵與每日上限</h3><div class="form-grid">${field('每份需閱讀分鐘','readingMinutes','number',s.reading.minutes,'required min="1" max="1440" step="1"')}${field('每日最多獎勵份數','readingDaily','number',s.reading.dailyLimit,'required min="0" max="20" step="1"')}${field('每份星星','readingPoints','number',s.reading.points,'required min="0" step="0.01"')}${field('每份水滴','readingWater','number',s.reading.water,'required min="0" step="1"')}${field('每份金幣','readingCoins','number',s.reading.coins,'required min="0" step="1"')}</div><label><input name="readingApproval" type="checkbox" ${s.readingApproval?'checked':''}> 閱讀需要家長審核</label></section><p class="form-error"></p><button type="submit">儲存未來適用規則</button></form>`;
 root.querySelector('#settingsForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget),n=name=>Number(fd.get(name));action('saveSettings',{settings:{examApproval:fd.has('examApproval'),readingApproval:fd.has('readingApproval'),examBands:s.examBands.map((_,i)=>({min:n('examMin'+i),points:n('examPoints'+i),water:n('examWater'+i),coins:n('examCoins'+i)})),improvementBands:s.improvementBands.map((_,i)=>({min:n('improvementMin'+i),points:n('improvementPoints'+i)})),reading:{minutes:n('readingMinutes'),dailyLimit:n('readingDaily'),points:n('readingPoints'),water:n('readingWater'),coins:n('readingCoins')}}},{close:false});};
}
/**
 * 連接所選傳輸、載入目前視圖，再建立資料及帳號外觀訂閱。
 * @returns {Promise<void>} 失敗顯示重試；重建前會解除原資料訂閱。
 * @description 預設從我的森林開始，管理角色不改變首次視圖。
 */
async function initialize(){
 $('retry').hidden=true;status('正在連接你的森林…');
 try{if(!client){const m=await import('./client.js');client=await m.connect(context);stopAppearance=client.watchAppearance?.((appearance,metadata)=>window.NexusTheme?.hydrate(context.accountId,appearance,metadata));}await refresh();if(stopped)return;await openView(view);status('你的森林已同步。');unsubscribe?.();unsubscribe=client.subscribe(data.parent,scheduleRefresh,e=>status('即時同步中斷：'+message(e),true));}
 catch(error){status(message(error),true);$('retry').hidden=false;}
}
$('retry').onclick=initialize;
function startTimer(){clearInterval(timer);if(!document.hidden)timer=setInterval(updateTimer,500);}
document.addEventListener('visibilitychange',()=>{syncForestInput();if(document.hidden){clearInterval(timer);game?.pause();visitGame?.pause();}else{startTimer();if(view==='forest')game?.resume();if(view==='visit')visitGame?.resume();checkContext();}});
function checkContext(){let user;try{user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');}catch{}if(user?.accountId!==context.accountId||getSelectedGameGroupId(user)!==context.groupId)location.replace('wishwall.html');}
window.addEventListener('storage',checkContext);window.addEventListener('focus',checkContext);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
window.addEventListener('pagehide',()=>{stopped=true;unsubscribe?.();stopAppearance?.();clearTimeout(refreshTimer);clearInterval(timer);game?.destroy();visitGame?.destroy();clearTimeout(noticeTimer);photoUrls.forEach(URL.revokeObjectURL);});
// 讓公開場景素材與 Firebase 連線平行；預載失敗仍由場景建立流程提供重試提示。
import('./scene.js').then(module=>module.prepareForest()).catch(()=>{});
startTimer();initialize();
