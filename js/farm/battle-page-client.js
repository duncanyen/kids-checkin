/** 每次實際頁面載入使用新 ID；不放進 local/sessionStorage，以免重開後延續舊戰鬥。 */
export function createBattlePage({ request, storage, events, resume = () => {}, uuid = () => crypto.randomUUID() }) {
    const id = uuid(), openId = uuid();
    let ready, supported = false, closed = false;
    // 舊的純戰鬥請求不跨頁重播；已提交的收蛋／偷蛋仍保留原收據確認機制。
    for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (!key?.startsWith('nexus.farm.pending:')) continue;
        try {
            const [, , action, payload] = JSON.parse(key.slice('nexus.farm.pending:'.length));
            if (['battleAttack','battleSettle','claimEncounter'].includes(action) || action === 'homeEncounter' && !payload.collectWhenClear || action === 'visitEncounter' && !payload.stealWhenClear) storage.removeItem(key);
        } catch {} // 不動其他模組或格式未知的資料。
    }
    const error = () => Object.assign(Error('遊戲頁面已離開，請重新載入'), { code: 'ops/battle-page-closed' });
    async function open() {
        if (!ready) ready = request('beginBattlePage', { battlePageId: id, combatProtocol:2, damageProtocol:4, refinementDamageProtocol:5, inputProtocol:1 }, openId).then(response => {
            supported = response.result?.protocolVersion === 1 && response.result.battlePageId === id;
            if (!supported) throw Object.assign(Error('後端戰鬥頁面協定不符，請重新載入'),{code:'ops/update-required'});
        }).catch(failure => {
            // 發布先後相容：僅舊後端明確不認識新 action 時維持舊行為；其他錯誤不得放行。
            if (failure.code === 'functions/invalid-argument' && /^選項無效(?: \[400\])?$/.test(failure.message || '')) return;
            ready = null; throw failure;
        });
        return ready;
    }
    function close() {
        if (closed) return;
        closed = true;
        // Mobile 強制關閉可能不送出此請求；新頁面的 beginBattlePage 會可靠作廢舊會話。
        if (supported) void request('abandonBattlePage', { battlePageId: id }, uuid()).catch(() => {});
    }
    const pageshow = event => { if (event.persisted && closed) resume(); };
    events.addEventListener('pagehide', close);
    events.addEventListener('pageshow', pageshow);
    return {
        async execute(action, payload, requestId) {
            if (closed) throw error();
            await open();
            if (closed) throw error();
            return request(action, supported ? { ...payload, battlePageId: id } : payload, requestId);
        },
        close,
        get closed() { return closed; }
    };
}
