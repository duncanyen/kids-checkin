// Real Phaser scenes and mailbox DOM, isolated Firebase fixtures only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const farm = { coins: 50, worms: 0, earthworms: 0, warehouseLimit: 10, hens: 1, hensState: [{}], coopLevel: 1, eggsReady: 3, lastLayTime: Date.now(), moral: 100, equippedWeapon: 'club' };
const docs = {
    'groups/A': { members: ['self', 'neighbor'], name: '測試村落', farmVillageVisibility: 'public' },
    'groups/B': { members: ['self'], name: '另一個村落' },
    'groups/A/users/self': { farm: structuredClone(farm) },
    'groups/A/users/neighbor': { farm: structuredClone(farm) },
    'groups/B/users/self': { farm: structuredClone(farm) }
};
let fail = false;
const mock = `
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'doc'}),collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value}),query=(ref,...filters)=>({...ref,filters}),serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
export const getDoc=async ref=>snap(ref.path,await window.__mailDb({kind:'get',path:ref.path}));
export const getDocs=async ref=>{const rows=await window.__mailDb({kind:'query',...ref});return{empty:!rows.length,docs:rows.map(row=>snap(row.path,row.data)),forEach:cb=>rows.forEach(row=>cb(snap(row.path,row.data)))};};
const listeners=new Set();
async function emit(l){const s=await(l.ref.kind==='query'?getDocs(l.ref):getDoc(l.ref));if(listeners.has(l))l.callback(s)}
export const onSnapshot=(ref,callback)=>{const l={ref,callback};listeners.add(l);emit(l);return()=>listeners.delete(l)};
async function notify(){for(const l of [...listeners])await emit(l)}
export const addDoc=async()=>({id:'log'});
export const setDoc=async(ref,data)=>{await window.__mailDb({kind:'commit',pending:[{path:ref.path,data}]});await notify()};
export const updateDoc=async(ref,data)=>{await window.__mailDb({kind:'commit',pending:[{path:ref.path,data,merge:true}]});await notify()};
let queue=Promise.resolve();
export function runTransaction(_,callback){const next=queue.catch(()=>{}).then(async()=>{
 const pending=[];
 const result=await callback({get:getDoc,set:(ref,data)=>pending.push({path:ref.path,data}),update:(ref,data)=>pending.push({path:ref.path,data,merge:true}),delete:ref=>pending.push({path:ref.path,remove:true})});
 await window.__mailDb({kind:'commit',pending});await notify();return result;
});queue=next;return next;}
`;
const owner = 'groups/A/users/self', welcome = owner + '/farm_notifications/welcome-v1';
(async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.message); });
        page.on('dialog', dialog => dialog.accept());
        page.setDefaultTimeout(12000);
        await page.exposeFunction('__mailDb', operation => {
            if (operation.kind === 'get') return structuredClone(docs[operation.path]);
            if (operation.kind === 'query') {
                let rows = Object.entries(docs).filter(([path]) => path.startsWith(operation.path + '/') && path.split('/').length === operation.path.split('/').length + 1).map(([path, data]) => ({ path, data: structuredClone(data) }));
                for (const filter of operation.filters || []) rows = rows.filter(row => filter.op === 'in' ? filter.value.includes(row.data[filter.field]) : row.data[filter.field] === filter.value);
                return rows;
            }
            if (operation.kind === 'commit') {
                if (fail && operation.pending.length) throw Error('Simulated offline');
                for (const write of operation.pending) {
                    if (write.remove) { delete docs[write.path]; continue; }
                    const next = write.merge ? structuredClone(docs[write.path] || {}) : {};
                    for (const [key, value] of Object.entries(write.data)) {
                        const bits = key.split('.'); let target = next;
                        for (const bit of bits.slice(0, -1)) target = target[bit] ??= {};
                        target[bits.at(-1)] = structuredClone(value);
                    }
                    docs[write.path] = next;
                }
            }
        });
        await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync('/tmp/kids-phaser.js', 'utf8') }));
        await page.route('https://www.gstatic.com/**', route => route.fulfill({ contentType: 'text/javascript', body: mock }));
        await page.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const db={};' }));
        await page.route('**/js/farm/main.js', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('const game =', 'const game = window.__farmGame =') });
        });
        await page.addInitScript(() => {
            sessionStorage.setItem('familyCheckInUser', JSON.stringify({ accountId: 'self', name: '測試玩家', groupId: 'A' }));
            if (!localStorage.getItem('lastGroupId')) localStorage.setItem('lastGroupId', 'A');
        });
        await page.goto(base + '/farmgame.html');
        await page.waitForSelector('.farm-mail-launcher').catch(async error => { console.error(await page.evaluate(()=>({ html:document.querySelector('.farm-mail-launcher')?.outerHTML, data:window.__farmGame?.registry?.get('myFarmData'), scenes:window.__farmGame?.scene?.getScenes(true).map(s=>s.scene.key) }))); throw error; });
        await page.waitForSelector('.farm-mail-badge:not([hidden])');
        assert.equal(await page.locator('.farm-mail-badge').textContent(), '1');
        assert.equal(await page.locator('.farm-mail-launcher').innerText(), '1');
        for (const viewport of [{width:390,height:844},{width:1440,height:900},{width:844,height:390}]) {
            await page.setViewportSize(viewport);
            await page.waitForTimeout(150);
            const layout = await page.evaluate(() => {
                const parent=document.querySelector('#game-container').getBoundingClientRect(),canvas=document.querySelector('#game-container canvas').getBoundingClientRect();
                return {width:innerWidth,height:innerHeight,parent:{x:parent.x,y:parent.y,width:parent.width,height:parent.height,bottom:parent.bottom},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height,right:canvas.right,bottom:canvas.bottom},scroll:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,bg:getComputedStyle(document.querySelector('#game-container'),'::before').backgroundImage};
            });
            assert.equal(Math.round(layout.parent.width),viewport.width);
            assert.ok(Math.abs(layout.parent.bottom-viewport.height)<=1);
            assert.equal(layout.scroll,false);
            assert.equal(layout.bg,'none');
            assert.equal(Math.round(layout.canvas.width),viewport.width);
            assert.ok(Math.abs(layout.canvas.height-layout.parent.height)<=1);
            assert.ok(layout.canvas.x>=-1&&layout.canvas.right<=viewport.width+1);
            assert.ok(layout.canvas.y>=layout.parent.y-1&&layout.canvas.bottom<=viewport.height+1);
            const scenery=await page.evaluate(()=>{
                const scene=window.__farmGame.scene.getScene('MyFarmScene'),camera=scene.cameras.main;
                const image=scene.children.list.find(o=>['farm_map','farm_panorama'].includes(o.texture?.key)),bounds=image.getBounds();
                const halfWidth=camera.width/camera.zoom/2,halfHeight=camera.height/camera.zoom/2;
                return{expectedRatio:image.texture.key==='farm_map'?720/1280:2172/724,ratio:image.displayWidth/image.displayHeight,covers:bounds.left<=195-halfWidth+.1&&bounds.right>=195+halfWidth-.1&&bounds.top<=422-halfHeight+.1&&bounds.bottom>=422+halfHeight-.1,plantsVisible:scene.gardenPlants.length===42&&scene.gardenPlants.every(plant=>{const b=plant.getBounds();return b.left>=195-halfWidth&&b.right<=195+halfWidth&&b.top>=422-halfHeight&&b.bottom<=422+halfHeight}),hudWidth:scene.children.list.find(o=>o.type==='Text'&&o.text==='🏠 村落').scaleX};
            });
            assert.ok(Math.abs(scenery.ratio-scenery.expectedRatio)<.001);
            assert.equal(scenery.covers,true);
            assert.equal(scenery.plantsVisible,true);
            assert.equal(scenery.hudWidth,1);
            await page.screenshot({path:`/tmp/farm-fullscreen-${viewport.width}.png`,fullPage:true});
        }
        await page.setViewportSize({width:390,height:844});
        await page.locator('.farm-mail-launcher').click();
        await page.getByRole('tab', { name: '系統', exact: true }).click();
        await page.waitForSelector('.farm-mail-gift');
        assert.ok(docs[welcome]);
        assert.equal(await page.evaluate(() => window.__farmGame.input.enabled), false);
        await page.locator('.farm-mail-summary').click();
        assert.match(await page.locator('.farm-mail-body').textContent(), /歡迎加入咕咕村落/);
        await page.waitForSelector('.farm-mail-badge[hidden]',{state:'attached'});
        assert.ok(docs[welcome].readAt);
        assert.equal(docs[welcome].claimedAt,null);
        assert.match(await page.locator('.farm-mail-rewards').textContent(), /1000/);
        fail = true;
        await page.getByRole('button', { name: '領取', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.farm-mail-status').textContent.includes('offline'));
        assert.equal(docs[owner].farm.coins, 50);
        assert.equal(await page.getByRole('button', { name: '領取', exact: true }).isEnabled(), true);
        fail = false;
        await page.getByRole('button', { name: '領取', exact: true }).click();
        await page.waitForSelector('.farm-mail-claim:disabled');
        assert.equal(docs[owner].farm.coins, 1050);
        assert.equal(docs[owner].farm.worms, 8);
        assert.equal(docs[owner].farm.earthworms, 4);
        await page.screenshot({ path: '/tmp/farm-mail-reward.png', fullPage: true });
        await page.getByRole('button', { name: '關閉', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__farmGame.input.enabled), true);
        await page.reload(); await page.locator('.farm-mail-launcher').click();
        await page.getByRole('tab', { name: '系統', exact: true }).click();
        await page.waitForSelector('.farm-mail-summary');
        assert.equal(await page.locator('.farm-mail-gift').count(), 0);
        await page.locator('.farm-mail-summary').click();
        assert.equal(await page.getByRole('button', { name: '已領取', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: '刪除通知', exact: true }).click();
        await page.waitForSelector('.farm-mail-empty');
        await page.getByRole('button', { name: '關閉', exact: true }).click();
        await page.reload(); await page.locator('.farm-mail-launcher').click();
        await page.getByRole('tab', { name: '系統', exact: true }).click();
        await page.waitForSelector('.farm-mail-empty');
        assert.equal(docs[welcome], undefined);
        assert.equal(docs[owner].farm.coins, 1050);
        await page.getByRole('button', { name: '關閉', exact: true }).click();
        // Steal from another member using the real VisitScene transaction.
        await page.evaluate(() => {
            Phaser.Math.Between = (_min, max) => max;
            window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene', { targetAccountId: 'neighbor', targetName: '鄰居', targetGroupId: 'A' });
        });
        await page.waitForFunction(() => window.__farmGame.scene.isActive('VisitScene') && window.__farmGame.scene.getScene('VisitScene').targetFarmData);
        // Full welcome inventory is deliberate; free space for theft tests.
        docs[owner].farm.worms = 0; docs[owner].farm.earthworms = 0;
        await page.evaluate(async () => {
            const scene = window.__farmGame.scene.getScene('VisitScene');
            scene.myFarmData.worms = 0; scene.myFarmData.earthworms = 0;
            const random = Math.random; Math.random = () => 0.99;
            try { await scene.attemptSteal(); } finally { Math.random = random; }
        });
        const visitorPrefix = 'groups/A/users/neighbor/farm_notifications/';
        assert.equal(Object.keys(docs).filter(path => path.startsWith(visitorPrefix)).length, 0);
        docs[owner].farm.villageStealCooldowns = {};
        // Force a committed failure; the target must not lose an egg or gain mail.
        const eggsBefore = docs['groups/A/users/neighbor'].farm.eggsReady;
        fail = true;
        await page.evaluate(async () => {
            const scene = window.__farmGame.scene.getScene('VisitScene');
            scene.myFarmData.villageStealCooldowns = {};
            const random = Math.random; Math.random = () => 0;
            try { await scene.attemptSteal(); } finally { Math.random = random; }
        });
        fail = false;
        assert.equal(docs['groups/A/users/neighbor'].farm.eggsReady, eggsBefore);
        assert.equal(Object.keys(docs).filter(path => path.startsWith(visitorPrefix)).length, 0);
        await page.evaluate(async () => {
            const scene = window.__farmGame.scene.getScene('VisitScene');
            const random = Math.random; Math.random = () => 0;
            try { await scene.attemptSteal(); } finally { Math.random = random; }
        });
        const visits = Object.entries(docs).filter(([path]) => path.startsWith(visitorPrefix));
        assert.equal(visits.length, 1);
        assert.equal(docs['groups/A/users/neighbor'].farm.eggsReady, eggsBefore - 1);
        assert.deepEqual(Object.keys(visits[0][1]).sort(), ['createdAt', 'note', 'readAt', 'title', 'type']);
        // Visit records show no detail button, include Taiwan timestamps and can be deleted.
        await page.evaluate(async notice => {
            const {setDoc,doc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
            await setDoc(doc({},'groups','A','users','self','farm_notifications','visitor-test'),notice);
        }, visits[0][1]);
        await page.waitForSelector('.farm-mail-badge:not([hidden])');
        assert.equal(await page.locator('.farm-mail-badge').textContent(),'1');
        await page.locator('.farm-mail-launcher').click();
        await page.getByRole('tab', { name: '訪客', exact: true }).click();
        await page.waitForSelector('.farm-mail-row');
        assert.equal(await page.locator('button.farm-mail-summary').count(), 0);
        await page.waitForSelector('.farm-mail-badge[hidden]',{state:'attached'});
        assert.ok(docs[owner+'/farm_notifications/visitor-test'].readAt);
        assert.match(await page.locator('.farm-mail-time').textContent(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        await page.getByRole('button', { name: '刪除', exact: true }).click();
        await page.waitForSelector('.farm-mail-empty');
        await page.getByRole('button', { name: '關閉', exact: true }).click();
        await page.evaluate(() => localStorage.setItem('lastGroupId', 'B'));
        await page.reload(); await page.locator('.farm-mail-launcher').click();
        await page.getByRole('tab', { name: '系統', exact: true }).click();
        await page.waitForSelector('.farm-mail-gift');
        assert.ok(docs['groups/B/users/self/farm_notifications/welcome-v1']);
        assert.equal(docs[owner].farm.coins, 1050);
        assert.deepEqual(errors, []);
        console.log('PASS: welcome delivery, rewards/retry/reload/delete, gift indicator, anonymous successful theft only, atomic failure, visitor deletion, group isolation, persistent live unread badges, icon-only launcher, full-viewport layout and input blocking.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
