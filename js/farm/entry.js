import { farmLoading } from './loading-ui.js';
farmLoading.begin();
// Start membership verification while fetching the engine. Constants no longer
// block module evaluation; Boot gates every private scene on membershipReady.
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
    .catch(() => farmLoading.error('遊戲程式載入失敗，請檢查連線後重試。'));
