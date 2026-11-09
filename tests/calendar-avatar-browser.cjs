// Real homepage, isolated Firebase fixtures; no production reads or writes.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const start=require('./helpers/navigation-performance-server.cjs');
(async()=>{
    const server=await start(),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    try{
        const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei'});
        await context.addInitScript(()=>{
            const user={accountId:'alice',name:'新名字',nameHistory:['原名','更早名字'],avatar:'/Nexus.png?owner=alice&revision=1',role:'member',menus:['calendar']};
            sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));sessionStorage.setItem('nexus_active_group_id','A');localStorage.setItem('lastGroupId','A');
            const event=(title,extra)=>({groupId:'A',date:'2026-11-09',visibility:'public',isAllDay:true,title,...extra});
            window.__perfStore={
                'users/document-a':user,
                'users/document-b':{accountId:'bob',name:'原名',avatar:'/Nexus.png?owner=bob'},
                'users/outsider':{accountId:'outside',name:'原名',avatar:'/Nexus.png?owner=outside'},
                'groups/A':{name:'測試群組',members:['alice','bob']},
                'userSettings/alice':{accountId:'alice',modules:{},order:[]},
                'events/stable':event('固定帳號行程',{accountId:'alice',operator:'原名'}),
                'events/legacy':event('舊名稱行程',{operator:'更早名字'}),
                'events/document':event('舊文件行程',{accountId:'document-a',operator:'原名'}),
                'events/unknown':event('不猜測其他人',{accountId:'outside',operator:'原名'})
            };window.__perfOperations=[];
        });
        const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
        await page.route('https://**',r=>r.abort());await page.clock.setFixedTime(new Date('2026-11-09T04:00:00Z'));
        await page.goto(server.base+'/index.html');
        await page.waitForFunction(()=>document.querySelectorAll('.agenda-avatar[src*="owner=alice"]').length===3);
        const row=title=>page.locator('.agenda-item').filter({hasText:title});
        assert.equal(await row('固定帳號行程').locator('img').getAttribute('alt'),'新名字');
        assert.ok(!(await row('不猜測其他人').locator('img').getAttribute('src')).includes('owner='));
        await page.evaluate(async()=>{
            __perfStore['users/document-a'].name='再次改名';__perfStore['users/document-a'].avatar='/Nexus.png?owner=alice&revision=2';
            await fetchAndRenderGroupMembers();renderAgendaUI();
        });
        await page.waitForFunction(()=>document.querySelector('.agenda-avatar[src*="revision=2"]'));
        assert.equal(await row('固定帳號行程').locator('img').getAttribute('alt'),'再次改名');
        const before=await page.evaluate(()=>__perfOperations.length);
        await page.evaluate(()=>{for(let i=0;i<5;i++)renderAgendaUI();});
        assert.equal(await page.evaluate(()=>__perfOperations.length),before,'avatar rendering reuses loaded group profiles');
        assert.equal(await page.evaluate(()=>__perfStore['events/stable'].operator),'原名');
        await page.screenshot({path:'/tmp/nexus-calendar-current-avatar.png',fullPage:true});
        assert.deepEqual(errors,[]);
        console.log('PASS: homepage calendar avatars use stable account IDs, current group profiles, historical name/document compatibility, safe fallback and no extra render queries.');
    }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
