// Chart.js is needed only by the ledger charts. Keep one in-flight load and a
// versioned URL; an unavailable chart must never block amounts or navigation.
export const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js';
let pending;
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
