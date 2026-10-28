import { onSceneExit } from './scene-cleanup.js';
const ITEMS = {
    worms: { name: '菜蟲', body: 0x9ecb58, light: 0xdaec9c, edge: 0x486a32, ink: '#44652c' },
    earthworms: { name: '蚯蚓', body: 0xde9a87, light: 0xffd4b5, edge: 0x855244, ink: '#995c45' },
};

// Original vector mascots: rounded ink outlines, soft segments and small faces.
function drawMascot(scene, type) {
    const style = ITEMS[type], g = scene.add.graphics();
    const points = type === 'worms' ? [[-26,9],[-18,5],[-9,7],[0,4],[9,0],[18,-6]] : [[-27,12],[-21,4],[-13,0],[-5,3],[3,3],[11,-4],[19,-10]];
    for (const [x,y] of points) g.fillStyle(style.edge).fillCircle(x,y,8.5);
    points.forEach(([x,y],i) => {
        g.fillStyle(style.body).fillCircle(x,y,6.5);
        g.fillStyle(style.light,.7).fillEllipse(x-1,y-3,7,3);
        if (type === 'earthworms' && i > 0 && i < 5) g.lineStyle(1,style.edge,.4).lineBetween(x+3,y-4,x+4,y+4);
        if (type === 'worms' && i < 4) g.fillStyle(style.edge).fillEllipse(x-1,y+7,4,3);
    });
    const [x,y] = points.at(-1);
    if (type === 'worms') {
        g.lineStyle(2,style.edge).lineBetween(x-3,y-8,x-8,y-17).lineBetween(x+5,y-8,x+8,y-18);
        g.fillStyle(style.body).fillCircle(x-8,y-17,3).fillCircle(x+8,y-18,3);
    }
    g.fillStyle(style.edge).fillEllipse(x,y,23,22);
    g.fillStyle(style.body).fillEllipse(x,y-1,19,18);
    g.fillStyle(0xfff8df).fillEllipse(x-4,y-3,5,7).fillEllipse(x+4,y-3,5,7);
    g.fillStyle(0x40352d).fillCircle(x-3,y-3,1.6).fillCircle(x+5,y-3,1.6);
    g.fillStyle(0xf29680,.7).fillEllipse(x-7,y+2,4,2).fillEllipse(x+7,y+2,4,2);
    g.lineStyle(1.4,style.edge).beginPath().arc(x+1,y+1,3,0,Math.PI).strokePath();
    return g;
}

function star(graphics, color) {
    const points = Array.from({length:10},(_,i)=>({x:Math.cos(i*Math.PI/5-Math.PI/2)*(i%2?2:5),y:Math.sin(i*Math.PI/5-Math.PI/2)*(i%2?2:5)}));
    graphics.fillStyle(color).fillPoints(points,true);
}

export class GardenFeedback {
    constructor(scene) {
        this.scene = scene; this.alive = true; this.queue = []; this.busy = false; this.roots = new Set();
        onSceneExit(scene, () => {
            this.alive = false; this.queue = [];
            [...this.roots].forEach(root=>this.remove(root));
        });
    }
    remove(root) {
        if (!this.roots.has(root)) return;
        const stop = object => { this.scene.tweens.killTweensOf(object); object.list?.forEach(stop); };
        stop(root); this.roots.delete(root); root.destroy(true);
    }
    show(type, x, y) {
        if (!this.alive || !ITEMS[type]) return;
        this.burst(x,y);
        // Coalesce rapid finds into at most two queued cards, without losing counts.
        const queued = this.queue.find(item=>item.type===type);
        if (queued) queued.count++; else this.queue.push({type,count:1});
        this.next();
    }
    burst(x,y) {
        const scene=this.scene, root=scene.add.container(x,y).setDepth(44);
        this.roots.add(root);
        const ring=scene.add.graphics().lineStyle(3,0xffe6a2,.9).strokeEllipse(0,0,38,22);
        root.add(ring);
        scene.tweens.add({targets:ring,scaleX:2.6,scaleY:2.6,alpha:0,duration:500,ease:'Sine.Out'});
        for(let i=0;i<8;i++){
            const sparkle=scene.add.graphics();star(sparkle,i%2?0xffe4a0:0xc8df86);root.add(sparkle);
            const angle=(Math.PI*2*i/8)-Math.PI/2;
            scene.tweens.add({targets:sparkle,x:Math.cos(angle)*34,y:Math.sin(angle)*25-16,angle:i%2?90:-90,alpha:0,duration:620,ease:'Cubic.Out'});
        }
        scene.time.delayedCall(650,()=>this.remove(root));
    }
    next() {
        if (!this.alive || this.busy || !this.queue.length) return;
        this.busy=true;
        const {type,count}=this.queue.shift(), style=ITEMS[type], scene=this.scene;
        const card=scene.add.container(195,844*.55+18).setDepth(45).setAlpha(0).setScale(.8);
        card.setData('gardenFind',{type,count}); this.roots.add(card);
        const shadow=scene.add.graphics().fillStyle(0x3d321f,.2).fillRoundedRect(-147,-48,300,112,18);
        const paper=scene.add.image(0,0,'ui_parchment').setDisplaySize(308,120);
        const badge=scene.add.graphics().fillStyle(0xfff7d9,.95).fillCircle(-103,0,37).lineStyle(2,0xccad65,.8).strokeCircle(-103,0,37);
        const mascot=drawMascot(scene,type).setPosition(-103,0).setScale(1.05);
        const textStyle={fontFamily:'system-ui, sans-serif',color:'#74542f'};
        const eyebrow=scene.add.text(-53,-35,'菜園小驚喜',{...textStyle,fontSize:'11px'});
        const title=scene.add.text(-53,-16,`抓到${style.name}！`,{...textStyle,fontSize:'20px',fontStyle:'bold',color:style.ink});
        const subtitle=scene.add.text(-53,21,'已收入你的倉庫',{...textStyle,fontSize:'11px'});
        const amount=scene.add.text(121,-8,`+${count}`,{...textStyle,fontSize:'25px',fontStyle:'bold',color:style.ink}).setOrigin(1,0);
        card.add([shadow,paper,badge,mascot,eyebrow,title,subtitle,amount]);
        scene.tweens.add({targets:mascot,y:-5,angle:5,duration:260,yoyo:true,repeat:2,ease:'Sine.InOut'});
        scene.tweens.add({targets:card,y:844*.55,alpha:1,scaleX:1,scaleY:1,duration:340,ease:'Back.Out',onComplete:()=>{
            if(!this.alive)return;
            scene.time.delayedCall(1250,()=>{
                if(!this.alive)return;
                scene.tweens.add({targets:card,y:card.y-16,alpha:0,duration:240,ease:'Sine.In',onComplete:()=>{
                    this.remove(card);this.busy=false;this.next();
                }});
            });
        }});
    }
}
