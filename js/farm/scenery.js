import { farmView } from './viewport.js';
import { chooseHenPosition, getThreatZones } from './hen-navigation.js';

// Single continuous panorama: the renderer fills the viewport, not a CSS backdrop.
export function addFarmBackground(scene, field = false) {
    const image = scene.add.image(0, 0, field ? 'farm_map' : 'farm_background').setOrigin(0, 0).setDepth(-10);
    let previous;
    const resize = () => {
        const view = farmView(scene);
        if (!field) {
            const scale = Math.max(view.width / image.width, view.height / image.height);
            image.setPosition(195 - image.width * scale / 2, 422 - image.height * scale / 2)
                .setDisplaySize(image.width * scale, image.height * scale);
            return;
        }
        const map = getFarmMapLayout(scene);
        image.setTexture(map.texture).setPosition(map.offsetX, map.offsetY).setDisplaySize(map.width * map.artScale, map.height * map.artScale);
        if (previous && (previous.texture !== map.texture || previous.artScale !== map.artScale)) reflowFarm(scene, previous, map);
        previous = map;
    };
    resize();
    scene.events.on('farm-viewport-resize', resize);
    scene.events.once('shutdown', () => scene.events.off('farm-viewport-resize', resize));
    return image;
}

// Reference coordinates preserve the existing farm interactions. These landmarks
// align them with the new panoramic painting, including all 42 cabbages.
const yKnots = [[0,0],[210,157],[322.5,246],[395,327],[495,355],[900,453],
    [961,492],[993,515],[1027,540],[1062,566],[1099,591],[1137,618],[1194,659],[1280,724]];
function interpolate(value, inverse = false) {
    const from = inverse ? 1 : 0, to = inverse ? 0 : 1;
    let i = 1;
    while (i < yKnots.length - 1 && value > yKnots[i][from]) i++;
    const a = yKnots[i - 1], b = yKnots[i];
    return a[to] + (value - a[from]) / (b[from] - a[from]) * (b[to] - a[to]);
}
export function getFarmMapLayout(scene) {
    const view = farmView(scene);
    if (view.width <= 500) {
        const artScale = Math.max(view.width / 720, view.height / 1280);
        const offsetX = 195 - 360 * artScale, offsetY = 422 - 640 * artScale;
        return { texture: 'farm_map', width:720, height:1280, artScale, scale:artScale, offsetX, offsetY,
            point:(x,y)=>({x:offsetX+x*artScale,y:offsetY+y*artScale}),
            reference:(x,y)=>({x:(x-offsetX)/artScale,y:(y-offsetY)/artScale}) };
    }
    const artScale = Math.max(view.width / 2172, view.height / 724);
    const offsetX = 195 - 1086 * artScale, offsetY = 422 - 362 * artScale;
    return { texture:'farm_panorama', width:2172, height:724, artScale, scale: .889 * artScale, offsetX, offsetY,
        point: (x, y) => ({ x: offsetX + (739 + x * .889) * artScale, y: offsetY + interpolate(y) * artScale }),
        reference: (x, y) => ({ x: ((x - offsetX) / artScale - 739) / .889, y: interpolate((y - offsetY) / artScale, true) }) };
}
function coopGeometry(map) {
    return { width: 260 * map.scale, height: map.point(370,435).y - map.point(370,210).y };
}
function reflowFarm(scene, oldMap, map) {
    const move = object => {
        if (!object?.active) return;
        const ref = oldMap.reference(object.x, object.y), point = map.point(ref.x, ref.y);
        object.setPosition(point.x, point.y);
    };
    if (scene.coop) {
        const p = map.point(370,322.5), size = coopGeometry(map);
        scene.coop.setPosition(p.x,p.y).setSize(size.width,size.height);
        scene.coop.input?.hitArea.setSize(size.width,size.height);
        scene.coop.levelBadge?.setPosition(p.x,p.y+size.height/2+9);
    }
    [scene.coopEgg,scene.farmSign,...(scene.gardenPlants || []),...(scene.rubbishGroup?.getChildren() || [])].forEach(move);
    if (scene.gardenBounds) {
        const a=map.point(145,900),b=map.point(596,1194);
        scene.gardenBounds={left:a.x,top:a.y,right:b.x,bottom:b.y};
    }
    for (const hen of scene.hensGroup || []) {
        // Let the nesting sequence finish its callbacks; killing it could leave
        // isHenSitting locked. Its next wander uses the new clearing.
        if (scene.isHenSitting) { move(hen); continue; }
        scene.tweens.killTweensOf(hen); hen.walkTimer?.remove(); move(hen);
        scene.wanderSingleHen?.(hen);
    }
    for (const name of ['wolf','tiger','dragon','gorilla','eagle']) move(scene[name]);
    for (const name of ['wolf','tiger']) {
        const predator=scene[name],dest=predator?{x:scene.coop.x,y:scene.coop.getBounds().bottom+20}:null;
        if (dest && predator.moveTween?.isPlaying()) { predator.moveTween.updateTo('x',dest.x,true); predator.moveTween.updateTo('y',dest.y,true); }
    }
    for (const boss of [scene.eagleEncounter,scene.dragonEncounter,scene.gorillaEncounter].filter(Boolean)) {
        boss.destination=boss.spec.destination ? boss.spec.destination() : {x:Math.max(boss.spec.minX||80,scene.coop.getBounds().left-(boss.spec.approachInset||34)),y:scene.coop.getBounds().bottom+10};
        if (boss.flight?.isPlaying()) { boss.flight.updateTo('x',boss.destination.x,true); boss.flight.updateTo('y',boss.destination.y,true); }
        else if (!boss.result) boss.sprite.setPosition(boss.destination.x,boss.destination.y);
    }
}

export function addFarmCoop(scene, onClick) {
    const map = getFarmMapLayout(scene);
    const position = map.point(370, 322.5);
    const size = coopGeometry(map);
    const coop = scene.add.zone(position.x, position.y, size.width, size.height)
        .setInteractive({ cursor: 'pointer' }).setData('mapCoop', true);
    coop.on('pointerdown', onClick);
    coop.levelBadge = scene.add.text(coop.x, coop.y + coop.height / 2 + 9, '', {
        fontSize: '11px', color: '#fff7dc', backgroundColor: '#66502acc', padding: { x: 7, y: 4 }
    }).setOrigin(0.5).setDepth(5);
    setCoopSize(coop);
    return coop;
}

export function farmEggPosition(scene) {
    return getFarmMapLayout(scene).point(327, 395);
}

export function addFarmSign(scene, onClick) {
    const position = getFarmMapLayout(scene).point(160, 940);
    const sign = scene.farmSign = scene.add.image(position.x, position.y, 'signboard')
        .setDisplaySize(32, 38).setDepth(5).setInteractive({ cursor: 'pointer' });
    sign.on('pointerdown', () => onClick(sign));
    return sign;
}

export function setCoopSize(coop, level = 1) {
    if (coop.getData('mapCoop')) {
        // Capacity upgrades remain unchanged. The baked map building keeps its
        // artwork aligned with its hit zone; its current level is shown here.
        coop.levelBadge.setText('雞舍 Lv.' + level);
        return;
    }
    const scale = level >= 3 ? 1.5 : level === 2 ? 1.2 : 1;
    coop.setDisplaySize(160 * scale, 150 * scale);
}

// All points lie in a convex clearing below the largest visible edge of the
// coop. Straight tween segments between them cannot cut through the building.
export function getHenWalkArea(scene) {
    const map = getFarmMapLayout(scene);
    return {
        left: Math.ceil(Math.max(40, map.point(185, 0).x)),
        right: Math.floor(Math.min(350, map.point(545, 0).x)),
        top: Math.ceil(Math.max(scene.coop.y + scene.coop.displayHeight / 2 + 30, map.point(0, 495).y + 12)),
        bottom: Math.floor(map.point(0, 900).y - 32),
    };
}

export function getHenWanderArea(scene) {
    const area = getHenWalkArea(scene);
    // Rain encourages shelter, but predators always retain the full escape area.
    if (scene.farmAtmosphere?.state.weights.rain > .5 && !getThreatZones(scene).length) {
        return { ...area, bottom: Math.round(area.top + (area.bottom - area.top) * .55) };
    }
    return area;
}

export function randomHenPosition(scene) {
    return chooseHenPosition(scene, getHenWanderArea(scene));
}

export function addVegetableGarden(scene, onPlantClick) {
    const map = getFarmMapLayout(scene);
    const rows = [961, 993, 1027, 1062, 1099, 1137];
    scene.gardenPlants = [];
    const corner = map.point(145, 900);
    scene.gardenBounds = { left: corner.x, top: corner.y,
        right: map.point(596, 0).x, bottom: map.point(0, 1194).y };
    // Seven columns and six rows follow the cabbages already painted on the
    // supplied map. Zones preserve the existing independent search actions.
    for (let row = 0; row < rows.length; row++) {
        const firstX = 217 - row * 3.2, spacing = 49 + row * 0.8;
        for (let column = 0; column < 7; column++) {
            const position = map.point(firstX + column * spacing, rows[row]);
            const plant = scene.add.zone(position.x, position.y, 28, 22)
                .setInteractive({ cursor: 'pointer' });
            plant.on('pointerdown', () => {
                if (plant.isAnimating) return;
                const pulse = scene.add.circle(plant.x, plant.y, 12, 0xffebad, 0.3)
                    .setStrokeStyle(2, 0xffedb4, 0.9).setDepth(4);
                scene.tweens.add({ targets: pulse, y: pulse.y - 8, alpha: 0,
                    duration: 250, onComplete: () => pulse.destroy() });
                onPlantClick(plant);
            });
            scene.gardenPlants.push(plant);
        }
    }

    return scene.gardenPlants;
}
