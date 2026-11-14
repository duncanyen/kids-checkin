/**
 * 咕咕村落漸進入口：引擎下載與成員確認平行，之後才匯入遊戲主模組。
 * 公開素材可先載入；私人農場訂閱由 BootScene 等待 membershipReady 後建立。
 * @module
 */
import { farmLoading } from './loading-ui.js';
farmLoading.begin();
// 下載引擎時同步確認成員；constants 不阻塞模組載入，Boot 等 membershipReady 才開放私人場景。
import('./constants.js').catch(() => farmLoading.error('無法確認群組，請返回重試。'));
const engine = window.Phaser ? Promise.resolve() : new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js';
    const timeout = setTimeout(() => { script.remove(); reject(Error('engine timeout')); }, 30000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(Error('engine failed')); };
    document.head.append(script);
});
engine.then(() => { farmLoading.progress(5, '準備農莊畫面'); return import('./main.js'); })
    .catch(error => {
        // 動態匯入的例外也會到這裡；保留原因，避免把程式初始化錯誤誤判成斷線。
        console.error('farm-startup-failure', JSON.stringify({
            name: error?.name || 'Error',
            code: error?.code || null,
            message: error?.message || 'Unknown startup error'
        }));
        farmLoading.error('遊戲程式載入失敗，請檢查連線後重試。');
    });
