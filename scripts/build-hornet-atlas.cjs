// Derive atlas metadata only; the supplied/cleaned PNG pixels are never repainted.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {data,info}=await sharp(path.join(root,'assets/farm/hornet-sheet.png')).raw().toBuffer({resolveWithObject:true});
 const rowBounds=[0,209,369,532,693,854,1029,info.height],frames={};
 for(let row=0;row<7;row++){
  const y0=rowBounds[row],y1=rowBounds[row+1],projection=Array(info.width).fill(0);
  for(let y=y0;y<y1;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>128)projection[x]++;
  const groups=[];for(let x=0;x<info.width;x++)if(projection[x]>5){const prev=groups.at(-1);if(prev&&x-prev.right<=13)prev.right=x;else groups.push({left:x,right:x});}
  const sprites=groups.filter(g=>g.right-g.left>30);if(sprites.length!==8)throw Error(`Row ${row} has ${sprites.length} sprite columns`);
  for(let col=0;col<8;col++){
   const left=col?Math.floor((sprites[col-1].right+sprites[col].left)/2):0,right=col<7?Math.floor((sprites[col].right+sprites[col+1].left)/2):info.width;
   let minX=right,maxX=left,minY=y1,maxY=y0;
   for(let y=y0;y<y1;y++)for(let x=left;x<right;x++)if(data[(y*info.width+x)*4+3]>128){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
   const x=Math.max(left,minX-8),y=Math.max(y0,minY-8),w=Math.min(right,maxX+9)-x,h=Math.min(y1,maxY+9)-y;
   if(w>200||h>200)throw Error('Sprite exceeds common frame');
   frames[String(row*8+col)]={frame:{x,y,w,h},rotated:false,trimmed:true,spriteSourceSize:{x:Math.floor((200-w)/2),y:Math.floor((200-h)/2),w,h},sourceSize:{w:200,h:200}};
  }
 }
 fs.writeFileSync(path.join(root,'assets/farm/hornet-sheet.json'),JSON.stringify({frames,meta:{image:'hornet-sheet.png',size:{w:info.width,h:info.height},scale:'1',note:'Chat composite cleaned to transparent PNG; 8x7 action families, common 200px virtual frames.'}},null,2)+'\n');console.log('Hornet atlas: 56 complete padded frames');
})().catch(error=>{console.error(error);process.exitCode=1;});
