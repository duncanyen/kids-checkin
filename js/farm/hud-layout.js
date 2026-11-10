// 對應使用者 V2 manifest.json 的原圖座標；以百分比定位，整組等比縮放。
export const FARM_DOCK = {
    width: 1495,
    height: 356,
    hotzones: [
        { id: 'village', x: 145, y: 43, w: 248, h: 238 },
        { id: 'shop', x: 392, y: 43, w: 247, h: 238 },
        { id: 'warehouse', x: 645, y: 43, w: 245, h: 238 },
        { id: 'collection', x: 898, y: 43, w: 240, h: 238 },
        { id: 'mail', x: 1148, y: 43, w: 236, h: 238 }
    ]
};

/** 將既有按鈕放在整張底圖的對應區域，不替換它的事件或無障礙名稱。 */
export function placeFarmDockButton(node, zone) {
    node.dataset.dockZone = zone.id;
    node.style.left = `${zone.x / FARM_DOCK.width * 100}%`;
    node.style.top = `${zone.y / FARM_DOCK.height * 100}%`;
    node.style.width = `${zone.w / FARM_DOCK.width * 100}%`;
    node.style.height = `${zone.h / FARM_DOCK.height * 100}%`;
}

/** 拆開場景已產生的倒數字串供排版；不計算或改寫產蛋時間。 */
export function splitFarmCountdown(text) {
    const match = /^(.*?)\s+(\d+:\d{2}:\d{2})$/.exec(text);
    return match ? { label: match[1], time: match[2] } : { label: text, time: '' };
}
