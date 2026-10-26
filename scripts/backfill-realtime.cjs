// Run from repository root after setting Application Default Credentials.
// Preview (read-only): node scripts/backfill-realtime.cjs
// Apply: node scripts/backfill-realtime.cjs --apply
const { initializeApp } = require('../functions/node_modules/firebase-admin/app');
const { getFirestore } = require('../functions/node_modules/firebase-admin/firestore');
const { getDatabase } = require('../functions/node_modules/firebase-admin/database');
initializeApp({ projectId: 'homebasedb', databaseURL: 'https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app' });
const firestore = getFirestore(), database = getDatabase(), mirror = require('../functions/mirror.cjs')(firestore, database);
const apply = process.argv.includes('--apply');
async function eachPage(query, callback) {
    let last, count = 0;
    for (;;) {
        const page = await (last ? query.startAfter(last) : query).limit(250).get();
        if (page.empty) break;
        for (const snapshot of page.docs) { await callback(snapshot); count++; }
        last = page.docs.at(-1);
    }
    return count;
}
(async () => {
    // Preserve ready markers during a repeat backfill; version-checked writes are
    // idempotent and cannot overwrite a newer live mirror with an old snapshot.
    const counts = {};
    counts.accounts = await eachPage(firestore.collection('users'), async doc => { if (apply) await mirror.account(doc.data().accountId, doc); });
    counts.groups = await eachPage(firestore.collection('groups'), async doc => { if (apply) await mirror.group(doc.id, doc); });
    counts.farms = 0;
    await eachPage(firestore.collectionGroup('users'), async doc => {
        const group = doc.ref.parent.parent;
        if (group?.parent.id !== 'groups' || !doc.data().farm) return;
        counts.farms++; if (apply) await mirror.farm(group.id, doc.id, doc);
    });
    counts.rooms = await eachPage(firestore.collection('rooms'), async doc => { if (apply) await mirror.room(doc.id, doc, null); });
    counts.messages = await eachPage(firestore.collection('messages'), async doc => { if (apply) await mirror.message(doc.id, doc, null); });
    if (apply) await database.ref('nexus/status').update({ farms: true, chat: true, backfilledAt: Date.now() });
    console.log(JSON.stringify({ applied: apply, counts }));
    await require('../functions/node_modules/firebase-admin/app').deleteApp(require('../functions/node_modules/firebase-admin/app').getApp());
})().catch(error => { console.error('Backfill failed; readiness was not advanced:', error.message); process.exit(1); });
