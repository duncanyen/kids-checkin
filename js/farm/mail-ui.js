import { createGameOperationsClient, GAME_OPERATIONS_ENABLED } from './operations-client.js';
import { rewardLabel } from './operations-rewards.js';
import { db } from '../firebase-config.js';
import { createFarmMailStore, formatMailTime, WELCOME_ID } from './mail-store.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
const button = (label, action, className = 'farm-mail-button') => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
};

export function mountFarmMail(game, context) {
    const store = createFarmMailStore(db, context);
    const operations = createGameOperationsClient(context);
    let operationsRows=[],operationsCursor=null,operationsLoading=false,operationsTimer=null,popupChecked=false;
    const categories=['visitor','system','operations','redeem'];
    let ensured = false, initializing, unsubscribe, notices = [], category = 'visitor', detailId = null, busy = false;
    let inputEnabled, disposed = false, openVersion = 0;
    let starting, loaded = false;
    const reading = new Set(), selected = new Set();
    const launcher = button('', open, 'farm-mail-launcher');
    launcher.setAttribute('aria-label', '開啟通知');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = '<svg viewBox="0 0 48 36" aria-hidden="true"><rect x="2" y="2" width="44" height="32" rx="5"/><path d="M4 5L24 21L44 5M4 32L17 19M44 32L31 19"/></svg>';
    const badge = el('span', 'farm-mail-badge');
    badge.hidden = true; badge.setAttribute('aria-hidden', 'true');
    launcher.append(badge);
    launcher.hidden = true;
    const overlay = el('div', 'farm-mail-overlay');
    overlay.hidden = true;
    const panel = el('section', 'farm-mail-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'farm-mail-title');
    const header = el('header', 'farm-mail-header');
    const title = el('h2', '', '通知'); title.id = 'farm-mail-title';
    const closeButton = button('關閉', close);
    header.append(title, closeButton);
    const tabs = el('div', 'farm-mail-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabButtons = categories.map((type, i) => {
        const tab = button(['訪客','系統','公告','禮包兌換'][i], () => { category = type; detailId = null; selected.clear(); render(); if(type==='operations') loadOperations(); }, 'farm-mail-tab');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'farm-mail-content');
        tab.id = `farm-mail-tab-${type}`;
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next=(i+(event.key==='ArrowLeft'?-1:1)+categories.length)%categories.length;
            tabButtons[next].click(); tabButtons[next].focus();
        });
        tabs.append(tab);
        return tab;
    });
    const message = el('p', 'farm-mail-status'); message.setAttribute('role', 'status');
    const content = el('div', 'farm-mail-content'); content.id = 'farm-mail-content'; content.setAttribute('role', 'tabpanel');
    panel.append(header, tabs, message, content);
    overlay.append(panel);
    document.body.append(launcher, overlay);

    async function ensure() {
        if (ensured) return;
        if (!initializing) {
            initializing = store.ensureWelcome().then(() => { ensured = true; }).finally(() => { initializing = null; });
        }
        return initializing;
    }
    function farmReady() {
        if (disposed || !game.registry.get('myFarmData')) return;
        launcher.hidden = false;
        start().catch(() => { launcher.title = '通知準備失敗，點擊重試'; });
        if(GAME_OPERATIONS_ENABLED&&!operationsTimer){
            loadOperations(true);
            operationsTimer=setInterval(()=>loadOperations(true),60000);
        }
    }
    function updateBadge() {
        const unread = notices.filter(row => !row.readAt).length;
        badge.hidden = unread === 0;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        launcher.setAttribute('aria-label', unread ? `開啟通知，${unread} 則未讀` : '開啟通知');
    }
    async function start() {
        if (unsubscribe) return;
        if (!starting) starting = (async () => {
            await ensure();
            if (disposed || unsubscribe) return;
            unsubscribe = store.watch(rows => {
                if (disposed) return;
                notices = rows; loaded = true;
                updateBadge();
                if (!overlay.hidden) { if(['visitor','system'].includes(category))message.textContent = ''; if(category!=='redeem'||!busy)render(); }
            }, () => {
                unsubscribe = null; loaded = false;
                message.textContent = '通知載入失敗，請關閉後重試。';
            });
        })().finally(() => { starting = null; });
        return starting;
    }
    async function markRead(rows) {
        const ids = rows.filter(row => !row.readAt && !reading.has(row.id)).map(row => row.id);
        if (!ids.length) return;
        ids.forEach(id => reading.add(id));
        try {
            for (let offset = 0; offset < ids.length; offset += 100) {
                const batch = ids.slice(offset, offset + 100);
                const readAt = await store.markRead(batch);
                for (const notice of notices) if (batch.includes(notice.id)) notice.readAt ||= readAt;
            }
            updateBadge();
        } catch { if (!overlay.hidden) message.textContent = '已讀狀態儲存失敗，請稍後重試。'; }
        finally { ids.forEach(id => reading.delete(id)); }
    }
    function onSetData(_parent, key) { if (key === 'myFarmData') farmReady(); }
    game.registry.events.on('setdata', onSetData);
    game.registry.events.on('changedata-myFarmData', farmReady);
    farmReady();

    async function open() {
        if (!overlay.hidden || disposed) return;
        const version = ++openVersion;
        overlay.hidden = false;
        inputEnabled = game.input.enabled;
        game.input.enabled = false;
        closeButton.focus();
        message.textContent = '正在載入通知…';
        try {
            if(category==='operations'){await loadOperations();if(!disposed&&!overlay.hidden)render();return;}
            if(category==='redeem'){message.textContent='';render();return;}
            await start();
            if (overlay.hidden || disposed || version !== openVersion) return;
            if (loaded) {
                message.textContent = '';
                render();
            }
        } catch { if (version === openVersion && !disposed) message.textContent = '通知準備失敗，請確認連線與群組權限後重試。'; }
    }
    function close() {
        if (overlay.hidden || busy) return;
        openVersion++;
        overlay.hidden = true;
        game.input.enabled = inputEnabled;
        launcher.focus();
    }
    async function remove(notice) {
        if (busy) return;
        const warning = notice.reward && !notice.claimedAt ? '尚有未領取獎勵，刪除後無法領取，也不會重新寄送。確定刪除？' : '確定刪除這則通知？';
        if (!window.confirm(warning)) return;
        await action(async () => {
            await store.remove(notice.id);
            notices = notices.filter(row => row.id !== notice.id);
            updateBadge();
            detailId = null;
            message.textContent = '通知已刪除';
        });
    }
    async function removeSelected() {
        if (busy || !selected.size) return;
        const rows = notices.filter(row => selected.has(row.id) && row.type === category);
        const gift = rows.some(row => row.reward && !row.claimedAt);
        const warning = `確定刪除已選取的 ${rows.length} 則通知？` +
            (gift ? '\n包含未領取獎勵，刪除後無法領取，也不會重新寄送。' : '');
        if (!rows.length || !window.confirm(warning)) return;
        let deleted = 0;
        await action(async () => {
            try {
                for (let offset = 0; offset < rows.length; offset += 100) {
                    const ids = rows.slice(offset, offset + 100).map(row => row.id);
                    await store.removeBatch(ids);
                    deleted += ids.length;
                    ids.forEach(id => selected.delete(id));
                    notices = notices.filter(row => !ids.includes(row.id));
                    updateBadge();
                }
                message.textContent = `已刪除 ${deleted} 則通知`;
            } catch {
                throw new Error(`已刪除 ${deleted} 則通知，其餘刪除失敗，請稍後重試。`);
            }
        });
    }
    async function action(callback) {
        if (busy) return;
        busy = true; render();
        try { await callback(); }
        catch (error) { message.textContent = error.message || '操作失敗，請稍後重試。'; }
        finally { busy = false; render(); }
    }
    function render() {
        tabButtons.forEach((tab, i) => {
            const active = category === categories[i];
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            tab.disabled = busy;
        });
        content.setAttribute('aria-labelledby', `farm-mail-tab-${category}`);
        closeButton.disabled = busy;
        content.replaceChildren();
        if(category==='operations'){renderOperations();return;}
        if(category==='redeem'){renderRedeem();return;}
        const current = notices.find(row => row.id === detailId && row.type === 'system');
        if (current) {
            markRead([current]);
            const back = button('‹ 返回列表', () => { detailId = null; render(); }); back.disabled = busy;
            content.append(back, el('h3', '', current.title), el('time', 'farm-mail-time', formatMailTime(current.createdAt)), el('p', 'farm-mail-body', current.body || ''));
            if (current.reward) {
                const rewards = el('section', 'farm-mail-rewards');
                rewards.append(el('h4', '', '獎勵'), el('p', '', `金幣 × ${current.reward.coins || 0}`), el('p', '', `菜蟲 × ${current.reward.worms || 0}`), el('p', '', `蚯蚓 × ${current.reward.earthworms || 0}`));
                rewards.append(el('small', '', '獎勵不受倉庫容量限制；超出容量時，請先餵食或整理倉庫。'));
                const claim = button(current.claimedAt ? '已領取' : '領取', () => action(async () => {
                    const received = await store.claim(current.id);
                    current.claimedAt = current.claimedAt || Date.now();
                    message.textContent = received ? '獎勵已收入金幣與倉庫！' : '這份獎勵已經領取過了。';
                }), 'farm-mail-button farm-mail-claim');
                claim.disabled = busy || !!current.claimedAt || current.id !== WELCOME_ID;
                rewards.append(claim);
                content.append(rewards);
            }
            const del = button('刪除通知', () => remove(current), 'farm-mail-button farm-mail-delete'); del.disabled = busy;
            content.append(del);
            return;
        }
        detailId = null;
        const rows = notices.filter(row => row.type === category);
        for (const id of selected) if (!rows.some(row => row.id === id)) selected.delete(id);
        if (rows.length) {
            const toolbar = el('div', 'farm-mail-batch');
            const allSelected = rows.every(row => selected.has(row.id));
            const all = button(allSelected ? '取消全選' : '全選', () => {
                rows.forEach(row => allSelected ? selected.delete(row.id) : selected.add(row.id));
                render(); content.querySelector('.farm-mail-select-all')?.focus();
            }, 'farm-mail-button farm-mail-select-all');
            const del = button(`刪除已選 (${selected.size})`, removeSelected, 'farm-mail-button farm-mail-delete farm-mail-delete-selected');
            all.disabled = busy; del.disabled = busy || !selected.size;
            toolbar.append(all, del); content.append(toolbar);
        }
        if (!overlay.hidden && category === 'visitor') markRead(rows);
        if (!rows.length) content.append(el('p', 'farm-mail-empty', category === 'visitor' ? '目前沒有訪客來偷蛋的紀錄' : '目前沒有系統通知'));
        for (const notice of rows) {
            const row = el('article', 'farm-mail-row');
            const summary = el(category === 'system' ? 'button' : 'div', 'farm-mail-summary');
            if (category === 'system') {
                summary.type = 'button'; summary.disabled = busy;
                summary.addEventListener('click', () => { detailId = notice.id; render(); });
            }
            summary.append(el('strong', '', notice.title), el('time', 'farm-mail-time', formatMailTime(notice.createdAt)));
            if (category === 'visitor') summary.append(el('small', '', '訪客來偷蛋'));
            if (notice.reward && !notice.claimedAt) {
                const gift = el('span', 'farm-mail-gift', '可領獎勵'); gift.setAttribute('aria-label', '有獎勵可領取');
                summary.append(gift);
            }
            const del = button('刪除', () => remove(notice), 'farm-mail-button farm-mail-delete'); del.disabled = busy;
            const check = el('input', 'farm-mail-check');
            check.type = 'checkbox'; check.checked = selected.has(notice.id); check.disabled = busy;
            check.dataset.mailId = notice.id;
            check.setAttribute('aria-label', `選取${notice.title} ${formatMailTime(notice.createdAt)}`);
            check.addEventListener('change', () => {
                check.checked ? selected.add(notice.id) : selected.delete(notice.id);
                render(); content.querySelector(`[data-mail-id="${CSS.escape(notice.id)}"]`)?.focus();
            });
            row.append(check, summary, del); content.append(row);
        }
    }
    async function loadOperations(background=false,more=false){
        if(operationsLoading||disposed)return;
        operationsLoading=true;
        if(!background)message.textContent='正在載入公告…';
        try{
            const result=await operations.announcements(more?operationsCursor:null);
            if(disposed)return;
            operationsRows=more?[...operationsRows,...result.rows]:result.rows;operationsCursor=result.nextCursor;
            if(category==='operations'&&!overlay.hidden){message.textContent='';render();}
            if(background&&!popupChecked){
                popupChecked=true;
                const popup=operationsRows.find(a=>a.showPopup&&!localStorage.getItem(`nexus.ops.read:${context.accountId}:${a.id}:${a.updatedAt}`));
                if(popup&&overlay.hidden){category='operations';detailId=popup.id;await open();}
            }
        }catch(error){if(!disposed&&category==='operations'&&!overlay.hidden)message.textContent=error.message||'公告載入失敗，請重試';}
        finally{operationsLoading=false;}
    }
    function renderOperations(){
        if(!GAME_OPERATIONS_ENABLED){content.append(el('p','farm-mail-empty','公告服務尚未啟用。'));return;}
        const detail=operationsRows.find(a=>a.id===detailId);
        if(detail){
            localStorage.setItem(`nexus.ops.read:${context.accountId}:${detail.id}:${detail.updatedAt}`,'1');
            content.append(button('‹ 返回公告列表',()=>{detailId=null;render();}),el('h3','',detail.title),el('time','farm-mail-time',formatMailTime(detail.startAt)),el('p','farm-mail-body',detail.content));
        }else{
            if(!operationsRows.length)content.append(el('p','farm-mail-empty',operationsLoading?'正在載入公告…':'目前沒有有效公告'));
            for(const notice of operationsRows){
                const item=button('',()=>{detailId=notice.id;render();},'farm-mail-summary');
                item.append(el('strong','',notice.title),el('time','farm-mail-time',formatMailTime(notice.startAt)));content.append(item);
            }
            if(operationsCursor)content.append(button('載入更多公告',()=>loadOperations(false,true)));
        }
        content.append(button('重新整理公告',()=>loadOperations()));
    }
    function renderRedeem(){
        const form=el('form','farm-redeem-form'),label=el('label','','輸入禮包兌換碼'),input=el('input');
        input.type='text';input.name='giftCode';input.autocomplete='off';input.maxLength=160;input.required=true;input.setAttribute('aria-label','禮包兌換碼');
        const submit=button('兌換禮包',()=>{});submit.type='submit';submit.disabled=busy||!GAME_OPERATIONS_ENABLED;input.disabled=busy||!GAME_OPERATIONS_ENABLED;
        label.append(input);form.append(label,submit);content.append(form,el('p','farm-mail-empty',GAME_OPERATIONS_ENABLED?'兌換成功後獎勵會直接收入目前農場。請先確認雞舍與倉庫空間。':'禮包服務尚未啟用。'));
        form.onsubmit=async event=>{
            event.preventDefault();if(busy||!input.value.trim())return;
            const code=input.value;busy=true;submit.disabled=true;input.disabled=true;message.textContent='正在兌換，請勿重複操作…';
            try{const result=await operations.redeem(code);if(!disposed){message.textContent=`${result.replayed?'此請求已兌換成功，未重複發放。':'兌換成功！'} ${result.rewards.map(rewardLabel).join('、')}`;input.value='';}}
            catch(error){if(!disposed)message.textContent=error.message||'兌換失敗，請稍後使用同一組兌換碼重試';}
            finally{busy=false;if(!disposed){submit.disabled=false;input.disabled=false;closeButton.disabled=false;tabButtons.forEach(tab=>tab.disabled=false);if(category==='redeem'&&!form.isConnected)render();}}
        };
    }
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(node => node.tabIndex >= 0);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    game.events.once('destroy', () => {
        disposed = true;
        unsubscribe?.();
        clearInterval(operationsTimer);
        game.registry.events.off('setdata', onSetData);
        game.registry.events.off('changedata-myFarmData', farmReady);
        launcher.remove(); overlay.remove();
    });
}
