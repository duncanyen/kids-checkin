// Rebuild atlas metadata only: the source PNG files are never altered.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const BREEDS = ['hen', 'silkie', 'bresse'];
// Omit the decorative flying feathers in this idle pose, using a clean pose.
const sourceFrame = (breed, index) => breed === 'silkie' && index === 4 ? 5 : index;

async function analyzeSheet(breed) {
    const file = path.join(ROOT, 'assets/farm', `${breed}-sheet.png`);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const labels = new Int32Array(info.width * info.height).fill(-1);
    const components = [], bodies = new Map();
    for (let pixel = 0; pixel < labels.length; pixel++) {
        if (labels[pixel] !== -1 || data[pixel * 4 + 3] < 32) continue;
        const id = components.length, queue = [pixel];
        labels[pixel] = id;
        let left = info.width, top = info.height, right = 0, bottom = 0;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const p = queue[cursor], x = p % info.width, y = Math.floor(p / info.width);
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
            for (const neighbor of [x > 0 ? p - 1 : -1, x < info.width - 1 ? p + 1 : -1, y > 0 ? p - info.width : -1, y < info.height - 1 ? p + info.width : -1]) {
                if (neighbor < 0 || labels[neighbor] !== -1 || data[neighbor * 4 + 3] < 32) continue;
                labels[neighbor] = id; queue.push(neighbor);
            }
        }
        const component = { id, area: queue.length, left, top, right, bottom };
        components.push(component);
        if (component.area > 10000) {
            const col = Math.floor((left + right) / 2 / (info.width / 4));
            const row = Math.floor((top + bottom) / 2 / (info.height / 4));
            const index = row * 4 + col;
            if (bodies.has(index)) throw Error(`${breed}: overlapping bodies in frame ${index}`);
            bodies.set(index, component);
        }
    }
    if (bodies.size !== 16) throw Error(`${breed}: expected 16 complete chickens, found ${bodies.size}`);
    return { info, labels, components, bodies };
}

function buildAtlas(breed, analysis) {
    const { info, bodies } = analysis, frames = {};
    const canvas = 314, baseline = 306, padding = 2;
    for (let index = 0; index < 16; index++) {
        const body = bodies.get(sourceFrame(breed, index));
        const x = Math.max(0, body.left - padding), y = Math.max(0, body.top - padding);
        const w = Math.min(info.width - 1, body.right + padding) - x + 1;
        const h = Math.min(info.height - 1, body.bottom + padding) - y + 1;
        if (w > canvas || h > baseline) throw Error(`${breed}: body exceeds virtual frame`);
        frames[index] = { frame: { x, y, w, h }, rotated: false, trimmed: true,
            spriteSourceSize: { x: Math.floor((canvas - w) / 2), y: baseline - h, w, h },
            sourceSize: { w: canvas, h: canvas } };
    }
    return { frames, meta: { image: `${breed}-sheet.png`, size: { w: info.width, h: info.height }, scale: '1' } };
}

async function main() {
    for (const breed of BREEDS) {
        const atlas = buildAtlas(breed, await analyzeSheet(breed));
        fs.writeFileSync(path.join(ROOT, 'assets/farm', `${breed}-sheet.json`), JSON.stringify(atlas, null, 2) + '\n');
        console.log(`${breed}: 16 complete body crops, aligned foot baseline`);
    }
}
module.exports = { analyzeSheet, buildAtlas, sourceFrame, BREEDS };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
