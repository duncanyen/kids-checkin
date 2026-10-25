const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSheet, buildAtlas, sourceFrame, BREEDS } = require('../scripts/build-poultry-atlases.cjs');

for (const breed of BREEDS) test(`${breed}: every animation crop contains one whole chicken and no adjacent parts`, async () => {
    const analysis = await analyzeSheet(breed);
    const atlas = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/farm', `${breed}-sheet.json`)));
    assert.deepEqual(atlas, buildAtlas(breed, analysis), 'Committed metadata matches detected body crops');
    for (let index = 0; index < 16; index++) {
        const { frame: f, spriteSourceSize: trim, sourceSize: size } = atlas.frames[index];
        const body = analysis.bodies.get(sourceFrame(breed, index));
        assert.ok(f.x <= body.left && f.y <= body.top && f.x + f.w > body.right && f.y + f.h > body.bottom, `${index}: clipped feet/comb/body`);
        assert.equal(size.w, 314); assert.equal(size.h, 314);
        assert.equal(trim.y + trim.h, 306, 'Stable feet while the pose changes');
        assert.ok(trim.x >= 0 && trim.y >= 0 && trim.x + trim.w <= size.w && trim.y + trim.h <= size.h);
        const foreign = new Set();
        for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) {
            const id = analysis.labels[y * analysis.info.width + x];
            if (id >= 0 && id !== body.id && analysis.components[id].area > 1) foreign.add(id);
        }
        assert.deepEqual([...foreign], [], `${index}: floating feathers or another chicken leaked into crop`);
    }
});
