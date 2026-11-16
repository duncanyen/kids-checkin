/* 先於 ES module 安裝，讓 iPhone 在模組載入／初始化失敗時也能顯示診斷。 */
(function () {
    'use strict';
    if (window.farmStartupDiagnostics) return;
    var active = true, stage = 'page', count = 0, messages = [], seen = [], signatures = [];

    function clean(value, limit) {
        var text = String(value == null ? '' : value);
        // 只顯示公開錯誤欄位；網址不保留 query/hash，避免憑證被帶進截圖。
        text = text.replace(/https?:\/\/[^\s<>"')]+/g, function (url) {
            return url.split(/[?#]/)[0];
        });
        text = text.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已隱藏]');
        text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[已隱藏]');
        text = text.replace(/(["']?(?:password|pin|secret|token|authorization|api[_-]?key|credential|access_token|refresh_token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[已隱藏]');
        return text.slice(0, limit);
    }
    function render() {
        var parent = document.querySelector('.farm-loading-card') || document.body;
        if (!parent) return;
        var details = document.getElementById('farm-startup-error-details');
        if (!details) {
            details = document.createElement('details');
            details.id = 'farm-startup-error-details';
            details.open = true;
            details.style.cssText = 'margin-top:12px;text-align:left;font-size:12px;';
            var title = document.createElement('summary');
            title.textContent = '載入錯誤詳細資訊（可截圖）';
            var text = document.createElement('pre');
            text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:28vh;overflow:auto;user-select:text;';
            details.appendChild(title); details.appendChild(text); parent.appendChild(details);
        }
        details.querySelector('pre').textContent = messages.join('\n\n');
    }
    function report(error, context) {
        if (!active || count >= 3) return;
        context = context || {};
        error = error || {};
        if (typeof error === 'object' && seen.indexOf(error) !== -1) return;
        var message = typeof error === 'string' ? error : error.message || context.message || '未知載入錯誤';
        var file = context.file || error.fileName || error.filename;
        var line = context.line || error.lineNumber || error.lineno;
        var column = context.column || error.columnNumber || error.colno;
        var text = '咕咕村落載入錯誤\n' +
            '階段：' + clean(context.stage || stage, 80) + '\n' +
            '類型：' + clean(error.name || 'Error', 80) + '\n' +
            (error.code ? '代碼：' + clean(error.code, 100) + '\n' : '') +
            '訊息：' + clean(message, 600) +
            (file ? '\n檔案：' + clean(file, 220) : '') +
            (line ? '\n位置：' + clean(line, 12) + ':' + clean(column || 0, 12) : '') +
            (error.stack ? '\n堆疊：\n' + clean(error.stack, 1000) : '');
        if (signatures.indexOf(text) !== -1) return;
        if (typeof error === 'object') seen.push(error);
        signatures.push(text); count++; messages.push(text); render();
        // 先讓既有錯誤畫面更新，再彈出原生 alert；不吞掉原始錯誤事件。
        window.setTimeout(function () { try { window.alert(text); } catch (_) {} }, 0);
    }
    function onError(event) {
        if (event.target && event.target !== window) {
            if (event.target.tagName === 'SCRIPT') report({ message: '程式資源載入失敗' }, { file: event.target.src });
            return;
        }
        report(event.error || { message: event.message }, { file: event.filename, line: event.lineno, column: event.colno });
    }
    function onRejection(event) { report(event.reason, { stage: stage + '/unhandledrejection' }); }
    function finish() {
        active = false;
        messages = [];
        var details = document.querySelector('#farm-startup-error-details');
        if (details) details.remove();
        window.removeEventListener('error', onError, true);
        window.removeEventListener('unhandledrejection', onRejection);
    }
    window.farmStartupDiagnostics = { report: report, stage: function (value) { stage = value; }, finish: finish };
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('DOMContentLoaded', function () { if (messages.length) render(); }, { once: true });
}());
