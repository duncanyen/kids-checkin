import test from 'node:test';
import assert from 'node:assert/strict';
import { LayingVisit } from '../js/farm/laying-visit.js';
import { BREEDS, nextEggStatus, collectPoultry, poultryPatch, settlePoultry } from '../js/farm/poultry.js';
import { farmEggPosition } from '../js/farm/scenery.js';

globalThis.document = { hidden: false };
const dueAt = 100000000;
function fixture(breed = 'hen', outside = true) {
    const bird = { id: 'next', breed, laidAt: dueAt - BREEDS[breed].interval };
    const hen = { active: true, x: 80, y: 480, baseScale: 2, hState: bird,
        setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setFlipX() { return this; }, play(key) { this.animation = key; return this; },
        walkTimer: { remove() {} } };
    const scene = { scale: { width: 390, height: 844 }, isSaveReady: () => true,
        farmData: { poultryVersion: 2, hens: 1, hensState: [bird], readyEggs: {}, eggsReady: 0, cleanliness: 0, warehouseLimit: 99 },
        hensGroup: outside ? [hen] : [], tweens: { killTweensOf() {} },
        wanderSingleHen(h) { h.wanders = (h.wanders || 0) + 1; } };
    const visit = new LayingVisit(scene);
    return { scene, hen, visit, bird };
}
const apply = (farm, patch) => { for (const [key, value] of Object.entries(patch)) farm[key.slice(5)] = value; };

test('each breed walks alone to the actual doorway and crouches exactly at its deadline', () => {
    for (const breed of Object.keys(BREEDS)) {
        const { scene, hen, visit } = fixture(breed);
        visit.update(dueAt - 30000); assert.equal(visit.task, undefined);
        visit.update(dueAt - 1500); assert.equal(visit.task.id, 'next');
        assert.equal(hen.animation, `${breed}_walk`);
        visit.update(dueAt - 750); assert.equal(hen.scaleY, hen.baseScale);
        visit.update(dueAt);
        const door = farmEggPosition(scene);
        assert.equal(hen.x, door.x); assert.equal(hen.y, door.y + 12);
        assert.equal(hen.animation, `${breed}_idle`); assert.ok(hen.scaleY < hen.baseScale);
        apply(scene.farmData, poultryPatch(settlePoultry(scene.farmData, dueAt)));
        visit.update(dueAt + 100); assert.equal(visit.task.id, 'next');
        visit.update(dueAt + 1800); assert.equal(visit.task, null);
        assert.equal(hen.nesting, false); assert.equal(hen.scaleY, hen.baseScale); assert.equal(hen.wanders, 1);
    }
});

test('a next egg from an indoor bird never substitutes an outdoor bird of the same breed', () => {
    const { scene, hen, visit } = fixture('silkie', false);
    scene.hensGroup.push({ ...hen, hState: { id: 'other', breed: 'silkie' } });
    visit.update(dueAt - 1000); assert.equal(visit.task, undefined);
    assert.equal(scene.hensGroup[0].nesting, undefined);
    assert.equal(nextEggStatus(scene.farmData, dueAt - 1000).next.id, 'next');
    assert.equal(settlePoultry(scene.farmData, dueAt).ready.silkie, 1);
});

test('collecting a due egg while its bird is approaching cancels the animation without duplicate eggs', () => {
    const { scene, hen, visit } = fixture();
    visit.update(dueAt - 1200);
    const result = collectPoultry(scene.farmData, dueAt);
    assert.equal(result.total, 1);
    apply(scene.farmData, result.patch);
    visit.update(dueAt);
    assert.equal(visit.task, null); assert.equal(hen.nesting, false);
    assert.equal(collectPoultry(scene.farmData, dueAt + 10).total, 0);
});

test('collecting older eggs before the deadline leaves the upcoming egg intact', () => {
    const { scene, visit } = fixture();
    scene.farmData.readyEggs = { hen: 1 };
    visit.update(dueAt - 1200);
    apply(scene.farmData, collectPoultry(scene.farmData, dueAt - 500).patch);
    visit.update(dueAt - 400); assert.equal(visit.task.id, 'next');
});

test('clock changes, illness, housing changes and interrupted sessions release the bird', () => {
    for (const change of [
        s => { s.farmData.hensState[0].laidAt -= 1000; },
        s => { s.farmData.hensState[0].isSick = true; },
        s => { s.hensGroup = []; },
        s => { s.registry = { get: () => ({ phase: 'error' }) }; },
        s => { s.moleEncounter = { settled: false }; }
    ]) {
        const { scene, hen, visit } = fixture();
        visit.update(dueAt - 1500); change(scene); visit.update(dueAt - 1000);
        assert.equal(visit.task, null); assert.equal(hen.nesting, false);
    }
});

test('simultaneous eggs use the same stable bird as the countdown, and overdue entry does not replay', () => {
    const { scene, visit } = fixture();
    scene.farmData.hens = 2;
    scene.farmData.hensState.push({ ...scene.farmData.hensState[0], id: 'tie' });
    assert.equal(nextEggStatus(scene.farmData, dueAt - 100).next.id, 'next');
    visit.update(dueAt + 1); assert.equal(visit.task, undefined);
});

test('a delayed or failed production response does not cause a save request every frame', () => {
    const { scene, visit } = fixture();
    let calls = 0;
    scene.eggTick = () => calls++;
    for (let offset = 0; offset < 1000; offset += 16) visit.update(dueAt + offset);
    assert.equal(calls, 1);
    visit.update(dueAt + 1000); assert.equal(calls, 2);
});

test('pending-write loading does not cancel the approach or the crouch at the egg deadline', () => {
    const { scene, hen, visit } = fixture();
    visit.update(dueAt - 7000);
    assert.equal(visit.task.id, 'next');
    scene.isSaveReady = () => false;
    scene.registry = { get: () => ({ phase: 'loading' }) };
    visit.update(dueAt - 500);
    assert.equal(hen.nesting, true);
    visit.update(dueAt);
    assert.equal(hen.animation, 'hen_idle');
    assert.ok(hen.scaleY < hen.baseScale);
    apply(scene.farmData, poultryPatch(settlePoultry(scene.farmData, dueAt)));
    scene.isSaveReady = () => true;
    scene.registry = { get: () => ({ phase: 'ready' }) };
    visit.update(dueAt + 100);
    assert.equal(visit.task.id, 'next');
});
