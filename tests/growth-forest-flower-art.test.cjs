const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');

test('flower sprites cover the catalog and keep five distinct transparent stages on a shared ground anchor',async()=>{
 const {PLANT_TYPES,art}=await import('../js/growth-forest/art.js'),catalog=require('../functions/growth-domain.cjs').PLANTS;
 assert.deepEqual(PLANT_TYPES,Object.keys(catalog));
 for(const type of ['rose','daffodil','lavender']){
  const hashes=new Set();let previousTop=240;
  for(let level=1;level<=5;level++){
   const file=path.resolve(__dirname,'..',art.plants[type][level-1]),svg=fs.readFileSync(file,'utf8');hashes.add(svg);
   assert.match(svg,/viewBox="0 0 200 240"/);assert.match(svg,/<ellipse cx="100" cy="203" rx="31" ry="6"/);assert.doesNotMatch(svg,/<(?:image|script|foreignObject)\b|https?:\/\/(?!www.w3.org)/);
   const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,200);assert.equal(info.height,240);
   let left=200,right=0,top=240,bottom=0,pixels=0;
   for(let y=0;y<240;y++)for(let x=0;x<200;x++)if(data[(y*200+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);pixels++;}
   assert.ok(pixels>300,`${type} Lv.${level} must not be empty`);assert.ok(left>=8&&right<=191&&top>=8&&bottom<=210,`${type} Lv.${level} transparent gutters`);assert.ok(top<previousTop,`${type} stage silhouette must visibly grow`);previousTop=top;
  }
  assert.equal(hashes.size,5);
 }
});
