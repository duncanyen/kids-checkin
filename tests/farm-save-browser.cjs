// Real game scenes; delayed/empty/offline snapshots use isolated Firestore data.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const owner = 'groups/A/users/alice';
const farm = { coins: 12345, hens: 3, inventoryEggs: 19, silkieEggs: 5, bresseEggs: 2, coopLevel: 3,
    eggsReady: 7, readyEggs: { hen: 4, silkie: 2, bresse: 1 }, poultryVersion: 2,
    hensState: ['hen', 'silkie', 'bresse'].map((breed, i) => ({ id: 'hen' + i, breed, laidAt: Date.now() })),
    lastLayTime: Date.now(), warehouseLimit: 100, worms: 8, earthworms: 4, mace: 1, battleaxe: 1,
    cleanliness: 0, moral: 100, equippedWeapon: 'battleaxe' };
const docs = { 'groups/A': { members: ['alice'] }, [owner]: { farm: structuredClone(farm), keep: 'unrelated field' } };
let mode = 'delayed', release, gate = new Promise(resolve => { release = resolve; });
const writes = [];
const sdk = `
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'doc'}),collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const query=(ref,...filters)=>({...ref,filters}),where=(field,op,value)=>({field,op,value});
export const serverTimestamp=()=>Date.now();
const snap=(path,data,metadata)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data),metadata});
export const getDoc=async ref=>snap(ref.path,await window.__saveDb({kind:'get',path:ref.path}));
export const getDocs=async()=>({empty:true,docs:[],forEach:()=>{}});
const listeners=new Set();
async function emit(l){if(listeners.has(l))l.callback(await getDoc(l.ref))}
export const onSnapshot=(ref,callback)=>{
 const l={ref,callback};listeners.add(l);
 if(ref.path==='groups/A/users/alice')queueMicrotask(()=>callback(snap(ref.path,undefined,{fromCache:true,hasPendingWrites:false})));
 else emit(l);
 return()=>listeners.delete(l);
};
window.__saveEmit=async (data,metadata)=>{for(const l of [...listeners])if(l.ref.path==='groups/A/users/alice')l.callback(snap(l.ref.path,data,metadata))};
export const setDoc=()=>{throw Error('Unsafe setDoc outside transaction')};
export const updateDoc=()=>{throw Error('Unexpected updateDoc')},addDoc=()=>{};
let queue=Promise.resolve();
export function runTransaction(_,callback){const next=queue.catch(()=>{}).then(async()=>{
 const pending=[];const result=await callback({get:getDoc,set:(ref,data,options)=>pending.push({path:ref.path,data,merge:!!options?.merge}),update:(ref,data)=>pending.push({path:ref.path,data,merge:true})});
 await window.__saveDb({kind:'commit',pending});
 for(const l of [...listeners])await emit(l);
 return result;
});queue=next;return next;}
`;
(async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(12000);
        await page.exposeFunction('__saveDb', async operation => {
            if (operation.kind === 'get') {
                if (operation.path === owner) {
                    if (mode === 'delayed') await gate;
                    if (mode === 'offline') throw Error('offline');
                }
                return structuredClone(docs[operation.path]);
            }
            if (operation.kind === 'commit') {
                if (mode === 'offline') throw Error('offline');
                for (const write of operation.pending) {
                    docs[write.path] = write.merge ? { ...docs[write.path], ...structuredClone(write.data) } : structuredClone(write.data);
                    writes.push(write);
                }
            }
        });
        await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync('/tmp/kids-phaser.js', 'utf8') }));
        await page.route('https://www.gstatic.com/**', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
        await page.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const db={};' }));
        await page.route('**/js/farm/mail-ui.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export function mountFarmMail(){}' }));
        await page.route('**/js/farm/main.js', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('const game =', 'const game = window.__farmGame =') });
        });
        await page.addInitScript(() => {
            sessionStorage.setItem('familyCheckInUser', JSON.stringify({ accountId: 'alice', groupId: 'A', name: '測試玩家' }));
            localStorage.setItem('lastGroupId', 'A');
        });
        await page.goto(base + '/farmgame.html');
        await page.waitForFunction(() => window.__farmGame?.scene.isActive('MyFarmScene'));
        await page.waitForTimeout(600);
        assert.equal(writes.length, 0);
        assert.deepEqual(docs[owner].farm, farm);
        assert.equal(await page.evaluate(() => window.__farmGame.scene.getScene('MyFarmScene').coinsText.text), '💰 —');
        assert.equal(await page.evaluate(() => window.__farmGame.scene.getScene('MyFarmScene').farmData), null);
        // Slow loading cannot enter a shop that would misleadingly show defaults.
        await page.evaluate(() => {
            const scene = window.__farmGame.scene.getScene('MyFarmScene');
            scene.children.list.find(o => o.type === 'Rectangle' && o.x === 145 && o.y === 40).emit('pointerdown');
        });
        assert.equal(await page.evaluate(() => window.__farmGame.scene.isActive('ShopScene')), false);
        mode = 'online'; release();
        await page.waitForFunction(() => window.__farmGame.scene.getScene('MyFarmScene').farmData?.coins === 12345);
        assert.equal(writes.length, 0);
        assert.equal(docs[owner].farm.hens, 3);
        // Losing the listener's local cache retains the displayed assets.
        mode = 'offline';
        await page.evaluate(() => window.__saveEmit(undefined, { fromCache: true }));
        await page.waitForFunction(() => window.__farmGame.registry.get('farmLoadState')?.phase === 'error');
        assert.equal(await page.evaluate(() => window.__farmGame.scene.getScene('MyFarmScene').farmData.coins), 12345);
        assert.deepEqual(docs[owner].farm, farm);
        assert.equal(writes.length, 0);
        mode = 'online'; await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForFunction(() => window.__farmGame.registry.get('farmLoadState')?.phase === 'ready');
        assert.deepEqual(docs[owner], { farm, keep: 'unrelated field' });
        // Partial existing data is never interpreted as permission to reset.
        docs[owner] = { farm: { coins: 12345 }, keep: 'unrelated field' };
        await page.reload();
        await page.waitForFunction(() => window.__farmGame?.registry.get('farmLoadState')?.phase === 'error');
        assert.deepEqual(docs[owner], { farm: { coins: 12345 }, keep: 'unrelated field' });
        assert.equal(writes.length, 0);
        // A genuinely new farm is initialized once, using the transactional path.
        delete docs[owner];
        await page.reload();
        await page.waitForFunction(() => window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.hens === 1);
        assert.equal(writes.filter(write => write.path === owner).length, 1);
        assert.ok(docs[owner + '/farm_meta/creation']);
        // A new game's receipt survives an accidental parent deletion.
        delete docs[owner];
        await page.reload();
        await page.waitForFunction(() => window.__farmGame?.registry.get('farmLoadState')?.phase === 'error');
        assert.equal(docs[owner], undefined);
        assert.equal(writes.filter(write => write.path === owner).length, 1);
        assert.deepEqual(errors, []);
        console.log('PASS: slow cache miss, no offline default writes, assets retained during outage/reconnect, partial-save refusal, one-time new farm creation and deleted-save protection.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
