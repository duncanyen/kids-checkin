import { BossEncounter } from './dragon.js';
import { MOLE_CONFIG, moleCells, moleDue, nextMoleCells } from './mole-rules.js';
import { claimMoleEncounter, settleMoleEncounter } from './mole-store.js';
import { ensureAssets } from './assets.js';

export function otherMonsterActive(scene) {
    return scene.preparingGiant || scene.preparingCobra || scene.preparingEncounter || (scene.sys.settings.key === 'VisitScene' && !scene.hasRolledEncounter) ||
        ['giantEncounter','cobraEncounter','eagleEncounter','dragonEncounter','gorillaEncounter'].some(key => scene[key] && !scene[key].destroyed && !scene[key].settled) ||
        ['wolf','tiger'].some(key => scene[key]?.active && !scene[key].getData('resolved'));
}
export const moleBlocksGarden = scene => scene.preparingGiant || !!(scene.giantEncounter && !scene.giantEncounter.destroyed && !scene.giantEncounter.settled) || scene.preparingMole || !!(scene.moleEncounter && !scene.moleEncounter.destroyed && !scene.moleEncounter.settled);
export async function maybeStartMole(scene) {
    if (moleBlocksGarden(scene)) return true;
    if (otherMonsterActive(scene) || !moleDue(scene.myFarmData || scene.farmData)) return false;
    const token = scene.farmSceneToken || scene.visitToken;
    const active = () => scene.sys.isActive() && token === (scene.farmSceneToken || scene.visitToken);
    scene.preparingMole = true;
    try {
        await ensureAssets(scene,['mole','sweet_potato','ironhammer','mace','battleaxe']);
        if (!active()) return true;
        if (otherMonsterActive(scene)) return false;
        const claim = await claimMoleEncounter(scene.targetAccountId,scene.targetGroupId);
        if (!active()) return true;
        if (!claim) return false;
        if (claim.expired) {
            scene.showFloatingText(`上一場地鼠挑戰逾時，扣除 ${claim.result.coinsLost} 金幣`,'#FFD54F',16);
            return true;
        }
        scene.moleEncounter?.destroy();
        scene.moleEncounter = new MoleEncounter(scene,claim.challenge);
        return true;
    } catch (error) {
        console.warn('地鼠挑戰未能開始',error);
        if (active()) scene.showFloatingText('地鼠準備失敗，請再點菜園重試','#FFD54F',14);
        return true;
    } finally { if (active()) scene.preparingMole = false; }
}

export class MoleEncounter extends BossEncounter {
    constructor(scene, challenge) {
        const first = moleCells(scene.gardenBounds)[0];
        super(scene, {
            key:'mole', name:'菜園地鼠 ×3', size:Math.min(first.width*.95,first.height*1.25),frameSize:314,
            config:{...MOLE_CONFIG,durationMs:Math.max(1,challenge.deadline-Date.now())},
            travel:'walk',attack:'idle',attackPhase:'garden',movingLabel:'鑽出菜園',attackLabel:'累計命中・抓蟲暫停',
            reward:'地瓜',salePrice:300,settle:settleMoleEncounter,lossText:'地鼠鑽回地底，挑戰失敗！',
            spawnPoint:()=>first,destination:()=>first
        });
        this.id=challenge.id;this.deadline=challenge.deadline;
        this.moles=[this.sprite];
        for (let i=1;i<3;i++) {
            const sprite=scene.add.sprite(first.x,first.y,'mole','0').setDepth(25)
                .setInteractive({cursor:'pointer',hitArea:new Phaser.Geom.Rectangle(12,12,290,290),hitAreaCallback:Phaser.Geom.Rectangle.Contains});
            sprite.on('pointerdown',pointer=>this.hit(pointer,sprite));
            this.moles.push(sprite);
        }
        for (const sprite of this.moles) {
            sprite.setOrigin(.5,1).play('mole_walk');
            sprite.on('animationcomplete', animation => {
                if (!this.result && ['mole_walk','mole_angry','mole_hit'].includes(animation.key)) sprite.play('mole_idle');
            });
        }
        this.cell=-1;this.cells=[];this.nextMove=0;
        this.motion=()=>this.moveInGarden();scene.events.on('update',this.motion);
        this.moveInGarden();
    }
    startFire() {
        if(this.destroyed || this.result)return;
        this.flight.stop();this.phase='garden';
        for (const sprite of this.moles) sprite.play('mole_idle');
        this.refresh();
    }
    moveInGarden() {
        if(this.destroyed || this.result)return;
        if(Date.now()>=this.deadline){this.resolve('loss');return;}
        for (const sprite of this.moles) {
            if (this.deadline-Date.now()<10000 && sprite.anims.currentAnim?.key === 'mole_idle') sprite.play('mole_angry');
        }
        const cells=moleCells(this.scene.gardenBounds);
        if(Date.now()>=this.nextMove) {
            this.cells=nextMoleCells(this.cells);
            this.cell=this.cells[0];
            this.nextMove=Date.now()+1400;
            if(this.phase==='garden')for (const sprite of this.moles) sprite.play('mole_walk');
        }
        this.moles.forEach((sprite,i)=>{
            const c=cells[this.cells[i]];
            sprite.setPosition(c.x,c.y+c.height*.45).setDisplaySize(c.width*.95,c.height*1.35);
        });
    }
    hit(pointer, sprite = this.sprite) {
        if (this.destroyed || this.result || !this.moles.includes(sprite)) return;
        if (this.expired()) { this.resolve('loss');return; }
        this.health=Math.max(0,this.health-this.damage);
        sprite.play('mole_hit');
        this.scene.tweens.killTweensOf(this.weaponSprite);
        this.weaponSprite.setPosition(pointer?.x ?? sprite.x+35,pointer?.y ?? sprite.y-40).setAngle(-45).setVisible(true);
        this.scene.tweens.add({targets:this.weaponSprite,angle:45,duration:55,yoyo:true,onComplete:()=>this.weaponSprite.setVisible(false)});
        if (!this.health) this.resolve('win');else this.refresh();
    }
    resolve(outcome) {
        if (this.destroyed || this.result) return;
        super.resolve(outcome);
        for (const sprite of this.moles) {
            sprite.disableInteractive().setData('resolved',true);
            // All three finish together at their holes, with one settlement.
            this.scene.tweens.killTweensOf(sprite);
            sprite.play(outcome==='win' ? 'mole_dead' : 'mole_burrow');
            this.scene.tweens.add({targets:sprite,alpha:0,duration:700,delay:outcome==='win'?850:300});
        }
    }
    destroy() {
        if (this.destroyed) return;
        this.scene.events.off('update',this.motion);
        for (const sprite of this.moles.slice(1)) {this.scene.tweens.killTweensOf(sprite);sprite.destroy();}
        super.destroy();
    }
}
