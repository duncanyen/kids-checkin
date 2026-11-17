/**
 * 咕咕村落漸進入口：引擎下載與成員確認平行，之後才匯入遊戲主模組。
 * 公開素材可先載入；私人農場訂閱由 BootScene 等待 membershipReady 後建立。
 * @module
 */
import { farmLoading } from './loading-ui.js';
farmLoading.begin();
// A rejected module graph stays rejected in this document (including failed dependencies).
// Use one fresh document, rather than importing main repeatedly or creating another Phaser game.
const retryParameter = '_farm_module_retry';
const retryStorageKey = 'nexus:farm-module-retry';
const retryWindowMs = 120000;
const startupURL = new URL(window.location.href);
const retryStamp = Number(startupURL.searchParams.get(retryParameter));
function isModuleDownloadFailure(error) {
    return error?.name === 'TypeError' && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message || '');
}
function recoverModuleDownload(error) {
    if (stage !== 'game-module' || !isModuleDownloadFailure(error)) return false;
    const now = Date.now();
    // The URL guard also works when Safari disallows sessionStorage.
    if (retryStamp > 0 && now - retryStamp < retryWindowMs) return false;
    try {
        const previous = Number(sessionStorage.getItem(retryStorageKey));
        if (previous > 0 && now - previous < retryWindowMs) return false;
        sessionStorage.setItem(retryStorageKey, String(now));
    } catch (_) { /* URL is the fallback guard. */ }
    const target = new URL(window.location.href);
    target.searchParams.set(retryParameter, String(now));
    farmLoading.progress(5, '遊戲程式下載中斷，正在重新連線…');
    console.warn('farm-startup-recovery', JSON.stringify({ stage, attempt: 1, reason: 'module-download' }));
    window.location.replace(target.href);
    return true;
}
function clearRetryURL() {
    if (!startupURL.searchParams.has(retryParameter)) return;
    const target = new URL(window.location.href);
    target.searchParams.delete(retryParameter);
    try { window.history.replaceState(window.history.state, '', target.href); } catch (_) {}
}

// 引擎與帳號常數平行下載；常數 export 初始化後才載入主模組，Boot 另等 membershipReady 才開放私人場景。
const contextModule = import('./constants.js');
contextModule.catch(error => farmLoading.error('無法確認群組，請返回重試。', undefined, { error, stage: 'membership-module' }));
let stage = 'engine';
window.farmStartupDiagnostics?.stage(stage);
const engine = window.Phaser ? Promise.resolve() : new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js';
    const timeout = setTimeout(() => { script.remove(); reject(Error('engine timeout')); }, 30000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(Error('engine failed')); };
    document.head.append(script);
});
engine.then(async () => {
    // 不等待 membershipReady 的查詢結果，只等帳號／常數 export 初始化；避免平行 dynamic import 的載入競態。
    stage = 'game-context'; window.farmStartupDiagnostics?.stage(stage);
    await contextModule;
    stage = 'game-module'; window.farmStartupDiagnostics?.stage(stage);
    farmLoading.progress(5, '載入遊戲程式');
    // Fresh root URL on recovery avoids reusing a cached failed response. A fresh document
    // also resets the module map for transitive dependencies; no cache busting in normal play.
    const mainURL = new URL('./main.js', import.meta.url);
    if (retryStamp > 0) mainURL.searchParams.set(retryParameter, String(retryStamp));
    await import(mainURL.href);
    clearRetryURL();
})
    .catch(error => {
        if (recoverModuleDownload(error)) return;
        // 動態匯入的例外也會到這裡；保留原因，避免把程式初始化錯誤誤判成斷線。
        console.error('farm-startup-failure', JSON.stringify({
            stage,
            name: error?.name || 'Error',
            code: error?.code || null,
            message: error?.message || 'Unknown startup error'
        }));
        const failedDownload = error instanceof TypeError && /fetch|import|load|network/i.test(error.message || '');
        farmLoading.error(stage === 'engine' ? '遊戲引擎載入失敗，請檢查連線後重試。' :
            failedDownload ? '遊戲程式載入失敗，部分程式未能下載，請重新載入。' :
            '遊戲程式載入失敗，初始化發生錯誤，請重新載入；若持續發生，請截圖錯誤視窗或下方詳細資訊。', undefined, { error, stage });
    });
