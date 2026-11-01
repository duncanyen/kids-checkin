const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),sharp=require('sharp'),path=require('node:path');
test('64 cobra poses have transparent gutters, stable ground anchors and no empty frames',async()=>{
 const root=path.resolve(__dirname,'../assets/farm'),atlas=JSON.parse(fs.readFileSync(path.join(root,'cobra-sheet.json')));
 const {data,info}=await sharp(path.join(root,'cobra-sheet.png')).raw().toBuffer({resolveWithObject:true});
 assert.equal(Object.keys(atlas.frames).length,64);
 for(const [id,{frame:r}]of Object.entries(atlas.frames)){
  let opaque=0,last=0;
  for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){
   const alpha=data[((y+r.y)*info.width+x+r.x)*4+3];
   if(x<8||x>=r.w-8||y<8||y>=r.h-8)assert.equal(alpha,0,'Frame '+id+' must not bleed across boundaries');
   if(alpha>128){opaque++;last=y;}
  }
  assert.ok(opaque>2000);assert.ok(last>=219&&last<=224,'Feet must share a ground pivot');
 }
});
test('cobra fang is a complete transparent inventory icon',async()=>{
 const {data,info}=await sharp(path.resolve(__dirname,'../assets/farm/cobra-fang.png')).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,128);assert.equal(info.height,128);let opaque=0;
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const alpha=data[(y*128+x)*4+3];if(x<8||x>=120||y<8||y>=120)assert.equal(alpha,0);if(alpha>128)opaque++;
 }
 assert.ok(opaque>1500);
});
