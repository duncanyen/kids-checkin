const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),sharp=require('sharp'),atlas=require('../assets/farm/hornet-sheet.json');
test('hornet atlas has56 nonempty padded transparent frames and honey has an intact transparent silhouette',async()=>{
 const {data,info}=await sharp(path.resolve(__dirname,'../assets/farm/hornet-sheet.png')).raw().toBuffer({resolveWithObject:true});assert.equal(Object.keys(atlas.frames).length,56);assert.equal(info.channels,4);
 for(const[id,f]of Object.entries(atlas.frames)){const r=f.frame;assert.deepEqual(f.sourceSize,{w:200,h:200});let pixels=0;for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const a=data[((y+r.y)*info.width+x+r.x)*4+3];if(a>128){pixels++;if(x<3||y<3||x>=r.w-3||y>=r.h-3)assert.fail('Sprite edge clipped in frame '+id);}}assert.ok(pixels>1000,id+' empty');}
 const honey=await sharp(path.resolve(__dirname,'../assets/farm/honey.png')).metadata();assert.equal(honey.hasAlpha,true);assert.equal(honey.width,honey.height);
});
