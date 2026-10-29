const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

for (const kind of ['tiger', 'wolf']) test(`${kind} atlas isolates all animation frames with transparent sampling gutters`, async () => {
    const root = path.resolve(__dirname, '../assets/farm');
    const atlas = JSON.parse(fs.readFileSync(path.join(root, `${kind}-sheet.json`)));
    const { data, info } = await sharp(path.join(root, `${kind}-sheet.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(Object.keys(atlas.frames).length, 16);
    for (const { frame: r } of Object.values(atlas.frames)) {
        let opaque = 0;
        for (let y = r.y - 2; y < r.y + r.h + 2; y++) {
            for (let x = r.x - 2; x < r.x + r.w + 2; x++) {
                const alpha = data[(y * info.width + x) * 4 + 3];
                const edge = x < r.x + 4 || x >= r.x + r.w - 4 || y < r.y + 4 || y >= r.y + r.h - 4;
                if (edge) assert.equal(alpha, 0, 'neighboring frames must not bleed into the sprite');
                if (alpha > 128) opaque++;
            }
        }
        assert.ok(opaque > 1000, 'every frame must contain a complete visible animal');
    }
});

test('gorilla frames omit previous-row pixels while retaining their ground pivots', async () => {
    const root = path.resolve(__dirname, '../assets/farm');
    const atlas = JSON.parse(fs.readFileSync(path.join(root, 'gorilla-sheet.json')));
    const { data, info } = await sharp(path.join(root, 'gorilla-sheet.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const { frame: r, pivot, sourceSize, spriteSourceSize: s } of Object.values(atlas.frames)) {
        assert.equal(sourceSize.w, 314);
        assert.equal(pivot.x, 0.5);
        assert.ok(pivot.y >= 0.8 && pivot.y <= 1);
        assert.ok(s.y + s.h <= sourceSize.h);
        for (let y = r.y; y < r.y + 4; y++) {
            for (let x = r.x; x < r.x + r.w; x++) {
                assert.ok(data[(y * info.width + x) * 4 + 3] <= 32, 'stray feet from the previous row must be outside this frame');
            }
        }
    }
});
