// Original development artwork, authored as replaceable SVG sprites. No downloads.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../assets/growth-forest');fs.mkdirSync(root,{recursive:true});
const leaf=(x,y,flip=false)=>`<path d="M${x} ${y}q${flip?-46:46} -36 ${flip?-38:38} 0q${flip?12:-12} 15 ${flip?38:-38} 0" fill="#679c60" stroke="#3c7150" stroke-width="2"/>`;
for(const type of ['sunflower','tulip','sakura'])for(let stage=1;stage<=5;stage++){
 let art='';const stemY=[186,176,143,108,72][stage-1];
 if(stage===1)art='<ellipse cx="100" cy="188" rx="10" ry="6" fill="#8b613e" stroke="#553d32" stroke-width="2"/><path d="m95 186 8 4" stroke="#cfa777"/>';
 else{
  art+=`<path d="M100 198Q${stage<4?86:109} 160 100 ${stemY}" fill="none" stroke="${type==='sakura'&&stage>3?'#845b4b':'#46754e'}" stroke-width="${type==='sakura'&&stage>3?11:6}" stroke-linecap="round"/>`;
  art+=leaf(100,stage===2?182:163)+leaf(99,stage===2?179:143,true);
  if(stage>=3)art+=leaf(101,183,true);
  if(type==='sunflower'&&stage>=4){
   art+=`<g transform="translate(100 ${stemY})">`;
   for(let p=0;p<12;p++)art+=`<ellipse cy="-${stage===5?25:15}" rx="${stage===5?10:6}" ry="${stage===5?25:16}" transform="rotate(${p*30})" fill="${p%2?'#f5c85b':'#f8d96f'}" stroke="#d7a346" stroke-width="1.3"/>`;
   art+=`<circle r="${stage===5?24:13}" fill="#986846" stroke="#745238" stroke-width="3"/>`;
   for(let k=0;k<13;k++)art+=`<circle cx="${Math.sin(k*2.4)*Math.sqrt(k)*5}" cy="${Math.cos(k*2.4)*Math.sqrt(k)*5}" r="2" fill="#d4aa68"/>`;art+='</g>';
  }
  if(type==='tulip'&&stage>=4)art+=`<path d="M100 ${stemY+27}Q${stage===5?56:73} ${stemY+16} 77 ${stemY-25}L94 ${stemY-11}L103 ${stemY-32}L114 ${stemY-11}L129 ${stemY-25}Q139 ${stemY+25} 100 ${stemY+27}" fill="${stage===5?'#df8097':'#c98296'}" stroke="#b76882" stroke-width="3"/><path d="M100 ${stemY+22}Q87 ${stemY} 94 ${stemY-11}" fill="none" stroke="#f5b8c4" stroke-width="4"/>`;
  if(type==='sakura'&&stage>=3){
   art+=`<path d="M100 155 68 ${stemY+8}M103 136 137 ${stemY-3}" stroke="#845b4b" stroke-width="${stage>=4?6:3}" stroke-linecap="round"/>`;
   for(const [cx,cy,r]of [[71,stemY,stage===5?39:20],[130,stemY-8,stage===5?43:23],[99,stemY-31,stage===5?47:24]]){
    art+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${stage===5?'#edb3bf':'#8faf79'}"/>`;
    if(stage>=4)for(let n=0;n<(stage===5?14:3);n++){const x=cx+Math.sin(n*2.4)*r*.7,y=cy+Math.cos(n*2.4)*r*.7;art+=`<g transform="translate(${x} ${y})">`;for(let p=0;p<5;p++)art+=`<ellipse cy="-4" rx="3.6" ry="5.5" transform="rotate(${p*72})" fill="#ffe0e5"/>`;art+='<circle r="2" fill="#d6a15b"/></g>';}
   }
  }
 }
 fs.writeFileSync(path.join(root,`${type}-${stage}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240" viewBox="0 0 200 240"><ellipse cx="100" cy="203" rx="31" ry="6" fill="#35563d" opacity=".13"/>${art}</svg>`);
}

require('./build-growth-flower-art.cjs');
