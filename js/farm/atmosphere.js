import { onSceneExit } from './scene-cleanup.js';
import { farmView } from './viewport.js';
import { getFarmMapLayout } from './scenery.js';
import { atmosphereAt, WEATHER, villageSeed } from './atmosphere-core.js';

function glow(graphics, x, y, radius, color, strength) {
    if (strength <= 0) return; // Exactly transparent: no visible output to tessellate.
    for (let i = 8; i >= 1; i--) graphics.fillStyle(color, strength * .035 * (9 - i)).fillCircle(x, y, radius * i / 8);
}
export function attachFarmAtmosphere(scene, { groupId }) {
    const root = document.getElementById('farm-atmosphere');
    if (!root) return; // Embedded canvases may omit the atmosphere status bar.
    const label = root.querySelector('[data-climate-label]');
    const grade = scene.add.graphics().setDepth(-4);
    const ground = scene.add.graphics().setDepth(4);
    const weather = scene.add.graphics().setDepth(12);
    const lights = scene.add.graphics().setDepth(13);
    const firelight = scene.add.graphics().setDepth(24.5);
    const seed = villageSeed(groupId);
    const particles = Array.from({ length: 38 }, (_, i) => {
        const h = villageSeed(`${seed}:${i}`);
        return { x: h % 10000 / 10000, y: (h >>> 8) % 10000 / 10000, speed: .7 + (h % 100) / 100, phase: h % 628 / 100 };
    });
    let state = atmosphereAt(Date.now(), groupId), stopped = false, lastFrame = -Infinity, lastClock = -Infinity;
    let lastAnnouncement = '';
    root.dataset.active = 'true';
    root.dataset.groupId = groupId;
    function refresh() {
        lastClock = -Infinity; lastFrame = -Infinity;
        if (!document.hidden) tick();
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    function tick() {
        if (stopped || document.hidden) return;
        const now = Date.now();
        if (now >= lastFrame && now - lastFrame < 33) return;
        lastFrame = now;
        if (now - lastClock >= 1000 || now < lastClock) {
            lastClock = now;
            state = atmosphereAt(now, groupId);
            const announcement = `${state.phase}・${WEATHER[state.weather].label}`;
            if (announcement !== lastAnnouncement) { label.textContent = announcement; lastAnnouncement = announcement; }
            root.dataset.weather = state.weather; root.dataset.phase = state.phase;
            const next = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(state.nextWeatherAt);
            root.querySelector('[data-climate-clock]').textContent = `台灣時間 ${state.time} · 下次天氣判定 ${next}`;
        }
        const view = farmView(scene), {width,height} = view;
        for (const layer of [grade,ground,weather,lights,firelight]) layer.setPosition(view.left,view.top);
        const map=getFarmMapLayout(scene),scale=map.scale;
        const point=(x,y)=>{const p=map.point(x,y);return{x:p.x-view.left,y:p.y-view.top};};
        const t = now / 1000;
        const { rain, mist, cloudy, clear } = state.weights;
        grade.clear(); ground.clear(); weather.clear(); lights.clear(); firelight.clear();
        grade.fillStyle((state.color[0] << 16) | (state.color[1] << 8) | state.color[2], state.shade).fillRect(0, 0, width, height);
        grade.fillStyle(0x42576b, cloudy * .065 + rain * .11).fillRect(0, 0, width, height);
        // A small shared light wash integrates hens/eggs while leaving HUD,
        // enemy health bars, buttons and confirmation dialogs unobscured.
        weather.fillStyle(0x434b82, state.night * .055).fillRect(0, 190, width, height - 190);
        for (let i = 0; i < 3; i++) {
            const x = ((i * 173 + t * 3) % (width + 240)) - 120;
            ground.fillStyle(0x374b55, (cloudy + rain + clear * .25) * .018);
            ground.fillEllipse(x, 240 + i * 176, 240, 66);
        }
        // Thin fog stays at the tree margins; the central attack area is clear.
        for (let side = 0; side < 2; side++) for (let i = 0; i < 4; i++) {
            ground.fillStyle(0xe0e8da, (mist * .08 + (state.phase === '晨光' ? .018 : 0)));
            ground.fillEllipse((side ? width : 0) + Math.sin(t / 18 + i) * 14, 230 + i * 160, 100 + i * 15, 70);
        }
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const x = ((p.x * width + t * 20 * p.speed) % (width + 30)) - 15;
            const y = 190 + ((p.y * height + t * 190 * p.speed) % (height - 190));
            // Rain is lighter over the hen clearing and the coop entrance.
            const center = x > width * .18 && x < width * .82 && y < height * .72;
            weather.lineStyle(1, 0xd6eef3, rain * (center ? .13 : .32));
            weather.lineBetween(x, y, x - 2, y + 9);
            if (i < 8 && rain > .001) {
                const wave = ((t * .65 + p.phase) % 1);
                ground.lineStyle(1, 0xd7e8d8, rain * (1 - wave) * .22);
                ground.strokeEllipse(p.x < .5 ? 20 + p.x * 50 : width - 40 + p.x * 25, 330 + p.y * 430, 3 + wave * 14, 1 + wave * 5);
            }
            if (i < 7) {
                const sideX = i % 2 ? width - 24 - p.x * 25 : 15 + p.x * 25;
                const firefly = clear * state.night * (.5 + .5 * Math.sin(t * 1.2 + p.phase));
                glow(lights, sideX + Math.sin(t / 4 + i) * 9, 360 + p.y * 340 + Math.cos(t / 3 + i) * 6, 7, 0xf2ef99, firefly);
                lights.fillStyle(0xfff1ac, firefly * .8).fillCircle(sideX + Math.sin(t / 4 + i) * 9, 360 + p.y * 340 + Math.cos(t / 3 + i) * 6, 1);
                const leafAlpha = clear * (1 - state.night) * .35;
                ground.fillStyle(0xa6b956, leafAlpha).fillEllipse(sideX + Math.sin(t / 6 + i) * 12, 180 + ((p.y * 600 + t * 8) % 600), 4, 2);
            }
        }
        const warmth = state.night * (.96 + Math.sin(t * 2) * .04);
        // Positions refer to the existing 720×1280 painted map.
        for (const [x, y, radius] of [[430, 345, 34], [187, 316, 28], [456, 145, 25], [166, 923, 28], [175, 889, 23]]) {
            const p = point(x, y); glow(lights, p.x, p.y, radius * scale, 0xffc86d, warmth);
        }
        const windowPoint = point(430, 345);
        lights.fillStyle(0xffdb8b, warmth * .35).fillRoundedRect(windowPoint.x - 6, windowPoint.y - 8, 11, 15, 2);
        if (scene.dragon?.active && scene.dragon.visible && state.night > .05) {
            glow(firelight, scene.dragon.x - view.left + 45, scene.dragon.y - view.top - 18, 72, 0xff982f, warmth * (scene.dragonEncounter?.phase === 'fire' ? 1 : .35));
        }
    }
    scene.farmAtmosphere = { groupId, get state() { return state; }, refresh };
    scene.events.on('update', tick);
    tick();
    onSceneExit(scene, () => {
        stopped = true;
        scene.events.off('update', tick);
        document.removeEventListener('visibilitychange', refresh); window.removeEventListener('pageshow', refresh);
        [grade, ground, weather, lights, firelight].forEach(layer => layer.destroy());
        root.dataset.active = 'false'; delete root.dataset.groupId;
        label.textContent = '村落氣候'; root.querySelector('[data-climate-clock]').textContent = '進入農莊後顯示當地氣候';
        scene.farmAtmosphere = null;
    });
}
