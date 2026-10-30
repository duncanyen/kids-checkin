import { ensureAssets } from './assets.js';
import { onSceneExit } from './scene-cleanup.js';
import { getFarmMapLayout } from './scenery.js';
import { farmView } from './viewport.js';
import { halloweenActive, HALLOWEEN_START, HALLOWEEN_END } from './halloween-core.js';
import { holidayClock } from './holiday-clock.js';

// Raw artwork anchors are calibrated independently for the two paintings.
const layouts = {
    farm_map: [
        ['coop_pumpkins',202,412,76], ['garland',428,333,118], ['ghost',116,214,59],
        ['garden_pumpkins',123,1242,96], ['pumpkin',628,934,61],
        ['leaves',94,585,70], ['leaves',652,733,62], ['leaves',345,1242,105],
    ],
    farm_panorama: [
        ['coop_pumpkins',929,284,66], ['garland',1115,232,102], ['ghost',865,166,48],
        ['garden_pumpkins',844,674,90], ['pumpkin',1288,456,54],
        ['leaves',850,384,68], ['leaves',1325,420,58], ['leaves',1080,696,92],
    ],
};

export function mountHalloween(scene, { lobby = false, clock = holidayClock(scene.game) } = {}) {
    let stopped = false, loading = false, layer = null, lights = null, boundary;
    let lastPaint = -Infinity, retryAt = 0;
    const ornaments = [], pumpkins = [];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const remove = () => {
        ornaments.length = 0; pumpkins.length = 0;
        layer?.setVisible(false); lights?.clear();
        layer?.destroy(); lights?.destroy(); layer = lights = null;
    };
    function layout() {
        if (!layer) return;
        const map = getFarmMapLayout(scene), view = farmView(scene);
        const specs = lobby ? [
            ['garden_pumpkins',view.left+32,view.top+view.height-24,60],
            ['pumpkin',view.left+view.width-34,view.top+view.height-24,43],
            ['ghost',view.left+30,view.top+145,36],
        ] : layouts[map.texture];
        ornaments.forEach((item, i) => {
            const [frame,x,y,width] = specs[i];
            const point = lobby ? { x, y } : { x:map.offsetX+x*map.artScale, y:map.offsetY+y*map.artScale };
            item.setPosition(point.x,point.y).setDisplaySize(width*(lobby?1:map.artScale),width*(lobby?1:map.artScale)*item.height/item.width);
            item.setData('baseX',point.x); item.setData('baseY',point.y);
            item.setData('ghost',frame==='ghost');
        });
        lastPaint = -Infinity;
    }
    function build() {
        if (stopped || layer || !halloweenActive(clock.now())) return;
        layer = scene.add.container().setDepth(lobby ? -4 : -5).setName('halloween-decorations');
        lights = scene.add.graphics().setDepth(-3).setName('halloween-lights');
        const frames = lobby ? ['garden_pumpkins','pumpkin','ghost'] : layouts[getFarmMapLayout(scene).texture].map(spec=>spec[0]);
        frames.forEach(frame => {
            const item = scene.add.image(0,0,'halloween_2026',frame).setOrigin(.5,frame==='ghost'?0:1);
            // No input, physics, tweens, hen threats or save mutations.
            layer.add(item); ornaments.push(item);
            if (frame.includes('pumpkin')) pumpkins.push(item);
        });
        layout();
    }
    function schedule() {
        clearTimeout(boundary);
        const now = clock.now(), next = now < HALLOWEEN_START ? HALLOWEEN_START : HALLOWEEN_END;
        if (now < next) boundary = setTimeout(()=>{tick();schedule();}, Math.min(2147483647, Math.max(1,next-now)));
    }
    async function load() {
        if (stopped || layer || loading || clock.now()<retryAt || !halloweenActive(clock.now())) return;
        loading = true;
        try {
            await ensureAssets(scene,['halloween_2026']);
            build();
        } catch { retryAt=clock.now()+30000; }
        finally { loading=false; }
    }
    function tick() {
        if (stopped) return;
        const now = clock.now();
        // Expiry is checked every frame, before throttling decorative animation.
        if (!halloweenActive(now)) { if (layer) remove(); return; }
        clock.refresh();
        if (!layer) { load(); return; }
        if (document.hidden || now-lastPaint<80) return;
        lastPaint=now;
        const night=scene.farmAtmosphere?.state.night || 0;
        const breathe=motion.matches?1:.94+Math.sin(now/1100)*.06;
        lights.clear();
        for (const item of pumpkins) {
            const radius=item.displayWidth*.38,x=item.x,y=item.y-item.displayHeight*.42;
            for(let i=5;i>=1;i--)lights.fillStyle(0xffb64a,(.035+night*.04)*breathe*(6-i)/5).fillCircle(x,y,radius*i/5);
        }
        for (const item of ornaments) if(item.getData('ghost')) item.setAngle(motion.matches?0:Math.sin(now/900)*2);
    }
    function refresh() {
        if (stopped) return;
        tick(); schedule(); clock.refresh(true);
    }
    const unsubscribe=clock.subscribe(()=>{if(!stopped){tick();schedule();}});
    scene.events.on('update',tick);
    scene.events.on('farm-viewport-resize',layout);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('pageshow',refresh); window.addEventListener('online',refresh);
    onSceneExit(scene,()=>{
        stopped=true; clearTimeout(boundary); unsubscribe(); remove();
        scene.events.off('update',tick);scene.events.off('farm-viewport-resize',layout);
        document.removeEventListener('visibilitychange',refresh);
        window.removeEventListener('pageshow',refresh);window.removeEventListener('online',refresh);
        scene.halloween=null;
    });
    const controller=scene.halloween={refresh,get active(){return !!layer;},get ornaments(){return [...ornaments];}};
    tick();schedule();clock.refresh();return controller;
}
