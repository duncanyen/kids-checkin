import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const core = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync('js/gallery-core.js')).toString('base64'));
test('rename merges historical likes into one canonical account ID', () => {
    const aliases = ['New', 'Old', 'Older'];
    const photo = { likes: ['Old', 'Older', 'Bob'], likeAccountIds: ['alice', 'alice'] };
    assert.equal(core.photoLikes(photo, 'alice', aliases).count, 2);
    const patch = core.updatePhotoLike(photo, 'alice', aliases, true);
    assert.deepEqual(patch, { likeAccountIds: ['alice'], likes: ['Bob'] });
    assert.deepEqual(core.updatePhotoLike({ ...photo, ...patch }, 'alice', aliases, true), patch);
    assert.deepEqual(core.updatePhotoLike({ ...photo, ...patch }, 'alice', aliases, false), { likeAccountIds: [], likes: ['Bob'] });
});
test('different accounts with the same display name retain separate canonical likes', () => {
    const photo = { likes: [], likeAccountIds: ['alice'] };
    const patch = core.updatePhotoLike(photo, 'bob', ['New'], true);
    assert.equal(core.photoLikes(patch, 'bob', ['New']).count, 2);
    assert.equal(core.photoLikes(patch, 'alice', ['New']).liked, true);
});
test('homepage like entry uses the same account ID and rejects another group', async () => {
    const { default: vm } = await import('node:vm');
    let user = { accountId: 'alice', name: 'New' };
    const photo = { groupId: 'A', likes: ['Old'], likeAccountIds: [] };
    const source = fs.readFileSync('js/dashboard.js', 'utf8');
    const context = { window: { currentGroup: { id: 'A' } }, db: {},
        sessionStorage: { getItem: () => JSON.stringify(user) }, localStorage: { getItem: () => null },
        doc: () => ({}), photoLikes: core.photoLikes, updatePhotoLike: core.updatePhotoLike,
        loadPhotoAliases: async () => ['New', 'Old'], alert: () => {},
        runTransaction: async (_, callback) => callback({ get: async () => ({ exists: () => true, data: () => structuredClone(photo) }), update: (_, patch) => Object.assign(photo, patch) }) };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const pendingPhotoLikes =')), context);
    await context.window.togglePhotoLike('p', false);
    user = { accountId: 'alice', name: 'Newest' };
    await context.window.togglePhotoLike('p', false);
    assert.deepEqual(photo.likeAccountIds, ['alice']);
    assert.deepEqual(photo.likes, []);
    context.window.currentGroup.id = 'B';
    await context.window.togglePhotoLike('p', true);
    assert.deepEqual(photo.likeAccountIds, ['alice']);
});
