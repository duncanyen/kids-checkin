// Pure, clock-injected model: a village shares weather without database writes.
export const WEATHER_SLOT_MS = 45 * 60 * 1000;
export const WEATHER_FADE_MS = 20 * 1000;
export const WEATHER = {
    clear: { label: '晴朗' }, cloudy: { label: '多雲' },
    rain: { label: '小雨' }, mist: { label: '薄霧' },
};
const clamp = value => Math.min(1, Math.max(0, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export function villageSeed(value) {
    let hash = 2166136261;
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
}
function weatherAt(groupId, slot) {
    const roll = villageSeed(`village-weather-1:${groupId}:${slot}`) % 100;
    return roll < 45 ? 'clear' : roll < 75 ? 'cloudy' : roll < 93 ? 'rain' : 'mist';
}
export function atmosphereAt(timestamp, groupId) {
    const local = new Date(timestamp + 8 * 3600000);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
    const phase = minute < 300 || minute >= 1110 ? '夜晚' : minute < 420 ? '晨光' : minute < 990 ? '白晝' : '黃昏';
    const anchors = [
        [0, [33, 40, 88], .4, 1], [300, [33, 40, 88], .4, 1],
        [360, [255, 214, 142], .13, .25], [420, [255, 239, 195], 0, 0],
        [990, [255, 239, 195], 0, 0], [1050, [242, 146, 80], .19, .5],
        [1110, [33, 40, 88], .4, 1], [1440, [33, 40, 88], .4, 1],
    ];
    const index = anchors.findIndex((anchor, i) => i < anchors.length - 1 && minute >= anchor[0] && minute < anchors[i + 1][0]);
    const a = anchors[Math.max(0, index)], b = anchors[Math.max(0, index) + 1];
    const t = smooth((minute - a[0]) / (b[0] - a[0]));
    const slot = Math.floor(timestamp / WEATHER_SLOT_MS);
    const weather = weatherAt(groupId, slot), previousWeather = weatherAt(groupId, slot - 1);
    const blend = smooth((timestamp - slot * WEATHER_SLOT_MS) / WEATHER_FADE_MS);
    const weights = Object.fromEntries(Object.keys(WEATHER).map(key => [key, (key === previousWeather ? 1 - blend : 0) + (key === weather ? blend : 0)]));
    return { phase, minute, time: `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`, color: a[1].map((v, i) => Math.round(mix(v, b[1][i], t))), shade: mix(a[2], b[2], t), night: mix(a[3], b[3], t), weather, previousWeather, weights, transition: blend, nextWeatherAt: (slot + 1) * WEATHER_SLOT_MS };
}
