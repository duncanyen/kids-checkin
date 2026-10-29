const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sharp = require('sharp');
const { createHash } = require('node:crypto');

test('painted inventory items are distinct complete icons with transparent padding', async () => {
    const names = ['egg', 'silkie-egg', 'bresse-egg', 'coin', 'worm', 'earthworm', 'wolf-fang', 'tiger-pelt'];
    const hashes = new Set();
    for (const name of names) {
        const { data, info } = await sharp(path.join(__dirname, '../assets/farm', `${name}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.width, 128);
        assert.equal(info.height, 128);
        let visible = 0;
        for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
            const alpha = data[(y * info.width + x) * 4 + 3];
            if (x < 8 || x >= 120 || y < 8 || y >= 120) assert.equal(alpha, 0, `${name}: artwork must not touch the cell edge`);
            if (alpha > 128) visible++;
        }
        assert.ok(visible > 1500, `${name}: complete object must remain visible at inventory size`);
        hashes.add(createHash('sha256').update(data).digest('hex'));
    }
    assert.equal(hashes.size, names.length, 'each item, including the three egg breeds, needs its own art');
});
