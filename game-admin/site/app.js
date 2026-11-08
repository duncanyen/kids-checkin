import * as runtime from './runtime.js?v=20261108-admin-auth';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const labels={dashboard:'營運總覽',announcements:'使用者公告',gifts:'禮包管理',redemptions:'兌換紀錄',audit:'操作紀錄'};
const statusNames={draft:'草稿',scheduled:'排程發布',published:'已發布',archived:'已下架',active:'已啟用',inactive:'已停用',success:'成功',failed:'失敗'};
const types={announcements:{general:'一般公告',maintenance:'維護公告',event:'活動公告',update:'更新公告'},gifts:{universal:'通用禮包',limited:'限量禮包',single:'單次兌換',targeted:'指定玩家'}};
const formatTime=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)):'—';
const wallTime=value=>new Date(value+8*3600000).toISOString().slice(0,16);
const utc=value=>new Date(value+':00+08:00').getTime();
let view='dashboard',rows=[],pages=[null],page=0,nextCursor=null,revision=0,busy=false,catalog,editing,writeId;
const errorText=error=>error.code==='functions/permission-denied'?'權限驗證失敗，請確認管理員角色，並重新登入。':error.message||'操作失敗，請稍後重試。';
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
const pill=value=>node('span',statusNames[value]||value,'pill '+value);
const button=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
function table(headers,values){
    if(!values.length)return node('p','目前沒有符合條件的資料。','empty');
    const table=node('table'),thead=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));thead.append(tr);table.append(thead);
    const body=node('tbody');for(const cells of values){const row=node('tr');cells.forEach(value=>{const cell=node('td');if(value instanceof Node)cell.append(value);else cell.textContent=String(value??'—');row.append(cell);});body.append(row);}table.append(body);return table;
}
function auditRows(values){return values.map(r=>{const detail=button('查看差異',()=>showDetails(r));return[formatTime(r.createdAt),r.adminUid,r.action,r.target,pill(r.result),detail];});}
function showDetails(record){$('previewContent').replaceChildren(node('pre',JSON.stringify(record,null,2),'audit-diff'));$('preview').showModal();}
function fillSelect(select,values){select.replaceChildren();for(const [value,label]of Object.entries(values)){const option=node('option',label);option.value=value;select.append(option);}}
function configureFilters(){
    const nameBased=['announcements','gifts'].includes(view);
    $('searchLabel').firstChild.textContent=nameBased?'名稱前綴':view==='redemptions'?'玩家 accountId（完整）':'操作類型（完整）';
    $('search').placeholder=nameBased?'輸入標題或名稱開頭':view==='redemptions'?'例如：alice':'例如：saveGift';
    fillSelect($('statusFilter'),{'':'全部狀態',...(view==='announcements'?{draft:'草稿',scheduled:'排程發布',published:'已發布',archived:'已下架'}:view==='gifts'?{draft:'草稿',active:'已啟用',inactive:'已停用'}:{success:'成功',failed:'失敗'})});
    $('typeLabel').hidden=!nameBased;$('giftIdLabel').hidden=view!=='redemptions';
    fillSelect($('typeFilter'),{'':'全部類型',...(types[view]||{})});
}
function queryPayload(){
    const value={kind:view,cursor:pages[page],pageSize:25};
    if(view==='redemptions'){value.accountId=$('search').value.trim();value.giftCodeId=$('giftIdFilter').value.trim();value.result=$('statusFilter').value;}
    else if(view==='audit'){value.action=$('search').value.trim();value.result=$('statusFilter').value;}
    else{value.search=$('search').value;value.status=$('statusFilter').value;value.type=$('typeFilter').value;}
    return value;
}
async function load(){
    const version=++revision;status('正在取得最新資料…');$('createButton').disabled=true;
    try{
        if(view==='dashboard'){
            const data=await runtime.api('dashboard');if(version!==revision)return;
            const values=[['玩家總數',data.players,data.playerCountDefinition],['公告總數',data.announcementCount,'包含草稿與下架公告'],['目前有效公告',data.activeAnnouncements,'依伺服器時間計算'],['禮包總數',data.giftCount,'包含草稿及已停用禮包'],['目前有效禮包',data.activeGifts,'已啟用且在有效期間'],['成功兌換次數',data.redemptionCount,'僅計入成功發放']];
            $('metrics').replaceChildren(...values.map(([label,value,help])=>{const c=node('article',undefined,'metric');c.append(node('p',label,'metric-label'),node('p',Number(value).toLocaleString(),'metric-value'),node('small',help));return c;}));
            $('recentOperations').replaceChildren(table(['時間（台灣）','管理員 UID','操作','對象','結果','明細'],auditRows(data.recent)));$('asOf').textContent='更新於 '+formatTime(data.asOf);
        }else{
            const data=await runtime.api('list',queryPayload());if(version!==revision)return;rows=data.rows;nextCursor=data.nextCursor;renderList();
        }
        status('');
    }catch(error){if(version===revision)status(errorText(error),true);}
    finally{if(version===revision)$('createButton').disabled=false;}
}
function renderList(){
    let headers,values;
    if(['announcements','gifts'].includes(view)){
        headers=view==='announcements'?['標題','類型','狀態','有效期間（台灣）','對象','操作']:['禮包名稱','模式','狀態','已兌換／總上限','有效期間（台灣）','操作'];
        values=rows.map(r=>{
            const actions=node('div');actions.append(button('編輯',()=>openEditor(r)));
            if(view==='announcements')actions.append(button('預覽',()=>previewAnnouncement(r)),button('立即發布',()=>changeStatus(r,'published')),button('下架',()=>changeStatus(r,'archived'),'danger'));
            else actions.append(button(r.status==='active'?'停用':'啟用',()=>changeStatus(r,r.status==='active'?'inactive':'active'),r.status==='active'?'danger':''));
            return view==='announcements'?[r.title,types.announcements[r.type],pill(r.status),formatTime(r.startAt)+' ～ '+formatTime(r.endAt),r.targetType==='all'?'所有玩家':r.targetAccountIds.join('、'),actions]:[r.name,types.gifts[r.type],pill(r.status),`${r.redeemedCount} / ${r.maxRedemptions??'不限'}`,formatTime(r.startAt)+' ～ '+formatTime(r.endAt),actions];
        });
    }else if(view==='redemptions'){
        headers=['禮包名稱／ID','玩家 accountId','兌換時間（台灣）','結果','失敗原因','明細'];
        values=rows.map(r=>[r.name||r.giftCodeId||'未識別禮包',r.accountId,formatTime(r.createdAt),pill(r.result),r.failureReason||'—',button('獎勵與紀錄',()=>showDetails(r))]);
    }else{headers=['操作時間（台灣）','管理員 UID','操作','對象','結果','明細'];values=auditRows(rows);}
    $('listTable').replaceChildren(table(headers,values));$('previousPage').disabled=page===0;$('nextPage').disabled=!nextCursor;$('pageNumber').textContent=`第 ${page+1} 頁`;
}
async function selectView(value){
    view=value;pages=[null];page=0;nextCursor=null;
    $('pageTitle').textContent=labels[view];$('breadcrumb').textContent=labels[view];document.title=labels[view]+' · Nexus Game Admin';
    $('pageDescription').textContent=view==='dashboard'?'掌握公告、禮包與最近營運動態。':view==='announcements'?'管理玩家公告與排程，時間以台灣時區顯示。':view==='gifts'?'管理兌換資格、限額與獎勵，兌換碼只在建立時顯示。':view==='redemptions'?'追查成功與失敗的兌換請求。':'由伺服器保留的重要管理操作與前後差異。';
    $('dashboard').hidden=view!=='dashboard';$('listView').hidden=view==='dashboard';$('createButton').hidden=!['announcements','gifts'].includes(view);$('createButton').textContent=view==='gifts'?'＋ 建立禮包':'＋ 新增公告';
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
    $('search').value='';$('giftIdFilter').value='';configureFilters();document.body.classList.remove('menu-open');$('menuButton').setAttribute('aria-expanded','false');await load();
}
function field(key,label,type,value,full=false,options){
    const wrap=node('label',label,full?'full':''),input=node(type==='textarea'?'textarea':type==='select'?'select':'input');input.name=key;
    if(type!=='textarea'&&type!=='select')input.type=type;
    if(options)fillSelect(input,options);
    if(type==='checkbox')input.checked=!!value;else input.value=value??'';
    input.required=!['code','description','targetAccountIds','showPopup','maxRedemptions'].includes(key);if(type==='number')input.min=key==='priority'?'0':'1';
    if(key==='priority')input.max='100';if(type==='datetime-local')input.step='60';
    wrap.append(input);$('editorFields').append(wrap);return input;
}
function rewardRow(initial={kind:'coins',amount:100}){
    const row=node('div',undefined,'reward-row'),kind=node('select'),target=node('select'),amount=node('input');amount.type='number';amount.min='1';amount.required=true;amount.value=initial.amount;amount.setAttribute('aria-label','獎勵數量');kind.setAttribute('aria-label','獎勵種類');target.setAttribute('aria-label','獎勵項目');
    fillSelect(kind,{coins:'金幣',eggs:'雞蛋',chicken:'母雞',item:'遊戲道具'});
    const future=node('option','寶石（遊戲模型未支援）');future.disabled=true;kind.append(future);kind.value=initial.kind;
    function targets(){
        target.replaceChildren();target.hidden=kind.value==='coins';
        const values=kind.value==='eggs'?catalog.eggs:kind.value==='chicken'?catalog.chickens:catalog.items;
        for(const item of values||[]){const option=node('option',(item.name||item.key)+(item.enabled?'':`（${item.reason}）`));option.value=item.key;option.disabled=!item.enabled;target.append(option);}
        if(initial.breed||initial.itemKey)target.value=initial.breed||initial.itemKey;
        amount.max=String(catalog.limits[kind.value]);
    }
    kind.onchange=()=>{initial={};targets();};targets();
    row.append(kind,target,amount,button('移除',()=>row.remove()));row.read=()=>({kind:kind.value,amount:Number(amount.value),...(kind.value==='eggs'||kind.value==='chicken'?{breed:target.value}:kind.value==='item'?{itemKey:target.value}:{})});return row;
}
async function openEditor(record){
    if(busy)return;
    try{if(!catalog)catalog=await runtime.api('catalog');}catch(error){status(errorText(error),true);return;}
    editing=record||null;writeId=crypto.randomUUID();$('editorFields').replaceChildren();$('editorError').textContent='';
    const stamp=Date.now(),isGift=view==='gifts';$('editorTitle').textContent=(record?'編輯':'新增')+(isGift?'禮包':'公告');$('previewButton').hidden=isGift;$('publishButton').textContent='儲存並套用狀態';
    field(isGift?'name':'title',isGift?'禮包名稱':'公告標題','text',record?.[isGift?'name':'title']);
    field('type','類型','select',record?.type||(isGift?'universal':'general'),false,types[view]);
    field('status','狀態','select',record?.status||'draft',false,isGift?{draft:'草稿',active:'啟用',inactive:'停用'}:{draft:'草稿',scheduled:'排程發布',published:'立即發布',archived:'下架'});
    if(!isGift){field('priority','優先順序（0–100）','number',record?.priority??0);field('targetType','發布對象','select',record?.targetType||'all',false,{all:'所有玩家',accounts:'指定帳號'});field('showPopup','首次讀取時彈出公告','checkbox',record?.showPopup);}
    field('startAt','開始時間（台灣 UTC+8）','datetime-local',wallTime(record?.startAt||stamp));field('endAt','結束時間（台灣 UTC+8）','datetime-local',wallTime(record?.endAt||stamp+7*86400000));
    field('targetAccountIds','指定 accountId（逗號或換行分隔，最多 100 位）','textarea',record?.targetAccountIds?.join('\n')||'',true);
    field(isGift?'description':'content',isGift?'禮包說明':'公告內容（純文字）','textarea',record?.[isGift?'description':'content']||'',true);
    if(isGift){
        if(!record)field('code','自訂活動碼（留白則安全隨機產生，建立後僅顯示一次）','text','',true);
        field('maxRedemptions','全服總上限（通用／指定禮包留白為不限）','number',record?.maxRedemptions??'');field('maxRedemptionsPerUser','每位玩家上限','number',record?.maxRedemptionsPerUser||1);
        const area=node('section',undefined,'full'),heading=node('div',undefined,'reward-heading'),list=node('div',undefined,'reward-list');list.id='rewardRows';heading.append(node('h3','獎勵內容'),button('＋ 新增獎勵',()=>{if(list.children.length<20)list.append(rewardRow());}));
        for(const reward of record?.rewards||[{kind:'coins',amount:100}])list.append(rewardRow(reward));
        area.append(heading,list,node('p','母雞會占用雞舍容量；雞蛋與道具會占用倉庫。空間不足時整筆兌換保留，不會部分發放。','reward-help'));$('editorFields').append(area);
    }
    $('editor').showModal();
}
function editorPayload(statusOverride){
    const form=new FormData($('editorForm')),isGift=view==='gifts';
    const payload=Object.fromEntries(form);payload.status=statusOverride||payload.status;payload.startAt=utc(payload.startAt);payload.endAt=utc(payload.endAt);payload.targetAccountIds=String(payload.targetAccountIds||'').split(/[,，\n]/).map(v=>v.trim()).filter(Boolean);
    if(editing)payload.id=editing.id;
    if(isGift){payload.maxRedemptions=payload.maxRedemptions===''?null:Number(payload.maxRedemptions);payload.maxRedemptionsPerUser=Number(payload.maxRedemptionsPerUser);payload.rewards=[...$('rewardRows').children].map(row=>row.read());}
    else{payload.priority=Number(payload.priority);payload.showPopup=form.has('showPopup');if(payload.status==='published')payload.startAt=Math.min(payload.startAt,Date.now());}
    return payload;
}
function previewAnnouncement(value){$('previewContent').replaceChildren(node('h2',value.title||'未命名公告'),node('p',value.content||''));$('preview').showModal();}
function showCode(code){
    let dialog=$('codeDialog');if(!dialog){dialog=node('dialog');dialog.id='codeDialog';document.body.append(dialog);}
    dialog.replaceChildren(node('h2','禮包已建立'),node('p','請立即複製並安全保存兌換碼；伺服器只保留雜湊，無法再次顯示。'),node('output',code),button('複製兌換碼',async()=>{try{await navigator.clipboard.writeText(code);}catch{status('無法自動複製，請手動選取兌換碼。',true);}}),button('已保存，關閉',()=>{dialog.close();dialog.replaceChildren();}));dialog.showModal();
}
async function save(statusOverride){
    if(busy||!$('editorForm').reportValidity())return;busy=true;$('editorError').textContent='';document.querySelectorAll('#editor button').forEach(b=>b.disabled=true);
    try{
        const payload=editorPayload(statusOverride);if(!payload.rewards?.length&&view==='gifts')throw Error('請至少新增一項獎勵');
        const response=await runtime.api(view==='gifts'?'saveGift':'saveAnnouncement',payload,writeId);
        $('editor').close();await load();status(response.codeUnavailable?'資料已建立。此請求為重試，兌換碼無法重取；若未保存，請停用後建立新禮包。':'設定已儲存');if(response.code)showCode(response.code);
    }catch(error){$('editorError').textContent=errorText(error);}
    finally{busy=false;document.querySelectorAll('#editor button').forEach(b=>b.disabled=false);}
}
async function changeStatus(record,statusValue){
    if(busy||!confirm(`確定將「${record.title||record.name}」設為${statusNames[statusValue]}？`))return;
    busy=true;try{const payload={...record,status:statusValue};if(statusValue==='published')payload.startAt=Date.now();await runtime.api(view==='gifts'?'saveGift':'saveAnnouncement',payload,crypto.randomUUID());await load();status('狀態已更新');}catch(error){status(errorText(error),true);}finally{busy=false;}
}
$('navigation').onclick=event=>{const target=event.target.closest('[data-view]');if(target&&!busy)selectView(target.dataset.view);};
$('filters').onsubmit=event=>{event.preventDefault();pages=[null];page=0;load();};$('resetFilters').onclick=()=>{$('filters').reset();pages=[null];page=0;load();};
$('previousPage').onclick=()=>{if(page>0){page--;load();}};$('nextPage').onclick=()=>{if(nextCursor){pages[++page]=nextCursor;load();}};
$('createButton').onclick=()=>openEditor();$('closeEditor').onclick=()=>{if(!busy)$('editor').close();};$('closePreview').onclick=()=>$('preview').close();$('previewButton').onclick=()=>previewAnnouncement(editorPayload());
$('editorForm').onsubmit=event=>{event.preventDefault();save();};$('saveDraft').onclick=()=>save('draft');$('editor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('menuButton').onclick=()=>{const open=document.body.classList.toggle('menu-open');$('menuButton').setAttribute('aria-expanded',String(open));};
$('logout').onclick=async()=>{try{await runtime.logout();location.replace('login.html'+location.search);}catch(error){status(errorText(error),true);}};
runtime.observe(async user=>{
    if(!user){location.replace('login.html'+location.search);return;}
    try{const identity=await runtime.identity(user);if(!identity.admin){await runtime.logout();location.replace('login.html'+location.search);return;}$('adminEmail').textContent=identity.email||identity.uid;$('app').hidden=false;$('loading').hidden=true;await selectView('dashboard');}
    catch(error){$('loading').textContent=errorText(error);}
});

$('manageMfa').onclick=()=>{const url=new URL('login.html'+location.search,location.href);url.searchParams.set('setupMfa','1');location.assign(url.href);};
