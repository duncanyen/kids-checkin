// 先綁定入口，再等待含 Auth／群組檢查的遊戲模組，避免提早點擊尚未建立的 window 函式。
const lobby = document.getElementById('gameLobby');
const status = document.getElementById('gameLobbyStatus');
let pending = false;
const showStatus = message => {
    status.textContent = message;
    status.hidden = false;
};
const ready = import('./games.js');
ready.catch(error => {
    console.error('game-lobby-startup-failure', JSON.stringify({
        name: error?.name || 'Error',
        code: error?.code || null,
        message: error?.message || 'Unknown startup error'
    }));
    showStatus('遊戲大廳載入失敗，請重新整理後再試。');
});

lobby.addEventListener('click', async event => {
    const card = event.target.closest('[data-game]');
    if (!card || !lobby.contains(card) || pending) return;
    pending = true;
    card.setAttribute('aria-busy', 'true');
    showStatus('確認遊戲權限中，請稍候…');
    try {
        const games = await ready;
        status.hidden = true;
        games.selectGame(card.dataset.game);
    } catch {
        showStatus('遊戲大廳載入失敗，請重新整理後再試。');
    } finally {
        pending = false;
        card.removeAttribute('aria-busy');
    }
});
