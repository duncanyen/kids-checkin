import { BREEDS } from './poultry.js';
import { WEAPONS_CONFIG } from './combat-rules.js';

export const ITEM_CATEGORIES = [
    { key: 'chickens', label: '雞' },
    { key: 'weapons', label: '武器' },
    { key: 'coops', label: '雞舍' },
    { key: 'other', label: '其他' }
];
export const COOP_NAMES = { 1: '基礎雞舍', 2: '中級雞舍', 3: '高級雞舍', 4: '特級雞舍', 5: '頂級雞舍' };
export const coopName = level => COOP_NAMES[level || 1] || `Lv.${level} 雞舍`;
export function itemCategory(key) {
    if (BREEDS[key] || key.startsWith('bird:') || Object.values(BREEDS).some(b => b.eggKey === key)) return 'chickens';
    if (WEAPONS_CONFIG[key]) return 'weapons';
    if (/^coop[2-5]$/.test(key) || key === 'ownedCoop') return 'coops';
    return 'other';
}

export function addCategoryTabs(scene, y, onSelect) {
    const tabs = new Map();
    for (const [index, category] of ITEM_CATEGORIES.entries()) {
        const x = 55 + index * 94;
        const background = scene.add.image(x, y, 'ui_wood').setDisplaySize(84, 38).setInteractive({ cursor: 'pointer' });
        const label = scene.add.text(x, y, category.label, { fontSize: '16px', color: '#fff2cc', fontStyle: 'bold', stroke: '#593b27', strokeThickness: 2 }).setOrigin(0.5);
        background.on('pointerdown', () => onSelect(category.key));
        tabs.set(category.key, { background, label });
    }
    return { tabs, select(key) {
        for (const [id, tab] of tabs) {
            tab.background.setTexture(id === key ? 'ui_wood_selected' : 'ui_wood');
            tab.label.setColor(id === key ? '#ffe082' : '#fff2cc');
        }
    } };
}
