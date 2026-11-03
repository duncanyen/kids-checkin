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
let fail = false, failSecondBatch = false;
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
        const confirmations=[]; page.on('dialog', dialog => { confirmations.push(dialog.message()); dialog.accept(); });
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
                if (failSecondBatch && operation.pending.some(write=>write.remove) && Object.keys(docs).filter(path=>path.startsWith(owner+'/farm_notifications/bulk-')).length===3) {
                    failSecondBatch=false;throw Error('Simulated second batch offline');
                }
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
        let calls=0;
        await page.exposeFunction('__redeemFixture',async()=>{calls++;return{rewards:[{kind:'coins',amount:100}],replayed:calls>1};});
        await page.route('**/js/farm/operations-client.js',route=>route.fulfill({contentType:'text/javascript',body:`export const GAME_OPERATIONS_ENABLED=true;export function createGameOperationsClient(){return{announcements:async()=>({rows:[{id:'ops-test',title:'營運公告',content:'<img src=x onerror=alert(1)>',startAt:Date.now()-1000,endAt:Date.now()+60000,updatedAt:1,showPopup:false}],nextCursor:null}),redeem:async()=>window.__redeemFixture()};}`}));
        await page.goto(base+'/farmgame.html');await page.waitForSelector('.farm-mail-launcher');await page.click('.farm-mail-launcher');
        await page.getByRole('tab',{name:'公告',exact:true}).click();await page.getByText('營運公告',{exact:true}).click();
        assert.ok((await page.locator('.farm-mail-body').innerText()).includes('<img'));assert.equal(await page.locator('.farm-mail-content img').count(),0);
        await page.getByRole('tab',{name:'禮包兌換',exact:true}).click();await page.getByLabel('禮包兌換碼').fill('TEST2026');await page.getByRole('button',{name:'兌換禮包',exact:true}).click();
        await page.getByText('兌換成功！ 金幣 × 100',{exact:true}).waitFor();assert.equal(calls,1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.deepEqual(errors,[]);console.log('PASS player operations UI: announcements use safe text, gift redemption, result feedback and mobile layout; transport mocked');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
