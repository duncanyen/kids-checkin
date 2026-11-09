// 圖表共用載入中的 Promise 及固定版本 URL；載入失敗不應阻塞金額或導覽。
export const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js';
let pending;
/**
 * 按需載入固定版本 Chart.js；並行呼叫共用同一個載入中的 Promise。
 * @returns {Promise<Function>} window.Chart 建構式；逾時或失敗清除 pending 以供重試。
 * @description 圖表載入不得成為金額與導覽的必要前提。
 */
export function loadChart() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CHART_URL;
        script.async = true;
        script.crossOrigin = 'anonymous';
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            script.onload = script.onerror = null;
            if (error) {
                script.remove();
                pending = null;
                reject(error);
            } else resolve(window.Chart);
        };
        const timeout = setTimeout(() => finish(new Error('圖表載入逾時')), 15000);
        script.onload = () => finish(window.Chart ? null : new Error('圖表程式未就緒'));
        script.onerror = () => finish(new Error('無法載入圖表程式'));
        document.head.append(script);
    });
    return pending;
}
