// Isolated browser check; never uploads production photos.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const sdk = `
window.__photos={writes:[],uploads:[],deletes:[],rows:[{id:'legacy',groupId:'group-a',uploader:'Alice',imageUrl:'https://legacy.test/photo.jpg',comments:[],likes:[]}]};
const t=window.__photos;
export const collection=(_,path)=>({path}),doc=(ref,...parts)=>({id:parts.at(-1)||'new-post',path:parts.length?parts.join('/'):ref.path+'/new-post'});
export const query=(ref,...filters)=>ref,where=()=>({}),orderBy=()=>({}),serverTimestamp=()=>1,arrayUnion=()=>[],arrayRemove=()=>[];
const snapshot=()=>({empty:!t.rows.length,forEach:cb=>t.rows.forEach(({id,...data})=>cb({id,data:()=>data}))});
let listener;
export const onSnapshot=(_,cb)=>{listener=cb;cb(snapshot());return()=>{}};
export const addDoc=async()=>({id:'log'}),updateDoc=async()=>{};
export const setDoc=async(ref,data)=>{if(t.failSave)throw Error('offline');t.writes.push(data);t.rows.push({id:ref.id,...data});listener(snapshot())};
export const deleteDoc=async ref=>{t.rows=t.rows.filter(row=>row.id!==ref.id);listener(snapshot())};
export const getApps=()=>[],initializeApp=()=>({}),getAuth=()=>({}),getStorage=()=>({}),getFunctions=()=>({});
export const setPersistence=async()=>{},inMemoryPersistence={};
export const signInWithCustomToken=async()=>({user:{uid:'profile-1'}});
export const httpsCallable=()=>async()=>({data:{token:'test'}});
export const ref=(_,path)=>path;
export const uploadString=async(path,data,format,metadata)=>{t.uploads.push({path,format,metadata})};
export const getDownloadURL=async path=>'https://storage.test/'+path;
export const deleteObject=async path=>{t.deletes.push(path)};
`;
(async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const db={},firebaseConfig={};' }));
        // All SDK imports use one module URL, so isolated mock state is shared.
        await page.route('**/js/gallery-storage.js', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace(/https:\/\/www.gstatic.com\/firebasejs\/12.19.0\/firebase-[a-z]+.js/g, base + '/mock-sdk.js') });
        });
        await page.route('**/js/gallery.js', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace(/https:\/\/www.gstatic.com\/firebasejs\/12.19.0\/firebase-[a-z]+.js/g, base + '/mock-sdk.js') });
        });
        await page.route('**/mock-sdk.js', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
        await page.route('https://**/*', route => route.abort());
        await page.addInitScript(() => {
            sessionStorage.setItem('familyCheckInUser', JSON.stringify({ accountId: 'alice', name: 'Alice', password: 'test' }));
            localStorage.setItem('lastGroupId', 'group-a');
        });
        page.on('dialog', dialog => dialog.accept());
        await page.goto(base + '/gallery.html');
        await page.waitForSelector('.photo-card');
        assert.equal(await page.locator('.card-image').getAttribute('src'), 'https://legacy.test/photo.jpg');
        const image = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
        await page.locator('#fileInput').setInputFiles([image, { ...image, name: 'second.png' }]);
        await page.waitForSelector('.preview-item');
        await page.locator('#uploadCaption').fill('Storage test');
        await page.locator('#btnConfirmUpload').click();
        await page.waitForFunction(() => window.__photos.writes.length === 1);
        const saved = await page.evaluate(() => window.__photos.writes[0]);
        assert.equal(saved.imageUrls.length, 2);
        assert.equal(saved.groupId, 'group-a');
        assert.equal(saved.uploaderAccountId, 'alice');
        assert.equal(saved.storageProvider, 'firebase');
        assert.equal(await page.locator('.photo-card').count(), 2);
        await page.evaluate(() => window.deletePhoto('new-post'));
        await page.waitForFunction(() => window.__photos.deletes.length === 2);
        await page.evaluate(() => window.deletePhoto('legacy'));
        assert.equal(await page.evaluate(() => window.__photos.deletes.length), 2);
        assert.deepEqual(errors, []);
        console.log('Photo Dump browser upload, legacy display and deletion passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
