// Real Phaser scenes and mailbox DOM, isolated Firebase fixtures only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const {fixture}=require('../game-admin/tests/fixture.cjs');
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
        const ops=await fixture();ops.clock(Date.now());
        await ops.db.doc('users/self').set({accountId:'self',role:'child'});
        await ops.db.doc('groups/A').set({members:['self','neighbor']});
        const until=Date.now()+3600000;
        const original=await ops.admin('saveAnnouncement',ops.announcement({status:'published',title:'營運公告',activityCode:'test-２０２６',endAt:until,showPopup:false}));
        await ops.admin('saveAnnouncement',ops.announcement({status:'published',title:'給其他玩家',endAt:until,targetType:'accounts',targetAccountIds:['neighbor']}));
        await ops.admin('saveAnnouncement',ops.announcement({status:'published',title:'過期公告',startAt:Date.now()-10000,endAt:Date.now()-1}));
        await ops.admin('saveNotification',ops.announcement({status:'published',title:'全體系統訊息',endAt:until,showPopup:false}));
        await ops.admin('saveNotification',ops.announcement({status:'published',title:'玩家專屬系統訊息',endAt:until,showPopup:false,targetType:'accounts',targetAccountIds:['self']}));
        await ops.admin('saveNotification',ops.announcement({status:'published',title:'別人的系統訊息',endAt:until,showPopup:false,targetType:'accounts',targetAccountIds:['neighbor']}));
        await ops.db.doc('groups/A/users/self').set({farm:structuredClone(farm)});
        await ops.admin('saveGift',ops.gift({code:'TEST2026',rewards:[{kind:'coins',amount:100}],startAt:Date.now()-1000,endAt:until}));
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
        await page.exposeFunction('__announcementFixture',async({cursor,channel})=>{ops.clock(Date.now());const request=ops.request('self');Object.assign(request.data,{cursor,channel});return ops.service.announcements(request);});
        await page.addInitScript(() => {
            Object.defineProperty(navigator,'clipboard',{value:{writeText:async code=>{if(window.__clipboardDenied)throw Error('denied');window.__copiedCode=code;}}});
            const schedule=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===60000&&String(fn).includes('loadOperations'))window.__pollOperations=fn;return schedule(fn,ms,...args);};
            sessionStorage.setItem('familyCheckInUser', JSON.stringify({ accountId: 'self', name: '測試玩家', groupId: 'A' }));
            if (!localStorage.getItem('lastGroupId')) localStorage.setItem('lastGroupId', 'A');
        });
        let calls=0,finishRedeem;
        await page.exposeFunction('__redeemFixture',async code=>{calls++;if(calls===1)await new Promise(resolve=>finishRedeem=resolve);const result=await ops.service.redeem(ops.request('self',code));docs[owner].farm=(await ops.db.doc('groups/A/users/self').get()).data().farm;return result;});
        await page.exposeFunction('__finishRedeem',()=>finishRedeem());
        await page.route('**/js/farm/operations-client.js*',route=>route.fulfill({contentType:'text/javascript',body:`export {GAME_ANNOUNCEMENTS_ENABLED,GAME_REDEMPTION_ENABLED} from './operations-config.js';export function createGameOperationsClient(){return{announcements:async(cursor,channel)=>window.__announcementFixture({cursor,channel}),redeem:async(code)=>window.__redeemFixture(code)};}`}));
        await page.goto(base+'/farmgame.html');await page.waitForSelector('.farm-mail-launcher');await page.click('.farm-mail-launcher');
        await page.getByRole('tab',{name:'公告',exact:true}).click();await page.getByText('營運公告',{exact:true}).waitFor();
        assert.equal(await page.locator('.farm-mail-row').count(),1,'announcements use the same framed inbox rows');
        assert.equal(await page.locator('.farm-mail-check').count(),1);
        await page.screenshot({path:'/tmp/farm-announcement-inbox.png'});
        const unreadBefore=Number(await page.locator('.farm-mail-badge').innerText());
        await page.getByText('營運公告',{exact:true}).click();
        assert.equal(Number(await page.locator('.farm-mail-badge').innerText()),unreadBefore-1,'reading an announcement reduces the unread badge');
        assert.ok((await page.locator('.farm-mail-body').innerText()).includes('<img'));assert.equal(await page.locator('.farm-mail-content img').count(),0);
        assert.equal(await page.getByText('給其他玩家',{exact:true}).count(),0);assert.equal(await page.getByText('過期公告',{exact:true}).count(),0);
        assert.equal(await page.getByLabel('活動碼',{exact:true}).inputValue(),'TEST2026');
        await page.screenshot({path:'/tmp/farm-activity-code.png'});
        await page.getByRole('button',{name:'複製活動碼',exact:true}).click();await page.getByText('活動碼已複製',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.__copiedCode),'TEST2026');
        await page.evaluate(()=>{window.__clipboardDenied=true;document.execCommand=()=>false;});
        await page.getByRole('button',{name:'複製活動碼',exact:true}).click();await page.getByText('已選取活動碼，請長按或使用複製功能',{exact:true}).waitFor();
        await page.getByRole('button',{name:'前往兌換',exact:true}).click();assert.equal(await page.getByLabel('禮包兌換碼').inputValue(),'TEST2026');assert.equal(calls,0,'prefill does not redeem automatically');
        await page.getByRole('tab',{name:'公告',exact:true}).click();await page.getByText('營運公告',{exact:true}).click();
        await page.getByRole('button',{name:'‹ 返回列表',exact:true}).click();
        await page.getByRole('button',{name:'刪除',exact:true}).click();
        await page.getByText('目前沒有有效公告',{exact:true}).waitFor();
        await page.getByRole('button',{name:'重新整理公告',exact:true}).click();await page.waitForTimeout(150);
        assert.equal(await page.getByText('營運公告',{exact:true}).count(),0,'personal delete survives feed refresh');
        assert.equal((await ops.service.announcements(ops.request('self'))).rows.length,1,'personal deletion never deletes server announcement');
        await page.getByRole('tab',{name:'系統',exact:true}).click();
        await page.getByText('全體系統訊息',{exact:true}).waitFor();await page.getByText('玩家專屬系統訊息',{exact:true}).waitFor();
        assert.equal(await page.getByText('別人的系統訊息',{exact:true}).count(),0);
        await page.screenshot({path:'/tmp/farm-system-notifications.png'});
        await page.getByText('玩家專屬系統訊息',{exact:true}).click();await page.locator('.farm-mail-body').waitFor();
        await page.getByRole('button',{name:'刪除通知',exact:true}).click();
        assert.equal(await page.getByText('玩家專屬系統訊息',{exact:true}).count(),0);
        await page.getByRole('button',{name:'全選',exact:true}).click();await page.getByRole('button',{name:/刪除已選/}).click();
        await page.getByText('目前沒有系統通知',{exact:true}).waitFor();
        await page.getByRole('tab',{name:'禮包兌換',exact:true}).click();assert.equal(await page.getByLabel('禮包兌換碼').isDisabled(),false);
        await page.getByRole('button',{name:'關閉',exact:true}).click();
        const published=await ops.admin('saveAnnouncement',ops.announcement({status:'published',title:'新公告即時通知',endAt:until,showPopup:true}));
        await page.evaluate(()=>{__farmGame.scene.getScene('MyFarmScene').giantEncounter={destroyed:false,settled:false,destroy(){}};window.__pollOperations();});
        await page.waitForTimeout(600);assert.equal(await page.locator('.farm-mail-overlay').isVisible(),false,'announcement does not interrupt combat');
        await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter=null);
        await page.getByRole('heading',{name:'新公告即時通知',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true,'notification does not disable global touch handling');
        await page.getByRole('button',{name:'關閉',exact:true}).click();
        await page.evaluate(()=>window.__pollOperations());await page.waitForTimeout(600);assert.equal(await page.locator('.farm-mail-overlay').isVisible(),false,'read popup is not repeated');
        assert.ok(await page.evaluate(id=>Object.keys(localStorage).some(key=>key.includes('nexus.ops.read:self:'+id)&&localStorage.getItem(key)==='1'),published.id));
        // Verify the production-enabled gift form against the real backend service fixture.
        await page.reload();await page.waitForSelector('.farm-mail-launcher');await page.click('.farm-mail-launcher');
        await page.getByRole('tab',{name:'禮包兌換',exact:true}).click();await page.getByLabel('禮包兌換碼').fill('TEST2026');await page.getByRole('button',{name:'兌換禮包',exact:true}).click();
        assert.equal(await page.getByRole('button',{name:'關閉',exact:true}).isDisabled(),false);
        assert.equal(await page.getByRole('tab',{name:'公告',exact:true}).isDisabled(),false);
        assert.equal(await page.getByRole('button',{name:'正在兌換…',exact:true}).isDisabled(),true);
        await page.getByRole('button',{name:'返回村落',exact:true}).click();
        assert.equal(await page.locator('.farm-mail-overlay').isVisible(),false,'pending redemption can leave the page');
        assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),true,'scene input restored while request is pending');
        await page.click('.farm-mail-launcher');await page.getByRole('button',{name:'正在兌換…',exact:true}).waitFor();assert.equal(calls,1);
        await page.evaluate(()=>window.__finishRedeem());
        await page.getByRole('heading',{name:'禮包兌換成功',exact:true}).waitFor();await page.getByText('金幣 × 100',{exact:true}).waitFor();
        assert.equal(calls,1);assert.equal((await ops.db.doc('groups/A/users/self').get()).data().farm.coins,150);
        await page.screenshot({path:'/tmp/farm-gift-success.png'});
        await page.waitForFunction(()=>__farmGame.registry.get('myFarmData').coins===150);
        await page.getByRole('button',{name:'完成，返回村落',exact:true}).click();assert.equal(await page.locator('.farm-mail-overlay').isVisible(),false);
        await page.click('.farm-mail-launcher');assert.equal(await page.getByLabel('禮包兌換碼').inputValue(),'');
        assert.equal(await page.getByRole('heading',{name:'禮包兌換成功',exact:true}).count(),0,'completed result does not remain after leaving');
        await page.getByLabel('禮包兌換碼').fill('NOTREAL2026');await page.getByLabel('禮包兌換碼').press('Enter');
        await page.getByText('找不到此禮包，請確認兌換碼',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'兌換禮包',exact:true}).isEnabled(),true);
        assert.equal(await page.getByLabel('禮包兌換碼').inputValue(),'NOTREAL2026');
        await page.getByRole('tab',{name:'訪客',exact:true}).click();assert.equal(await page.getByText('找不到此禮包，請確認兌換碼',{exact:true}).count(),0,'errors do not leak into other tabs');
        await page.getByRole('button',{name:'關閉',exact:true}).click();assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.deepEqual(errors,[]);console.log('PASS player operations UI: published announcements, server audience/expiry filtering, initial/read notices, newly-published popup after combat, no repeated popup, system notification delivery, shared inbox rows, personal and bulk deletion, production redemption enabled, safe text, transactional gift redemption, one-click code copy and fallback, prefilled redemption, pending exit/reopen, authoritative reward sync, explicit completion, recoverable errors and mobile layout; transport mocked');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
