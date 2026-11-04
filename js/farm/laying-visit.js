import { nextEggStatus, poultryState } from './poultry.js';
import { poultryAnim } from './poultry-art.js';
import { farmEggPosition } from './scenery.js';
import { getThreatZones } from './hen-navigation.js';

// Presentation only. Production and collection remain Firestore transactions.
export class LayingVisit {
    constructor(scene) { this.scene = scene; }

    cancel() {
        const task = this.task;
        this.task = null;
        if (!task?.hen.active) return;
        task.hen.nesting = false;
        task.hen.setScale(task.hen.baseScale);
        this.scene.wanderSingleHen(task.hen);
    }

    update(now = Date.now()) {
        const scene = this.scene;
        if (!scene.isSaveReady() || document.hidden || getThreatZones(scene).length ||
            [scene.moleEncounter, scene.cobraEncounter, scene.eagleEncounter, scene.dragonEncounter, scene.gorillaEncounter]
                .some(boss => boss && !boss.destroyed && !boss.settled)) {
            this.cancel();
            return;
        }
        const status = nextEggStatus(scene.farmData, now), next = status.next;
        // Do not wait for the one-second HUD poll at the actual egg deadline.
        if (next?.ms === 0 && now >= (this.nextProductionCheckAt || 0)) {
            this.nextProductionCheckAt = now + 1000;
            scene.eggTick?.();
        }
        if (this.task) {
            const task = this.task, state = poultryState(scene.farmData, now);
            const bird = state.hens.find(h => h.id === task.id);
            const clockChanged = !bird || bird.laidAt !== task.laidAt;
            if (!task.hen.active || !scene.hensGroup.includes(task.hen) || !bird || bird.isSick ||
                (now < task.dueAt && (next?.id !== task.id || next?.dueAt !== task.dueAt)) ||
                (now >= task.dueAt && clockChanged && !state.ready[task.breed])) {
                this.cancel();
            } else if (now >= task.dueAt + 1800) {
                this.finishedKey = task.key;
                this.cancel();
            } else {
                const door = farmEggPosition(scene);
                const progress = Math.min(1, Math.max(0, (now - task.startedAt) / (task.dueAt - task.startedAt)));
                task.hen.setPosition(task.x + (door.x - task.x) * progress, task.y + (door.y + 12 - task.y) * progress);
                task.hen.setFlipX(door.x < task.x);
                if (now >= task.dueAt) {
                    task.hen.play(poultryAnim(task.hen, 'idle'), true);
                    task.hen.setScale(task.hen.baseScale * 1.12, task.hen.baseScale * .75);
                }
                return;
            }
        }
        if (!next || next.ms <= 0 || `${next.id}:${next.dueAt}` === this.finishedKey) return;
        // Resolve the actual bird, never substitute another outdoor bird of its breed.
        const hen = scene.hensGroup.find(h => h.active && h.hState.id === next.id);
        if (!hen) return;
        const door = farmEggPosition(scene);
        const travelMs = Math.min(12000, Math.max(2000, Math.hypot(door.x - hen.x, door.y + 12 - hen.y) * 20));
        if (next.ms > travelMs) return;
        hen.walkTimer?.remove();
        scene.tweens.killTweensOf(hen);
        hen.walkPath = [];
        hen.nesting = true;
        hen.setScale(hen.baseScale).play(poultryAnim(hen, 'walk'), true);
        const bird = poultryState(scene.farmData, now).hens.find(h => h.id === next.id);
        this.task = { ...next, hen, key: `${next.id}:${next.dueAt}`, laidAt: bird.laidAt, startedAt: now, x: hen.x, y: hen.y };
    }
}
