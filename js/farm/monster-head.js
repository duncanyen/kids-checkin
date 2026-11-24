// Frame-local alpha bounds are cached; transparent atlas padding is not a head.
const heads=new WeakMap();
let canvas,context;
function frameHead(frame){
 if(heads.has(frame))return heads.get(frame);
 let head={x:frame.x+frame.width/2,y:frame.y};
 try{
  canvas||=document.createElement('canvas');context||=canvas.getContext('2d',{willReadFrequently:true});
  canvas.width=frame.cutWidth;canvas.height=frame.cutHeight;
  context.drawImage(frame.source.image,frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight,0,0,canvas.width,canvas.height);
  const {data,width,height}=context.getImageData(0,0,canvas.width,canvas.height);
  let top=height,left=width,right=-1;
  for(let y=0;y<height&&top===height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>=32){top=y;break;}
  if(top<height){
   const end=Math.min(height,top+Math.max(2,Math.ceil(height*.12)));
   for(let y=top;y<end;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>=32){left=Math.min(left,x);right=Math.max(right,x);}
   head={x:frame.x+(left+right)/2,y:frame.y+top};
  }
 }catch{} // Cross-origin or unavailable canvas: use the atlas trim bounds.
 heads.set(frame,head);return head;
}
export function monsterHead(sprite){
 const frame=sprite.frame,head=frameHead(frame);
 const x=(sprite.flipX?frame.realWidth-head.x:head.x)-sprite.displayOriginX;
 const y=(sprite.flipY?frame.realHeight-head.y:head.y)-sprite.displayOriginY;
 return sprite.getWorldTransformMatrix().transformPoint(x,y);
}
// CSS cm uses 96px/in; physical size varies by device. Keep the visual gap
// approximately 0.3cm on screen even when the game camera zoom changes.
export function screenUnits(scene,pixels){
 const rect=scene.game.canvas.getBoundingClientRect();
 return pixels*scene.scale.width/Math.max(1,rect.width)/scene.cameras.main.zoom;
}
