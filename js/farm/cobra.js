import { BossEncounter } from './dragon.js';
import { COBRA_CONFIG, COBRA_FANG_PRICE } from './cobra-rules.js';
import { settleCobraEncounter } from './cobra-store.js';
import { predatorPatrolArea } from './predators.js';
import { farmView } from './viewport.js';

export function registerCobraAnimations(scene) {
    if (!scene.textures.exists('cobra')) return;
    const actions = ['idle', 'walk', 'back', 'poison', 'sweep', 'hit', 'stun', 'dead'];
    for (const [row, action] of actions.entries()) {
        const key = 'cobra_' + action;
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
            key, frames: Array.from({ length: 8 }, (_, i) => ({ key: 'cobra', frame: row * 8 + i })),
            frameRate: action === 'hit' ? 18 : 10,
            repeat: ['idle', 'walk', 'back', 'stun'].includes(action) ? -1 : 0
        });
    }
}

export class CobraEncounter extends BossEncounter {
    constructor(scene, challenge) {
        const area = predatorPatrolArea(scene), view = farmView(scene), now = Date.now();
        super(scene, {
            key: 'cobra', archery: true, name: '毒牙眼鏡蛇王', size: COBRA_CONFIG.size, frameSize: 256,
            config: {
                ...COBRA_CONFIG,
                flightMs: Math.max(0, challenge.approachEndsAt - now),
                durationMs: Math.max(1, challenge.deadline - now)
            },
            travel: 'walk', attack: 'poison', attackPhase: 'patrol',
            movingLabel: '向雞舍爬行中', attackLabel: '巡行威嚇中',
            reward: '眼鏡蛇王毒牙', salePrice: COBRA_FANG_PRICE, settle: settleCobraEncounter,
            lossText: '挑戰失敗，毒牙眼鏡蛇王離開了！', approachEase: 'Linear',
            spawnPoint: () => ({ x: view.left + view.width + 80, y: area.y }),
            destination: () => ({ x: (area.left + area.right) / 2, y: area.y })
        });
        this.id = challenge.id;
        this.deadline = challenge.deadline;
        this.approachEndsAt = challenge.approachEndsAt;
        this.sprite.setFlipX(true);
        this.motion = () => this.patrol();
        scene.events.on('update', this.motion);
    }

    startFire() {
        if (this.destroyed || this.result) return;
        this.flight.stop();
        this.phase = 'patrol';
        this.patrol();
        this.refresh();
    }

    refresh() {
        if (this.deadline && Date.now() >= this.deadline && !this.result) {
            this.resolve('loss');
            return;
        }
        super.refresh();
    }

    patrol() {
        if (this.destroyed || this.result || this.phase !== 'patrol') return;
        const area = predatorPatrolArea(this.scene);
        const t = Math.max(0, (Date.now() - this.approachEndsAt) / 1000);
        const phase = t % 5, attack = phase >= 4, cycle = Math.floor(t / 5);
        const radius = Math.max(0, (area.right - area.left) / 2);
        const x = (area.left + area.right) / 2 + Math.sin(t * 1.05) * radius;
        const drop = attack ? Math.sin((phase - 4) * Math.PI) * 65 : 0;
        const headingLeft = Math.cos(t * 1.05) < 0;
        // The back row already faces left; do not mirror it a second time.
        this.sprite.setPosition(x, area.y + drop).setFlipX(false);
        if (this.sprite.anims.currentAnim?.key === 'cobra_hit' && this.sprite.anims.isPlaying) return;
        const action = attack ? (cycle % 2 ? 'sweep' : 'poison') : headingLeft ? 'back' : 'walk';
        this.sprite.play('cobra_' + action, true);
    }

    destroy() {
        this.scene.events.off('update', this.motion);
        super.destroy();
    }
}
