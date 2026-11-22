const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),sharp=require('sharp');
test('katana is a complete transparent square painted icon with padded blade tip and grip',async()=>{
 const {data,info}=await sharp(path.resolve(__dirname,'../assets/farm/katana.png')).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,info.height);assert.equal(info.channels,4);assert.ok(info.width>=512);let visible=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const alpha=data[(y*info.width+x)*4+3];if(x<8||y<8||x>=info.width-8||y>=info.height-8)assert.equal(alpha,0,'full transparent outer padding');if(alpha>128)visible++;}
 assert.ok(visible>info.width*info.height*.05);assert.ok(visible<info.width*info.height*.6);
});
