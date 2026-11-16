import { createFarmDialog } from './farm-dialog.js';
import { prepareFarmResultAssets } from './egg-result-ui.js?v=20261116-coop-clean';

const folder = 'assets/farm/coop-clean/v1/';
const assets = Object.fromEntries(['panel','title','illustration','button_no','button_yes'].map(key => [key, folder + 'coop_clean_' + key + '.png']));
export const prepareCoopCleanAssets = () => prepareFarmResultAssets(assets);
const el = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; };

/** 只組裝確認視窗。實際清潔由原場景回呼執行，取消及關閉不呼叫交易。 */
export function openCoopCleanConfirm(scene, { context, valid, confirm, uncertain = false }) {
    if (scene.coopCleanDialog) return scene.coopCleanDialog;
    const dialog = createFarmDialog(scene, { property: 'coopCleanDialog', kind: 'coop-clean', panelClass: 'farm-coop-clean-panel', label: '打掃雞舍', valid });
    const { root, panel } = dialog;
    try {
        const art = (key, cls) => { const img = el('img', cls); img.src = assets[key]; img.alt = ''; img.draggable = false; return img; };
        const title = el('header', 'farm-coop-clean-title'); title.append(art('title',''), el('h2','','打掃雞舍'));
        const message = el('div', 'farm-coop-clean-message');
        message.append(el('strong','',context.name ? `${context.name} 的雞舍有點髒亂，` : '這座雞舍有點髒亂，'), el('span','','是否要幫忙打掃雞舍？'));
        const nameText = message.querySelector('strong'); nameText.tabIndex = 0;
        const no = el('button', 'farm-coop-clean-no'), yes = el('button', 'farm-coop-clean-yes');
        for (const [button, key, label] of [[no,'button_no','否'],[yes,'button_yes','是']]) { button.type='button'; button.append(art(key,''),el('span','',label)); }
        const status = el('p', 'farm-coop-clean-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
        let busy = false;
        const pendingLabel = () => { yes.querySelector('span').textContent = uncertain ? '確認結果' : '是'; };
        pendingLabel();
        if (uncertain) status.textContent = '前次結果尚未確認，請確認原交易。';
        no.onclick = () => { if (!busy) dialog.close(); };
        yes.onclick = async () => {
            if (busy) return;
            if (!dialog.isCurrent()) { dialog.close(); return; }
            busy = true; no.disabled = yes.disabled = true; yes.querySelector('span').textContent = '處理中…'; status.textContent = '';
            try {
                const result = await confirm(context);
                if (!dialog.isCurrent()) { dialog.close(); return; }
                if (result?.status === 'error') {
                    uncertain = result.uncertain;
                    status.textContent = uncertain ? '結果確認中。請按「確認結果」查回原交易，不會另開一筆打掃。' : result.message || '打掃未完成，請稍後重試。';
                } else dialog.close();
            } catch { if (dialog.isCurrent()) status.textContent = '未能確認打掃結果，請稍後重試。'; }
            finally { busy = false; if (dialog.isCurrent()) { no.disabled = yes.disabled = false; pendingLabel(); } }
        };
        root.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); if (!busy) dialog.close(); }
            if (event.key === 'Tab') { event.preventDefault(); const nodes = busy ? [nameText] : [nameText,no,yes], at = nodes.indexOf(document.activeElement); nodes[at<0 ? 0 : (at + (event.shiftKey ? nodes.length-1 : 1)) % nodes.length].focus(); }
        });
        const check = () => { if (!dialog.isCurrent()) dialog.close(); };
        scene.events.on('update', check);
        dialog.onClose = () => { scene.events.off('update', check); };
        panel.append(art('panel','farm-coop-clean-panel-art'), title, art('illustration','farm-coop-clean-illustration'), message, no, yes, status);
        dialog.protectScroll([message, status]);
        if (!dialog.mount()) return null;
        void prepareCoopCleanAssets().catch(() => { if (dialog.isCurrent() && !busy) status.textContent = '圖片暫時未能載入，仍可取消或確認。'; });
        return dialog;
    } catch (error) { dialog.close(); throw error; }
}
