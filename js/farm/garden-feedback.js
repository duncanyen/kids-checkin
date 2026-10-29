import { onSceneExit } from './scene-cleanup.js';
const ITEMS = {
    worms: { name: '菜蟲', ink: '#44652c' },
    earthworms: { name: '蚯蚓', ink: '#995c45' },
};

// Share the same painted item art as the warehouse and shop.
function drawMascot(scene, type) {
    return scene.add.image(0, 0, type === 'worms' ? 'worm' : 'earthworm').setDisplaySize(66, 66);
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
        const mascot=drawMascot(scene,type).setPosition(-103,0);
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
