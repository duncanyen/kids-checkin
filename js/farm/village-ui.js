// Warm hand-painted surfaces shared by the village's controls.
export const villageText = {
    fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
    color: '#fff7da', stroke: '#61401f', strokeThickness: 3,
};

export function villageButton(scene, x, y, text, callback, width = 150, owner = null) {
    const compact = width <= 64, height = compact ? 44 : 46;
    const bg = scene.add.image(x, y, compact ? 'ui_page' : 'ui_wood').setDisplaySize(width, height).setInteractive({ cursor: 'pointer' });
    bg.setData({ compact, buttonWidth: width, buttonHeight: height, selected: false });
    const label = scene.add.text(x, y, text, { ...villageText, fontSize: compact ? '13px' : '14px', fontStyle: 'bold' }).setOrigin(0.5);
    bg.label = label;
    const reset = () => { if (bg.active) bg.setDisplaySize(width, height).clearTint(); };
    bg.on('pointerover', () => bg.setTint(0xffefbf));
    bg.on('pointerout', reset);
    bg.on('pointerup', reset);
    bg.on('pointerdown', () => { bg.setDisplaySize(width * 0.96, height * 0.96); callback(); });
    owner?.add([bg, label]);
    return bg;
}

export function selectVillageButton(button, selected) {
    if (!button?.active) return;
    button.setData('selected', selected);
    if (button.getData('compact')) {
        button.setTexture(selected ? 'ui_parchment' : 'ui_page').clearTint();
        button.label.setColor(selected ? '#593b22' : '#fff7da').setStroke(selected ? '#fff7da' : '#61401f', selected ? 1 : 3);
    }
    else button.setTexture(selected ? 'ui_wood_selected' : 'ui_wood');
    button.setDisplaySize(button.getData('buttonWidth'), button.getData('buttonHeight'));
}
