import { BossEncounter } from './dragon.js';
import { MOLE_CONFIG, moleCells, moleDue } from './mole-rules.js';
import { claimMoleEncounter, settleMoleEncounter } from './mole-store.js';
import { ensureAssets } from './assets.js';

export function otherMonsterActive(scene) {
    return scene.preparingCobra || scene.preparingEncounter || (scene.sys.settings.key === 'VisitScene' && !scene.hasRolledEncounter) ||
        ['cobraEncounter','eagleEncounter','dragonEncounter','gorillaEncounter'].some(key => scene[key] && !scene[key].destroyed && !scene[key].settled) ||
        ['wolf','tiger'].some(key => scene[key]?.active && !scene[key].getData('resolved'));
}
export const moleBlocksGarden = scene => scene.preparingMole || !!(scene.moleEncounter && !scene.moleEncounter.destroyed && !scene.moleEncounter.settled);
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
            key:'mole', name:'菜園地鼠', size:Math.min(first.width*.95,first.height*1.25),frameSize:314,
            config:{...MOLE_CONFIG,durationMs:Math.max(1,challenge.deadline-Date.now())},
            travel:'walk',attack:'idle',attackPhase:'garden',movingLabel:'鑽出菜園',attackLabel:'只限近戰・抓蟲暫停',
            reward:'地瓜',salePrice:300,settle:settleMoleEncounter,lossText:'地鼠鑽回地底，挑戰失敗！',
            spawnPoint:()=>first,destination:()=>first
        });
        this.id=challenge.id;this.deadline=challenge.deadline;
        this.sprite.setOrigin(.5,1);
        this.sprite.on('animationcomplete', animation => {
            if (!this.result && ['mole_walk','mole_angry'].includes(animation.key)) this.sprite.play('mole_idle');
        });
        this.grid=scene.add.graphics().setDepth(23);
        this.cell=-1;this.nextMove=0;
        this.motion=()=>this.moveInGarden();scene.events.on('update',this.motion);
        this.moveInGarden();
    }
    startFire() {
        if(this.destroyed || this.result)return;
        this.flight.stop();this.phase='garden';this.sprite.play('mole_idle');this.refresh();
    }
    moveInGarden() {
        if(this.destroyed || this.result)return;
        if(Date.now()>=this.deadline){this.resolve('loss');return;}
        if (this.deadline-Date.now()<10000 && this.sprite.anims.currentAnim?.key === 'mole_idle') this.sprite.play('mole_angry');
        const cells=moleCells(this.scene.gardenBounds);
        this.grid.clear().lineStyle(1,0xffe2a0,.7).fillStyle(0x49301e,.16);
        for(const c of cells) this.grid.fillRect(c.x-c.width/2,c.y-c.height/2,c.width,c.height).strokeRect(c.x-c.width/2,c.y-c.height/2,c.width,c.height);
        if(Date.now()>=this.nextMove) {
            // Choose any other cell, keep each exposure long enough for rapid taps.
            this.cell=(this.cell+1+Phaser.Math.Between(0,10))%12;
            this.nextMove=Date.now()+1400;
            if(this.phase==='garden')this.sprite.play('mole_walk');
        }
        const c=cells[this.cell];
        this.sprite.setPosition(c.x,c.y+c.height*.45).setDisplaySize(c.width*.95,c.height*1.35);
    }
    resolve(outcome) {
        if (this.destroyed || this.result) return;
        super.resolve(outcome);
        this.grid?.setVisible(false);
        if (outcome === 'loss') {
            // Moles burrow at their current hole; the generic boss escape
            // travels offscreen, which would leave the vegetable garden.
            this.scene.tweens.killTweensOf(this.sprite);
            this.sprite.play('mole_burrow');
            this.scene.tweens.add({targets:this.sprite,alpha:0,duration:700,delay:300});
        }
    }
    destroy() {
        this.scene.events.off('update',this.motion);this.grid?.destroy();super.destroy();
    }
}
