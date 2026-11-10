import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FARM_DOCK, splitFarmCountdown } from '../js/farm/hud-layout.js';

test('底座定位與使用者提供的 V2 manifest 保持一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../assets/farm/reference-ui/v2/manifest.json', import.meta.url)));
    assert.deepEqual([FARM_DOCK.width, FARM_DOCK.height], manifest.dock_dimensions);
    assert.deepEqual(FARM_DOCK.hotzones, manifest.dock_hotzones);
});

test('倒數只拆開既有字串，保留雞種、長時數及例外提示', () => {
    for (const breed of ['母雞', '烏骨雞', '布雷斯雞', '日本長尾雞']) {
        assert.deepEqual(splitFarmCountdown(`${breed}下顆蛋 123:00:09`), { label: `${breed}下顆蛋`, time: '123:00:09' });
    }
    for (const text of ['產能已滿 (20 顆)', '雞舍空著，去商店選購雞隻吧！', '雞隻生病了，請先治療', '存檔未確認，點此重試', '讀取存檔中，請稍候…']) {
        assert.deepEqual(splitFarmCountdown(text), { label: text, time: '' });
    }
});
