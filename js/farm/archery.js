import { equippedBow, equippedWeapon } from './combat-rules.js';
import { launchVelocity, arrowPoint, arrowHits } from './archery-core.js';

export class ArcheryControls {
    constructor(encounter) {
        this.encounter=encounter;this.scene=encounter.scene;this.arrows=[];this.selected=false;this.drag=null;this.nextShot=0;
        const s=this.scene;
        this.path=s.add.graphics().setDepth(37);
        this.bow=s.add.image(195,730,'shortbow').setDisplaySize(88,88).setDepth(38).setVisible(false).setInteractive({cursor:'grab'});
        this.button=s.add.image(195,666,'ui_wood').setDisplaySize(210,42).setDepth(38).setInteractive({cursor:'pointer'});
        this.label=s.add.text(195,666,'',{fontSize:'15px',color:'#fff2cc',fontStyle:'bold'}).setOrigin(.5).setDepth(39);
        this.help=s.add.text(195,786,'',{fontSize:'13px',color:'#fff2cc',backgroundColor:'#593b27',padding:5,align:'center'}).setOrigin(.5).setDepth(39);
        this.button.on('pointerdown',()=>{this.selected=!this.selected;this.cancel();this.refresh();});
        this.bow.on('pointerdown',pointer=>{
            if(!this.selected||!this.getBow()||this.encounter.result||s.time.now<this.nextShot||!this.ready())return;
            this.drag={id:pointer.id,origin:{x:this.bow.x,y:this.bow.y}};this.aim(pointer);
        });
        this.move=pointer=>{if(this.drag?.id===pointer.id)this.aim(pointer);};
        this.up=pointer=>{if(this.drag?.id===pointer.id)this.release(pointer);};
        this.out=()=>this.cancel();
        this.update=(_,delta)=>this.tick(delta);
        s.input.on('pointermove',this.move);s.input.on('pointerup',this.up);s.input.on('pointerupoutside',this.out);s.input.on('gameout',this.out);
        s.events.on('update',this.update);
        this.refresh();
    }
    ready(){return this.scene.registry.get('farmLoadState')?.phase==='ready';}
    getBow(){return equippedBow(this.scene.myFarmData||this.scene.farmData);}
    aim(pointer){
        const p=pointer.positionToCamera(this.scene.cameras.main);
        this.velocity=launchVelocity(this.drag.origin,p);this.path.clear();
        if(!this.velocity)return;
        this.bow.setRotation(Math.atan2(this.velocity.y,this.velocity.x));
        for(let t=0;t<1.5;t+=.055){const p=arrowPoint(this.drag.origin,this.velocity,t);this.path.fillStyle(0xffedb2,.8).fillCircle(p.x,p.y,2);}
    }
    cancel(){this.drag=null;this.velocity=null;this.path.clear();this.bow.setRotation(-Math.PI/2);}
    release(pointer){
        this.aim(pointer);const origin=this.drag.origin,velocity=this.velocity,bow=this.getBow();this.cancel();
        if(!velocity||!bow||!this.ready()||this.encounter.result)return;
        this.nextShot=this.scene.time.now+250;
        const image=this.scene.add.image(origin.x,origin.y,'arrow').setDisplaySize(44,10).setDepth(36);
        this.arrows.push({origin,velocity,weapon:bow,time:0,image,last:origin});
    }
    tick(delta){
        if(this.encounter.result){this.destroy();return;}
        this.refresh();
        for(let i=this.arrows.length-1;i>=0;i--){
            const a=this.arrows[i];a.time+=Math.max(0,delta)/1000;
            const p=arrowPoint(a.origin,a.velocity,a.time);
            a.image.setPosition(p.x,p.y).setRotation(Math.atan2(p.y-a.last.y,p.x-a.last.x));
            const hit=this.ready()&&arrowHits(a.last,p,this.encounter.sprite.getBounds());
            a.last=p;
            if(hit||a.time>2.5){a.image.destroy();this.arrows.splice(i,1);if(hit)this.encounter.arrowHit(a.weapon);if(this.encounter.result)break;}
        }
    }
    refresh(){
        const bow=this.getBow(),available=!!bow;
        if(!available&&this.selected){this.selected=false;this.cancel();}
        this.button.setVisible(available);this.label.setVisible(available);this.bow.setVisible(available&&this.selected);
        this.help.setText(available?(this.selected?'按住弓往後拉，放開射箭\n虛線為預估彈道，請預判飛行方向':'切換弓箭後，拖曳瞄準射擊'):'飛行怪物需弓箭！請先到倉庫配備。');
        this.label.setText(this.selected?`切換近戰：${equippedWeapon(this.scene.myFarmData||this.scene.farmData).name}`:`切換弓箭：${bow?.name||''}`);
        if(bow)this.bow.setTexture(bow.icon);
        this.encounter.rangedWeapon=this.selected?bow:null;
    }
    destroy(){
        if(this.destroyed)return;this.destroyed=true;
        const s=this.scene;s.input.off('pointermove',this.move);s.input.off('pointerup',this.up);s.input.off('pointerupoutside',this.out);s.input.off('gameout',this.out);s.events.off('update',this.update);
        this.arrows.forEach(a=>a.image.destroy());this.arrows=[];
        [this.path,this.bow,this.button,this.label,this.help].forEach(o=>o.destroy());
    }
}
