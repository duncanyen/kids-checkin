import {createFarmReportUI} from './report.js?v=20261114-report';
// 管理工作區沿用已驗證的 API 及共用表格／表單樣式。
/**
 * 掛載管理頁與跨群組營運報表，沿用共用表格與表單元件，所有資料經受保護的 API。
 * @param {Object} options - root、api、DOM／時間工具、status 及目前管理員 UID。
 * @returns {Object} has、isBusy、open、deactivate 的頁面生命週期介面。
 * @description 操作識別碼按管理員與內容雜湊保存至 sessionStorage，確認成功才移除。
 */
export function createManagementUI({root,api,node,button,table,formatTime,wallTime,utc,status,getAdminUid}){
    const views=['players','balance','events','settings','reports'];
    const report=createFarmReportUI({root,api,node,button,table,formatTime,status});
    const names={draft:'草稿',scheduled:'排程',active:'進行中',ended:'已結束',cancelled:'已取消'};
    const dialog=node('dialog');dialog.id='managementEditor';document.body.append(dialog);
    let view=null,version=0,busy=false,data,pages=[null],page=0,next=null,search='',filter='';
    function section(title,help){const card=node('section',undefined,'card management-card');card.append(node('h2',title));if(help)card.append(node('p',help,'muted'));root.append(card);return card;}
    function input(form,key,label,type,value,required=true,options){
        const wrap=node('label',label),control=node(type==='textarea'?'textarea':type==='select'?'select':'input');control.name=key;control.required=required;control.setAttribute('aria-label',label);
        if(type!=='textarea'&&type!=='select')control.type=type;
        if(options)for(const [value,label]of Object.entries(options)){const option=node('option',label);option.value=value;control.append(option);}
        if(type==='checkbox')control.checked=!!value;else control.value=value??'';
        if(type==='datetime-local')control.step='60';wrap.append(control);form.append(wrap);return control;
    }
    const values=form=>Object.fromEntries(new FormData(form));
    async function write(action,payload){
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,payload})));
        const key=`nexus.ops.management:${getAdminUid()}:${[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')}`;
        const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
        const result=await api(action,payload,requestId);sessionStorage.removeItem(key);return result;
    }
    function edit(title,build,submit,confirmation){
        dialog.replaceChildren();
        const header=node('header',undefined,'dialog-header');header.append(node('h2',title),button('關閉',()=>{if(!busy)dialog.close();}));
        const form=node('form'),fields=node('div',undefined,'editor-fields'),error=node('p');error.setAttribute('role','alert');
        form.append(fields,error);dialog.append(header,form);build(fields);
        const footer=node('footer',undefined,'dialog-footer');const save=button('確認儲存',()=>{},'primary');save.type='submit';footer.append(button('取消',()=>{if(!busy)dialog.close();}),save);form.append(footer);
        form.onsubmit=async event=>{
            event.preventDefault();if(busy||!form.reportValidity())return;
            const payload=submit(values(form),form);
            if(!confirm(typeof confirmation==='function'?confirmation(payload):confirmation||'確認套用這項設定？'))return;
            busy=true;error.textContent='';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
            try{await write(payload.action,payload.value);dialog.close();await load();status('設定已儲存，操作紀錄已保留');}
            catch(failure){error.textContent=failure.message||'儲存失敗，請稍後重試';}
            finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
        };
        dialog.showModal();
    }
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    function pagination(card){
        const bar=node('div',undefined,'pagination'),previous=button('上一頁',()=>{page--;load();}),following=button('下一頁',()=>{pages[++page]=next;load();});
        previous.disabled=page===0;following.disabled=!next;bar.append(previous,node('span',`第 ${page+1} 頁`),following);card.append(bar);
    }
    function searchBar(card,label,placeholder,options){
        const form=node('form',undefined,'filters');const field=input(form,'search',label,'search',search,false);field.placeholder=placeholder;
        if(options)input(form,'status','設定狀態','select',filter,false,options);
        const submit=button('查詢',()=>{},'primary');submit.type='submit';form.append(submit,button('重新讀取',()=>load()));
        form.onsubmit=event=>{event.preventDefault();const v=values(form);search=v.search.trim();filter=v.status||'';pages=[null];page=0;load();};card.append(form);
    }
    async function detail(uid){
        status('正在讀取玩家與農場…');
        try{
            const p=await api('playerDetail',{uid});status('');
            edit(`${p.name} · ${p.accountId}`,fields=>{
                const help=node('p','限制僅作用於公告、禮包與租犬 API；不會修改 Nexus 登入、使用者角色或既有農場。','full muted');fields.append(help);
                input(fields,'blocked','營運功能','select',String(p.control.blocked),true,{false:'正常使用',true:'限制營運功能'});
                const notes=input(fields,'notes','管理備註','textarea',p.control.notes,false);notes.maxLength=1000;
                input(fields,'reason','本次操作原因','textarea','');
                const farms=node('div',undefined,'full table-wrap');farms.append(node('h3','目前農場'));
                farms.append(table(['村落','金幣','雞隻','雞舍','操作'],p.farms.map(f=>{
                    const adjust=button('調整金幣',()=>{dialog.close();adjustCoins(p,f);});adjust.disabled=!f.hasFarm||f.coins===null;
                    return[f.groupName,f.hasFarm?(f.coins??'數值需檢查'):'尚無農場',f.hens??'—',f.coopLevel??'—',adjust];
                })));if(p.moreGroups)farms.append(node('p','僅列出前 20 個村落，其他村落未載入。','muted'));fields.append(farms);
            },v=>({action:'savePlayerControl',value:{uid:p.uid,blocked:v.blocked==='true',notes:v.notes,reason:v.reason,expectedRevision:p.control.revision}}),'確認更新這位玩家的營運功能與備註？');
        }catch(error){status(error.message||'玩家讀取失敗',true);}
    }
    function adjustCoins(p,f){
        edit(`調整金幣 · ${p.accountId}`,fields=>{
            fields.append(node('p',`${f.groupName} · 目前 ${f.coins.toLocaleString()} 金幣。若餘額已變動，後端會拒絕並要求重新確認。`,'full muted'));
            const delta=input(fields,'delta','增減金幣（減少請填負數）','number','');delta.min='-1000000';delta.max='1000000';delta.step='1';
            input(fields,'reason','調整原因','textarea','');
        },v=>({action:'adjustPlayerCoins',value:{uid:p.uid,groupId:f.groupId,expectedCoins:f.coins,delta:Number(v.delta),reason:v.reason}}),payload=>`確認將 ${p.accountId} 在「${f.groupName}」的金幣調整 ${payload.value.delta>=0?'+':''}${payload.value.delta}？`);
    }
    function players(){
        const card=section('玩家查詢','使用 accountId 對應最新名稱。此頁不顯示密碼、PIN 或登入憑證。');
        searchBar(card,'帳號（完整 accountId）','留白顯示所有可識別帳號');
        const wrap=node('div',undefined,'table-wrap');wrap.append(table(['帳號','目前名稱','平台角色','營運功能','操作'],data.rows.map(p=>[p.accountId,p.name,p.role,p.control.blocked?'已限制':'正常',button('查看／管理',()=>detail(p.uid))])));card.append(wrap);pagination(card);
    }
    function editGuard(id,breed){
        edit(`護衛犬設定 · ${breed.name}`,fields=>{
            fields.append(node('p','日租、週租與開放狀態會由租用 API 驗證；既有已付款租約保持原內容。','full muted'));
            const day=input(fields,'dayPrice','每日租金','number',breed.dayPrice);day.min='1';day.max='1000000';day.step='1';
            const week=input(fields,'weekPrice','每週租金','number',breed.weekPrice);week.min='1';week.max='7000000';week.step='1';
            input(fields,'rentable','商品狀態','select',String(breed.configuredRentable),true,{true:'開放新租用',false:'展示、尚未開放'});
            input(fields,'reason','調整原因','textarea','');
        },v=>({action:'saveGuardConfig',value:{breedId:id,dayPrice:Number(v.dayPrice),weekPrice:Number(v.weekPrice),rentable:v.rentable==='true',reason:v.reason,expectedRevision:data.guardDogs.revision}}),'確認更新租犬商品？新價格將在玩家下次讀取商品或確認交易時生效。');
    }
    function balance(){
        let card=section('護衛犬 · 可即時調整','這些設定已接到新版村落商店與後端租用交易。全域暫停租用時，個別商品仍保留自己的開放設定。');
        let wrap=node('div',undefined,'table-wrap');wrap.append(table(['犬種','日租','週租','攔截率','目前狀態','操作'],Object.entries(data.guardDogs.breeds).map(([id,b])=>[b.name,b.dayPrice,b.weekPrice,`${Math.round(b.biteChance*100)}%`,b.availability==='paused'?'租用服務暫停':b.rentable?'可租用':'尚未開放',button('編輯',()=>editGuard(id,b))])));card.append(wrap,button('重新讀取數值',()=>load()));
        card=section('雞種 · 版本設定／唯讀','產蛋、買賣與戰鬥仍由既有遊戲版本決定；第一版不提供會與玩家端不一致的線上編輯。');
        wrap=node('div',undefined,'table-wrap');wrap.append(table(['雞種','購買','回售','產蛋間隔','每日產能','蛋售價','狀態'],Object.values(data.chickens).map(b=>[b.name,b.buy,b.sell,`${b.interval/3600000} 小時`,b.daily,b.eggPrice,b.purchasable===false?'展示':'開賣'])));card.append(wrap);
        card=section('武器與怪物 · 版本設定／唯讀');
        wrap=node('div',undefined,'table-wrap');wrap.append(table(['武器','購買','回售','基礎傷害'],Object.values(data.weapons).map(w=>[w.name,w.buyPrice??'不可購買',w.sellPrice??'不可回售',w.damage])));card.append(wrap);
        const details=node('details'),summary=node('summary','查看怪物生命值與參考攻擊次數');details.append(summary);
        const enemies={wolf:'野狼',tiger:'老虎',dragon:'暴龍',gorilla:'巨猩',eagle:'巨鷹',cobra:'眼鏡蛇王',mole:'地鼠',giant:'遠古巨人'};
        details.append(table(['怪物','生命值'],Object.entries(data.enemyHealth).map(([id,hp])=>[enemies[id]||id,hp])));
        const matrix=node('div',undefined,'table-wrap');matrix.append(table(['武器',...Object.keys(enemies).map(id=>enemies[id])],Object.entries(data.weapons).map(([id,w])=>[w.name,...Object.keys(enemies).map(enemy=>data.weaponHitCounts[id][enemy]??'無效')])));details.append(node('p','攻擊次數依版本傷害換算，不含操作速度與戰鬥時限。','muted'),matrix);card.append(details);
    }
    function eventEditor(event){
        const stamp=Date.now();
        edit(event?'編輯活動':'建立活動',fields=>{
            fields.append(node('p','第一版會連動活動公告與活動碼；不會自動啟動限定怪物、重置排行榜或發放獎勵。若刊登兌換碼，請先在禮包管理建立對應禮包。','full muted'));
            input(fields,'title','活動名稱','text',event?.title||'');
            input(fields,'type','分類','select',event?.type||'community',true,{community:'社群活動',seasonal:'季節活動',competition:'競賽公告'});
            input(fields,'status','發布狀態','select',event?.status||'draft',true,{draft:'草稿',scheduled:'排程',active:'立即發布',ended:'結束',cancelled:'取消'});
            const priority=input(fields,'priority','公告優先順序','number',event?.priority??0);priority.min='0';priority.max='100';
            input(fields,'startAt','開始時間（台灣）','datetime-local',wallTime(event?.startAt||stamp));
            input(fields,'endAt','結束時間（台灣）','datetime-local',wallTime(event?.endAt||stamp+7*86400000));
            input(fields,'targetType','對象','select',event?.targetType||'all',true,{all:'所有帳號',accounts:'指定帳號'});
            input(fields,'targetAccountIds','指定 accountId（逗號或換行分隔）','textarea',event?.targetAccountIds?.join('\n')||'',false);
            input(fields,'activityCode','活動碼（選填）','text',event?.activityCode||'',false);
            input(fields,'showPopup','自動彈出活動公告','checkbox',event?.showPopup,false);
            input(fields,'description','活動內容（純文字）','textarea',event?.description||'');
            input(fields,'reason','操作原因','textarea','');
        },(v,form)=>({action:'saveEvent',value:{...v,...(event?{id:event.id}:{}),priority:Number(v.priority),startAt:utc(v.startAt),endAt:utc(v.endAt),targetAccountIds:v.targetAccountIds.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean),showPopup:form.elements.showPopup.checked,expectedRevision:event?.revision||0}}),'確認儲存活動？活動與連動公告將一起更新。');
    }
    function events(){
        const card=section('活動管理','活動與對應公告以同一筆交易儲存。排程會依伺服器時間生效，到期不再提供玩家讀取。');
        const tools=node('div',undefined,'management-toolbar');tools.append(button('新增活動',()=>eventEditor(), 'primary'));card.append(tools);
        searchBar(card,'活動名稱前綴','輸入活動名稱開頭',{'':'全部設定狀態',...names});
        const wrap=node('div',undefined,'table-wrap');wrap.append(table(['名稱','設定狀態','目前狀態','台灣時間','對象','操作'],data.rows.map(e=>[e.title,names[e.status],names[e.effectiveStatus],`${formatTime(e.startAt)} ～ ${formatTime(e.endAt)}`,e.targetType==='all'?'所有帳號':e.targetAccountIds.join('、'),button('查看／編輯',()=>eventEditor(e))])));card.append(wrap);pagination(card);
    }
    function settings(){
        const card=section('營運服務設定','開關只作用於新版營運 API，不是 Nexus 登入或整個遊戲的維護開關。暫停新租犬不會中斷已付款的護衛。');
        const form=node('form'),fields=node('div',undefined,'editor-fields');form.append(fields);
        for(const [key,label]of [['announcementsEnabled','提供營運公告與營運系統通知'],['redemptionEnabled','開放禮包兌換'],['guardDogRentalsEnabled','開放新租犬交易']])input(fields,key,label,'select',String(data.values[key]),true,{true:'啟用',false:'暫停'});
        input(fields,'pauseMessage','暫停時對玩家顯示的訊息','textarea',data.values.pauseMessage);
        input(fields,'reason','本次變更原因','textarea','');
        const save=button('儲存系統設定',()=>{},'primary');save.type='submit';form.append(save);card.append(form,node('p',data.revision===0?'尚未自訂，使用後端預設設定。':`更新時間：${formatTime(data.updatedAt)} · 版本 ${data.revision}`,'muted'));
        form.onsubmit=async event=>{
            event.preventDefault();if(busy||!form.reportValidity()||!confirm('確認更新營運服務開關？暫停項目會由伺服器拒絕新請求。'))return;
            const v=values(form),payload={pauseMessage:v.pauseMessage,reason:v.reason,expectedRevision:data.revision};
            for(const k of ['announcementsEnabled','redemptionEnabled','guardDogRentalsEnabled'])payload[k]=v[k]==='true';
            busy=true;save.disabled=true;
            try{await write('saveSettings',payload);await load();status('系統設定已儲存');}catch(e){status(e.message||'儲存失敗',true);}finally{busy=false;save.disabled=false;}
        };
    }
    async function load(){
        const token=++version,selected=view;status('正在讀取管理資料…');
        try{
            const action={players:'listPlayers',balance:'gameBalance',events:'listEvents',settings:'getSettings'}[selected];
            const payload=selected==='players'?{accountId:search,cursor:pages[page]}:selected==='events'?{search,status:filter,cursor:pages[page]}:{};
            const result=await api(action,payload);if(token!==version||view!==selected)return;
            data=result;next=result.nextCursor||null;root.replaceChildren();({players,balance,events,settings})[selected]();status('');
        }catch(e){if(token===version){root.replaceChildren(node('p',e.message||'管理資料讀取失敗','empty'),button('重試',()=>load()));status(e.message||'讀取失敗',true);}}
    }
    return{has:key=>views.includes(key),isBusy:()=>busy||report.isBusy(),open:async key=>{report.deactivate();view=key;if(key==='reports'){version++;return report.open();}search='';filter='';pages=[null];page=0;return load();},deactivate:()=>{report.deactivate();view=null;version++;if(dialog.open&&!busy)dialog.close();}};
}
