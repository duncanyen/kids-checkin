import { BREEDS } from './poultry.js';
export function addPoultryGuide(scene) {
    const open = scene.add.rectangle(290, 730, 170, 42, 0x735038).setStrokeStyle(2, 0xdcb975).setInteractive({ cursor: 'pointer' });
    scene.add.text(290, 730, '雞隻圖鑑', { fontSize: '16px', color: '#fff2cc' }).setOrigin(0.5);
    const panel = scene.add.container(0, 0).setDepth(90).setVisible(false);
    panel.add([
        scene.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(),
        scene.add.rectangle(195, 410, 370, 550, 0xffefd0).setStrokeStyle(3, 0x735038),
        scene.add.text(195, 165, '雞隻圖鑑', { fontSize: '22px', color: '#593b27', fontStyle: 'bold' }).setOrigin(0.5)
    ]);
    Object.entries(BREEDS).forEach(([key, breed], index) => {
        const y = 235 + index * 90;
        const image = scene.add.image(62, y, breed.texture, 0); image.setScale(60 / image.width);
        panel.add([image, scene.add.text(108, y, `${breed.name}  買 ${breed.buy}／賣 ${breed.sell}\n每 ${breed.interval / 3600000} 小時 1 顆，24 小時 ${breed.daily} 顆\n每顆蛋售 ${breed.eggPrice} 金幣`, { fontSize: '14px', color: '#593b27', lineSpacing: 6 }).setOrigin(0, 0.5)]);
    });
    panel.add(scene.add.text(195, 540, '雞舍共用容量：3／10／20 隻\n混養時餵食可選品種；菜蟲加速 30 分鐘，\n蚯蚓加速 60 分鐘，作用於該品種健康雞隻。\n雞蛋最多保留各品種 24 小時產量，請定期收蛋。\n生病停止產蛋，出售雞隻會保留已產的蛋。\n生病、產能已滿或沒有雞隻時不消耗飼料。', { fontSize: '13px', color: '#735038', align: 'center', lineSpacing: 5 }).setOrigin(0.5));
    const close = scene.add.rectangle(195, 640, 130, 36, 0x735038).setInteractive({ cursor: 'pointer' });
    panel.add([close, scene.add.text(195, 640, '返回商店', { fontSize: '16px', color: '#fff2cc' }).setOrigin(0.5)]);
    open.on('pointerdown', () => panel.setVisible(true)); close.on('pointerdown', () => panel.setVisible(false));
    scene.poultryGuide = panel;
}
