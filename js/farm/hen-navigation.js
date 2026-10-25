const CLEARANCE = 40; // Half a hen plus a little room around the visible body.
const EPSILON = 1;

export function getThreatZones(scene) {
    return [scene.wolf, scene.tiger, scene.dragon, scene.gorilla]
        .filter(animal => animal?.active && animal.visible && animal.alpha > 0.05)
        .map(animal => {
            // Exclude the sheet's transparent margins, include the whole body.
            const bounds = animal.getBounds();
            const insetX = animal.displayWidth * 0.12;
            const insetY = animal.displayHeight * 0.1;
            return {
                left: bounds.left + insetX - CLEARANCE,
                right: bounds.right - insetX + CLEARANCE,
                top: bounds.top + insetY - CLEARANCE,
                bottom: bounds.bottom - insetY + CLEARANCE,
            };
        });
}

function contains(zone, point) {
    return point.x >= zone.left && point.x <= zone.right &&
        point.y >= zone.top && point.y <= zone.bottom;
}

export function pointIsSafe(point, zones) {
    return zones.every(zone => !contains(zone, point));
}

export function segmentIsSafe(start, end, zones, allowExit = false) {
    return zones.every(zone => {
        if (allowExit && contains(zone, start) && !contains(zone, end)) return true;
        let enter = 0, leave = 1;
        for (const [axis, min, max] of [['x', zone.left, zone.right], ['y', zone.top, zone.bottom]]) {
            const delta = end[axis] - start[axis];
            if (Math.abs(delta) < 0.00001) {
                if (start[axis] < min || start[axis] > max) return true;
            } else {
                const a = (min - start[axis]) / delta;
                const b = (max - start[axis]) / delta;
                enter = Math.max(enter, Math.min(a, b));
                leave = Math.min(leave, Math.max(a, b));
                if (enter > leave) return true;
            }
        }
        return false;
    });
}

function safeCorners(area, zones) {
    const points = [];
    const clampX = value => Math.max(area.left, Math.min(area.right, value));
    const clampY = value => Math.max(area.top, Math.min(area.bottom, value));
    for (const rect of [area, ...zones]) {
        for (const x of [clampX(rect.left - EPSILON), clampX(rect.right + EPSILON)]) {
            for (const y of [clampY(rect.top - EPSILON), clampY(rect.bottom + EPSILON)]) {
                const point = { x, y };
                if (pointIsSafe(point, zones)) points.push(point);
            }
        }
    }
    return points;
}

export function chooseHenPosition(scene, area) {
    const zones = getThreatZones(scene);
    for (let attempt = 0; attempt < 16; attempt++) {
        const point = {
            x: Phaser.Math.Between(area.left, area.right),
            y: Phaser.Math.Between(area.top, Math.max(area.top, area.bottom)),
        };
        if (pointIsSafe(point, zones)) return point;
    }
    const corners = safeCorners(area, zones);
    if (corners.length) return corners[Phaser.Math.Between(0, corners.length - 1)];
    // If simultaneous animals fill the clearing, maximize room rather than
    // spawning on top of the nearest animal. Existing hens will wait/replan.
    const candidates = [area.left, area.right].flatMap(x =>
        [area.top, area.bottom].map(y => ({ x, y })));
    const clearance = point => Math.min(...zones.map(zone => contains(zone, point)
        ? -Math.min(point.x - zone.left, zone.right - point.x, point.y - zone.top, zone.bottom - point.y)
        : Math.hypot(Math.max(zone.left - point.x, 0, point.x - zone.right),
            Math.max(zone.top - point.y, 0, point.y - zone.bottom))));
    return candidates.sort((a, b) => clearance(b) - clearance(a))[0];
}

export function henRouteIsSafe(scene, hen) {
    const zones = getThreatZones(scene);
    let start = { x: hen.x, y: hen.y };
    const path = hen.walkPath || [];
    if (!path.length) return pointIsSafe(start, zones);
    for (let i = 0; i < path.length; i++) {
        if (!segmentIsSafe(start, path[i], zones, i === 0 && hen.isEvading)) return false;
        start = path[i];
    }
    return true;
}

export function planHenPath(scene, hen, area) {
    const start = { x: hen.x, y: hen.y };
    const zones = getThreatZones(scene);
    const evading = !pointIsSafe(start, zones);
    const goal = chooseHenPosition(scene, area);
    const nodes = [start, goal, ...safeCorners(area, zones)];
    const distance = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const visited = new Set();
    distance[0] = 0;
    while (visited.size < nodes.length) {
        let current = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (!visited.has(i) && (current === -1 || distance[i] < distance[current])) current = i;
        }
        if (current === -1 || !Number.isFinite(distance[current])) break;
        visited.add(current);
        for (let next = 1; next < nodes.length; next++) {
            if (visited.has(next) || !pointIsSafe(nodes[next], zones)) continue;
            if (!segmentIsSafe(nodes[current], nodes[next], zones, current === 0 && evading)) continue;
            const length = Math.hypot(nodes[next].x - nodes[current].x, nodes[next].y - nodes[current].y);
            if (distance[current] + length < distance[next]) {
                distance[next] = distance[current] + length;
                previous[next] = current;
            }
        }
    }
    let destination = 1;
    if (evading || !Number.isFinite(distance[1])) {
        destination = -1;
        for (let i = 1; i < nodes.length; i++) {
            if (Number.isFinite(distance[i]) && (destination === -1 || distance[i] < distance[destination])) destination = i;
        }
    }
    const points = [];
    for (let i = destination; i > 0; i = previous[i]) {
        points.unshift(nodes[i]);
    }
    return { points, evading };
}
