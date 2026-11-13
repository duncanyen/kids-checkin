// 只透過已驗證管理員的 API 讀取報表；不直接讀取或寫入玩家集合。
export function createFarmReportUI({root,api,node,button,table,formatTime,status}){
 let version=0,busy=false,active=false;
 const wall=value=>new Date(value+8*3600000).toISOString().slice(0,19);
 const stamp=value=>Date.parse(value+(value.length===16?':00':'')+'+08:00');
 const formatStamp=value=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(value));
 const number=value=>Number.isSafeInteger(value)?value.toLocaleString('zh-TW'):'—';
 function open(){
  active=true;version++;root.replaceChildren();
  const card=node('section',undefined,'card management-card');card.append(node('h2','跨群組營運報表'),node('p','查詢目前所有群組的成員。同一帳號在不同群組分開列示；目前雞數及餘額不隨查詢區間改變。','muted'));
  const form=node('form',undefined,'filters report-filters'),current=Date.now(),day=wall(current).slice(0,10);
  for(const [name,label,value]of [['startAt','開始時間（台灣）',day+'T00:00:00'],['endAt','結束時間（台灣）',wall(current)]]){const field=node('label',label),input=node('input');input.type='datetime-local';input.step='1';input.name=name;input.required=true;input.value=value;field.append(input);form.append(field);}
  const submit=button('查詢報表',()=>{},'primary');submit.type='submit';form.append(submit);card.append(form,node('p','區間包含開始、不包含結束。單次最多 366 天。沒有歷史紀錄時不會用目前累計值回推。','muted'));
  const result=node('div');result.setAttribute('aria-live','polite');card.append(result);root.append(card);status('');
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||!form.reportValidity())return;
   const fd=new FormData(form),startAt=stamp(fd.get('startAt')),endAt=stamp(fd.get('endAt'));
   if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||startAt>=endAt){status('開始時間必須早於結束時間',true);return;}
   const token=++version;busy=true;submit.disabled=true;result.replaceChildren();status('正在彙整所有群組的報表…');
   try{
    const data=await api('farmReport',{startAt,endAt});if(!active||token!==version)return;
    const unavailable=['not-started','unavailable'].includes(data.coverage),coverage={ 'not-started':'尚未開始收集，區間統計無歷史資料',unavailable:'此區間早於資料收集，無歷史資料',partial:'部分紀錄：開始時間早於資料收集，以下不是完整區間總數',observed:'已觀測紀錄（可能有處理延遲，不作為即時結算）'}[data.coverage];
    result.append(node('h3',coverage),node('p',`${data.groupCount} 個群組 · ${data.rows.length} 筆目前成員資料 · 查詢時間 ${formatStamp(data.asOf)}`,'muted'));
    if(data.firstObservedAt!==null)result.append(node('p','最早收集時間：'+formatStamp(data.firstObservedAt),'muted'));
    const labels=['群組','accountId','目前名稱','區間收蛋（顆）','區間偷蛋（顆）',...Object.values(data.monsters).map(name=>'擊敗'+name),'金幣增加額','金幣減少額','金幣淨變化','目前金幣餘額','目前雞數','備註'];
    const rows=data.rows.map(row=>{
     const count=(key,supported=true)=>unavailable?'無歷史資料':!supported&&!row.metrics[key]?'尚無累計紀錄':number(row.metrics[key]);
     return[row.groupName,row.accountId,row.name,count('collectedEggs',row.harvestCounterAvailable),count('stolenEggs',row.theftCounterAvailable),...Object.keys(data.monsters).map(key=>unavailable?'無歷史資料':number(row.metrics.monsters[key])),count('coinsAdded'),count('coinsSpent'),count('coinsNet'),row.hasFarm?number(row.currentCoins):'未建農場',row.hasFarm?number(row.currentHens):'未建農場',row.warnings.join('；')];
    });
    const wrap=node('div',undefined,'table-wrap farm-report-table');wrap.setAttribute('tabindex','0');wrap.setAttribute('aria-label','跨群組報表，可橫向捲動');wrap.append(table(labels,rows));result.append(wrap);
    const notes=node('ul',undefined,'report-notes');data.notes.forEach(text=>notes.append(node('li',text)));result.append(notes);status('報表已更新');
   }catch(error){if(active&&token===version){status(error.message||'報表讀取失敗，請重試',true);result.replaceChildren(node('p',error.message||'報表讀取失敗','error'));}}
   finally{busy=false;if(submit.isConnected)submit.disabled=false;}
  };
 }
 return{open,deactivate(){active=false;version++;},isBusy:()=>busy};
}
