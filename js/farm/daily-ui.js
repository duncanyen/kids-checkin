import { createGameOperationsClient } from './operations-client.js';
import { prepareDailyAssets } from './daily-assets-cache.js';
import { readDailyPreview, writeDailyPreview, removeDailyPreview } from './daily-preview-cache.js';
import { hasFarmHudEncounter } from './hud-ui.js';
const ASSETS='assets/farm/daily-missions/v2/';
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const art=(file,className='')=>{const n=el('img',className);n.src=ASSETS+file;n.alt='';n.draggable=false;n.decoding='async';return n;};
const number=n=>Number(n).toLocaleString('zh-TW');

/** DOM 面板不重建 Phaser 場景；只在開啟時鎖住當前輸入，關閉／戰鬥／destroy 均復原。 */
export function mountFarmDaily(game,context,{client=createGameOperationsClient(context)}={}) {
    const root=el('div','farm-daily-overlay');root.hidden=true;
    const panel=el('section','farm-daily-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','farmDailyTitle');
    const header=el('header','farm-daily-header'),title=el('h2','farm-daily-title','每日任務');title.id='farmDailyTitle';
    const closeButton=el('button','farm-daily-close');closeButton.type='button';closeButton.setAttribute('aria-label','關閉每日任務');closeButton.append(art('close.png'));header.append(title,closeButton);
    const tabs=el('div','farm-daily-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','每日挑戰分頁');
    const tabButtons={};
    for(const [key,label]of [['checkin','每日簽到'],['mission','每日任務']]){
        const b=el('button','farm-daily-tab',label);b.type='button';b.id='farmDailyTab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','farmDailyBody');
        b.addEventListener('click',()=>{selected=key;sessionStorage.setItem(tabKey,key);render();});
        b.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();tabButtons[key==='checkin'?'mission':'checkin'].click();tabButtons[selected].focus();}});
        tabs.append(b);tabButtons[key]=b;
    }
    const body=el('div','farm-daily-body');body.id='farmDailyBody';body.setAttribute('role','tabpanel');
    const date=el('p','farm-daily-date'),description=el('p','farm-daily-description');
    const cards=el('div','farm-daily-cards'),taskDay=el('h3','farm-daily-task-day'),missions=el('section','farm-daily-missions');missions.setAttribute('aria-label','今日任務');
    const notice=el('p','farm-daily-notice');notice.setAttribute('role','status');
    const status=el('p','farm-daily-status');status.setAttribute('role','status');
    const retry=el('button','farm-daily-retry','重新載入');retry.type='button';
    const footer=el('footer','farm-daily-footer'),claim=el('button','farm-daily-claim','載入中');claim.type='button';claim.disabled=true;
    const hen=art('hen.png','farm-daily-hen'),reward=el('div','farm-daily-reward-panel'),rewardLabel=el('span','farm-daily-reward-label'),rewardAmount=el('strong','farm-daily-reward-amount');
    reward.append(rewardLabel,rewardAmount);
    body.append(date,description,cards,taskDay,missions,notice,retry);footer.append(hen,reward,claim,status);panel.append(header,tabs,body,footer);root.append(panel);document.querySelector('#game-container').append(root);
    const tabKey=`gugu.daily.tab:${context.accountId}`;
    let selected=sessionStorage.getItem(tabKey)==='mission'?'mission':'checkin';
    let state=readDailyPreview(context),busy=false,loading=false,disposed=false,generation=0,clockStart=performance.now(),refreshTimer,lastFocus;
    let confirmed=false,freshAt=0,pendingLoad=null,changed=0,renderedKey=null;
    let warmed=false,warmTimer,idleTask;
    const isFresh=()=>confirmed&&state&&performance.now()-freshAt<30000&&state.serverNow+performance.now()-clockStart<state.nextResetAt;
    const savePreview=()=>{if(state)writeDailyPreview(context,{...state,serverNow:state.serverNow+performance.now()-clockStart});};
    const locks=new Map();
    function lock(){for(const scene of game.scene.getScenes(true))if(scene.input&&!locks.has(scene.input)){locks.set(scene.input,scene.input.enabled);scene.input.enabled=false;}}
    function unlock(){for(const [input,enabled]of locks)input.enabled=enabled;locks.clear();}
    function canOpen(){return game.registry.get('farmLoadState')?.phase==='ready'&&game.scene.getScenes(true).some(s=>s.scene.key==='MyFarmScene')&&!game.scene.getScenes(true).some(hasFarmHudEncounter);}
    function close(){
        if(root.hidden)return;
        root.hidden=true;clearTimeout(refreshTimer);unlock();
        if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
    }
    function render(){
        for(const [key,button]of Object.entries(tabButtons)){
            button.setAttribute('aria-selected',String(selected===key));button.tabIndex=selected===key?0:-1;button.disabled=busy;
        }
        panel.dataset.tab=selected;
        body.setAttribute('aria-labelledby',tabButtons[selected].id);
        const challenge=state?.challenges?.[selected];
        date.textContent=state?`${state.dateKey} · 台灣時間每日 00:00 更新`:'正在確認伺服器日期…';
        description.textContent=selected==='checkin'?`連續簽到 ${challenge?.rewards.length||7} 天領取豐厚獎勵！`:`完成今日 ${challenge?.tasks.filter(task=>task.enabled).length??3} 項任務，即可領取獎勵！`;
        if(selected==='mission'&&challenge?.blocked)description.textContent='任務事件尚未接通，暫不計次與發獎';
        if(challenge&&!challenge.enabled)description.textContent='此挑戰目前已停用';
        taskDay.hidden=selected!=='mission';taskDay.textContent=challenge?`第 ${challenge.day} 天任務`:'';
        rewardLabel.textContent=selected==='checkin'?'今日簽到獎勵':'完成今日任務獎勵';
        rewardAmount.textContent=challenge?`${number(challenge.rewards[challenge.day-1])} 金幣`:'—';
        claim.disabled=busy||loading||!confirmed||!challenge?.canClaim;
        claim.textContent=busy?'正在確認領獎結果…':(loading||!confirmed)?(state?'確認今日狀態…':'載入中…'):challenge?.claimed?'今日已領取':selected==='checkin'?'立即簽到':'領取獎勵';
        retry.hidden=loading||(confirmed&&!!challenge);retry.disabled=busy;
        // Reopening, loading and button-state changes retain existing image nodes.
        const contentKey=JSON.stringify([selected,state?.dateKey,challenge]);
        if(contentKey===renderedKey)return;
        renderedKey=contentKey;
        cards.replaceChildren();missions.replaceChildren();notice.textContent='';
        if(!challenge)return;
        challenge.rewards.forEach((amount,index)=>{
            const day=index+1,today=day===challenge.day,done=day<challenge.day||(today&&challenge.claimed);
            const statusText=done?'已簽到／已領取':today?(challenge.canClaim?(selected==='checkin'?'今日可簽到':'今日可領取'):'今日進行中'):'尚未開放';
            if(selected==='mission'){
                const node=el('div','farm-daily-day-node');node.setAttribute('aria-label',`第 ${day} 天：${statusText}，${number(amount)} 金幣`);
                node.append(art(done?'node-completed.png':today?'node-current.png':'node-empty.png'));
                if(!done)node.append(el('span','',String(day)));
                if(today)node.setAttribute('aria-current','step');cards.append(node);return;
            }
            const card=el('article','farm-daily-card'+(day===7?' farm-daily-card--seventh':''));
            const file=day===7?'card-seventh.png':today?'card-today.png':'card-normal.png';
            card.style.setProperty('--daily-card-art',`url("${new URL(ASSETS+file,document.baseURI).href}")`);
            card.setAttribute('aria-label',`第 ${day} 天：${statusText}，${number(amount)} 金幣`);
            const label=el('h3','farm-daily-day',`第 ${day} 天`);card.append(label);
            card.append(art('coin.png','farm-daily-reward-icon'));
            card.append(el('strong','farm-daily-amount',number(amount)));
            card.append(el('span','farm-daily-card-state',statusText));
            card.append(art(done?'check.png':'status-empty.png','farm-daily-card-status-icon'));
            if(today)card.dataset.today='true';cards.append(card);
        });
        if(selected==='mission')cards.append(art('chest.png','farm-daily-final-chest'));
        if(selected==='mission'){
            for(const task of challenge.tasks){
                const row=el('article','farm-daily-mission');
                const icon=task.type==='COLLECT_EGG_ACTION'?'eggs.png':task.type==='HELP_CLEAN_OTHER'?'broom.png':'monster.png';
                row.append(art(icon,'farm-daily-task-icon'));
                const label=task.type==='HELP_CLEAN_OTHER'?'協助別人打掃':task.name;
                const info=el('div','farm-daily-task-info');info.append(el('strong','',`${label} ${task.target} 次`));
                const progress=el('div','farm-daily-progress');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label',task.name);progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax',task.target);progress.setAttribute('aria-valuenow',task.count);
                progress.append(art('track.png','farm-daily-progress-track'));
                const clip=el('span','farm-daily-progress-clip');clip.style.width='100%';clip.style.clipPath=`inset(0 ${100-Math.max(0,Math.min(100,task.count/task.target*100))}% 0 0)`;clip.append(art('fill.png','farm-daily-progress-fill'));progress.append(clip);info.append(progress);
                row.append(info,el('span','farm-daily-count',task.enabled?`${task.count}/${task.target}`:'停用'));
                row.append(art(task.enabled&&task.count>=task.target?'check.png':'task-empty.png','farm-daily-task-completed'));
                missions.append(row);
            }
            if(!challenge.tasks.some(task=>task.enabled))notice.textContent='目前沒有啟用的每日任務。';
            if(challenge.blocked)notice.textContent='三項遊戲事件尚未接上後端驗證，暫不計次、不可領取任務獎勵。';
        }
        if(!challenge.enabled)notice.textContent='此挑戰目前已停用。';
        else if(!notice.textContent)notice.textContent=challenge.missedDayPolicy==='reset'?'漏一天未領取，下一次從第 1 天重新開始。':'漏一天保留進度；第 7 天領取後，下次從第 1 天開始。';
    }
    function scheduleReset(){
        clearTimeout(refreshTimer);if(root.hidden||!state||disposed)return;
        const remaining=state.nextResetAt-state.serverNow-(performance.now()-clockStart);
        refreshTimer=setTimeout(()=>{if(remaining<=60000)void load();else scheduleReset();},Math.min(60000,Math.max(1000,remaining)));
    }
    function load(){
        if(disposed||busy)return Promise.resolve();
        if(pendingLoad)return pendingLoad;
        loading=true;const token=++generation,version=changed;
        if(!root.hidden)render();
        pendingLoad=(async()=>{
            try{
                const data=await client.dailyChallenges('status');
                if(disposed||token!==generation||version!==changed)return;
                state=data;clockStart=performance.now();freshAt=clockStart;confirmed=true;savePreview();status.textContent='';
            }catch(error){
                if(disposed||token!==generation)return;
                // Keep the read-only preview; a failed refresh must never enable claiming.
                confirmed=false;
                status.textContent=error.code==='functions/not-found'?'每日挑戰後端尚未部署，請稍後再試。':error.message||'每日挑戰讀取失敗，請重試。';
            }finally{
                if(token===generation){
                    loading=false;pendingLoad=null;
                    if(!root.hidden&&!disposed){
                        render();scheduleReset();
                        if(version!==changed)void load();
                    }
                }
            }
        })();
        return pendingLoad;
    }
    async function claimToday(){
        const challenge=state?.challenges?.[selected];if(busy||loading||!confirmed||!challenge?.canClaim)return;
        const type=selected,key=`gugu.daily.pending:${context.accountId}:${type}`;
        let pending;
        try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
        if(!pending||pending.dateKey!==state.dateKey||pending.cycleId!==challenge.cycleId||pending.day!==challenge.day){
            pending={type,dateKey:state.dateKey,cycleId:challenge.cycleId,day:challenge.day,requestId:crypto.randomUUID()};sessionStorage.setItem(key,JSON.stringify(pending));
        }
        busy=true;status.textContent='';render();
        try{
            const result=await client.dailyChallenges('claim',pending);
            sessionStorage.removeItem(key);
            // 正式餘額沿用 BootScene 的存檔監聽器；不在客戶端自行相加金幣。
            state.challenges[type]={...challenge,claimed:true,canClaim:false,grantId:result.transactionId};
            status.textContent=`${result.replayed?'已確認先前領取':'領取成功'}：${number(result.amount)} 金幣${result.groupId!==context.groupId?'（發至先前領取的群組農場）':''}。`;
            freshAt=performance.now();savePreview();
            game.events.emit('dailyChallengeClaimed',result);
        }catch(error){confirmed=false;removeDailyPreview(context);status.textContent=error.message||'領取結果未確認，請重新載入或重試，同一天不會重複發獎。';}
        finally{busy=false;if(!disposed){render();scheduleReset();}}
    }
    function open(){
        if(disposed||!root.hidden||!canOpen())return;
        lastFocus=document.activeElement;root.hidden=false;lock();closeButton.focus({preventScroll:true});
        if(!isFresh())confirmed=false;render();void prepareDailyAssets();
        if(!isFresh())void load();else scheduleReset();
    }
    function onKey(event){
        if(root.hidden)return;
        if(event.key==='Escape'){event.preventDefault();close();}
        if(event.key==='Tab'){
            const focusable=[...panel.querySelectorAll('button:not(:disabled)')].filter(n=>n.offsetParent!==null),first=focusable[0],last=focusable.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        }
    }
    function onStep(){
        if(!root.hidden&&!canOpen())close();
        if(!warmed&&canOpen()){
            warmed=true;
            warmTimer=setTimeout(()=>{
                const warm=()=>{if(disposed)return;void prepareDailyAssets();if(!isFresh())void load();};
                if('requestIdleCallback' in window)idleTask=requestIdleCallback(warm,{timeout:3000});else warm();
            },1200);
        }
    }
    function onVisible(){if(!root.hidden&&document.visibilityState==='visible'){confirmed=false;render();void load();}}
    function onChanged(){changed++;confirmed=false;freshAt=0;removeDailyPreview(context);if(!root.hidden){render();void load();}}
    closeButton.addEventListener('click',close);retry.addEventListener('click',()=>void load());claim.addEventListener('click',()=>void claimToday());
    root.addEventListener('click',event=>{if(event.target===root)close();});
    document.addEventListener('keydown',onKey);document.addEventListener('visibilitychange',onVisible);
    game.events.on('step',onStep);game.events.on('dailyChallengeChanged',onChanged);
    game.events.once('destroy',()=>{close();disposed=true;generation++;clearTimeout(refreshTimer);clearTimeout(warmTimer);if(idleTask&&'cancelIdleCallback' in window)cancelIdleCallback(idleTask);document.removeEventListener('keydown',onKey);document.removeEventListener('visibilitychange',onVisible);game.events.off('step',onStep);game.events.off('dailyChallengeChanged',onChanged);root.remove();});
    render();return{open,close};
}
