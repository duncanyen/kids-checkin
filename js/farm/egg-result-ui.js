import { createFarmDialog } from './farm-dialog.js';
import { eggResultView } from './egg-result.js';

const ASSETS = 'assets/farm/egg-result/v1/';
const files = ['panel', 'title', 'close', 'illustration', 'total_banner', 'section_title', 'row', 'storage_banner', 'confirm'];
const defaultAssets = Object.fromEntries(files.map(file => [file, ASSETS + 'egg_result_' + file + '.png']));
const prepared = new Map();
/** 預熱固定素材；只使用瀏覽器圖片快取，不建立 Firebase 讀取或監聽器。 */
export function prepareEggResultAssets() {
    return prepareFarmResultAssets(defaultAssets);
}

/** 收蛋／偷蛋共用圖片預熱；相同 PNG URL 重用瀏覽器快取。 */
export function prepareFarmResultAssets(assets) {
    const urls = [...new Set(Object.values(assets))], key = urls.join('|');
    if (!prepared.has(key)) prepared.set(key, Promise.all(urls.map(url => new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => finish(new Error('收蛋結果素材載入逾時')), 8000);
        function finish(error) {
            clearTimeout(timer); image.onload = image.onerror = null;
            error ? reject(error) : resolve();
        }
        image.onload = () => finish();
        image.onerror = () => finish(new Error('收蛋結果素材載入失敗'));
        image.src = url;
    }))).catch(error => { prepared.delete(key); throw error; }));
    return prepared.get(key);
}

/**
 * 僅呈現已提交的收蛋結果。關閉／場景結束共用冪等清理，不執行任何遊戲交易。
 * @param {Phaser.Scene} scene - 已完成收蛋的原場景。
 * @param {Object} result - collectPoultry 或 Cloud Functions 回傳的原始結果。
 * @returns {Promise<Object|null>} 面板控制介面；無收穫或等待期間已離開場景時回傳 null。
 */
export async function openEggResult(scene, result) {
    const view = eggResultView(result);
    return openFarmResult(scene, view);
}

/** 共用結果容器，只處理顯示與輸入生命週期，不執行遊戲交易。 */
export async function openFarmResult(scene, view, { assets = defaultAssets, title = '收蛋完成', lead = '本次共收取 ', kind = 'harvest', sourceRows = false, titleOverlay = false, waitForAssets = true } = {}) {
    if (!view) return null;
    if (scene.eggResultDialog) return scene.eggResultDialog;
    const dialog = createFarmDialog(scene, { kind, panelClass: kind === 'steal' ? 'farm-steal-result-panel' : '', label: title });
    const { root, panel, close } = dialog;
    try {
        if (waitForAssets) await prepareFarmResultAssets(assets);
        else void prepareFarmResultAssets(assets).catch(() => {});
        if (!dialog.isCurrent()) { close(); return null; }
        const el = (tag, cls, text) => {
            const node = document.createElement(tag); node.className = cls;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const art = (file, cls, alt = '') => {
            const image = el('img', cls); image.src = assets[file];
            image.alt = alt; image.draggable = false; return image;
        };
        const button = (file, cls, label) => {
            const node = el('button', cls); node.type = 'button'; node.setAttribute('aria-label', label);
            node.append(art(file, '')); node.onclick = close; return node;
        };
        const dismiss = button('close', 'farm-egg-result-close', '關閉' + title);
        const confirm = button('confirm', 'farm-egg-result-confirm', '確定');
        const total = el('div', 'farm-egg-result-total');
        const numberText = view.totalEggs.toLocaleString('zh-TW'), number = el('strong', '', numberText);
        number.style.fontSize = Math.min(9, 36 / numberText.length) + 'cqw';
        total.append(el('span', '', lead), number, el('span', '', ' 顆雞蛋'));
        const rows = el('div', 'farm-egg-result-rows'); rows.setAttribute('aria-label', '本次收穫'); rows.tabIndex = 0;
        for (const row of view.eggDetails) {
            const node = el('div', 'farm-egg-result-row');
            if (sourceRows) {
                const label = el('div', 'farm-steal-result-source'), primary = el('span', 'farm-steal-result-name', row.primary);
                primary.title = row.primary;
                label.append(primary);
                node.append(label, el('strong', 'farm-steal-result-quantity', `× ${row.quantity.toLocaleString('zh-TW')}`));
                node.setAttribute('aria-label', `${row.primary} × ${row.quantity}`);
            } else node.textContent = `${row.eggName} × ${row.quantity.toLocaleString('zh-TW')}`;
            rows.append(node);
        }
        const remaining = el('p', 'farm-egg-result-remaining', view.remaining ? `倉庫空間不足，尚有 ${view.remaining.toLocaleString('zh-TW')} 顆蛋留在雞舍` : '');
        remaining.hidden = !view.remaining;
        const heading = titleOverlay ? el('header', 'farm-egg-result-title') : art('title', 'farm-egg-result-title', title);
        if (titleOverlay) heading.append(art('title', ''), el('h2', 'farm-steal-result-title-text', title));
        panel.append(heading, dismiss,
            art('illustration', 'farm-egg-result-illustration'), total,
            art('section_title', 'farm-egg-result-section', '本次收穫'), rows,
            art('storage_banner', 'farm-egg-result-storage', '已放入倉庫'), remaining, confirm);
        root.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const nodes = [dismiss, rows, confirm], index = nodes.indexOf(document.activeElement);
                event.preventDefault(); nodes[index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? 2 : 1)) % nodes.length].focus();
            }
        });
        dialog.protectScroll(rows);
        if (!dialog.mount()) return null;
        return dialog;
    } catch (error) { close(); throw error; }
}
