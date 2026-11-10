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

/** 只裁出共用圖片中的按鈕像素，讓它能獨立縮放；不使用舊版單顆切圖。 */
export function styleFarmDockSprite(node, zone) {
    node.style.backgroundSize = `${FARM_DOCK.width / zone.w * 100}% ${FARM_DOCK.height / zone.h * 100}%`;
    node.style.backgroundPosition = `${zone.x / (FARM_DOCK.width - zone.w) * 100}% ${zone.y / (FARM_DOCK.height - zone.h) * 100}%`;
}

/** 遮掉底座圖重複的按鈕，避免縮放後仍露出一顆未縮小的原圖。SVG 僅作遮罩。 */
export function farmDockMaskURL() {
    const holes = FARM_DOCK.hotzones.map(({x,y,w,h}) => `M${x} ${y}h${w}v${h}h-${w}Z`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FARM_DOCK.width} ${FARM_DOCK.height}"><path fill="white" fill-rule="evenodd" d="M0 0H${FARM_DOCK.width}V${FARM_DOCK.height}H0Z ${holes}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 拆開場景已產生的倒數字串供排版；不計算或改寫產蛋時間。 */
export function splitFarmCountdown(text) {
    const match = /^(.*?)\s+(\d+:\d{2}:\d{2})$/.exec(text);
    return match ? { label: match[1], time: match[2] } : { label: text, time: '' };
}
