const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const path = require('node:path');

test('paladin bow is a complete transparent sprite with safe padding for inventory and aiming', async () => {
    const {data, info} = await sharp(path.join(__dirname, '../assets/farm/paladinbow.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,320);assert.equal(info.height,320);
    let visible=0;
    for(let y=0;y<320;y++)for(let x=0;x<320;x++){
        const alpha=data[(y*320+x)*4+3];
        if(x<18||x>=302||y<18||y>=302)assert.equal(alpha,0,'bow or arrow reaches texture edge');
        if(alpha>128)visible++;
    }
    assert.ok(visible>8000,'bow remains visible at inventory size');
    assert.ok(visible<60000,'transparent negative space around bow and string');
});
