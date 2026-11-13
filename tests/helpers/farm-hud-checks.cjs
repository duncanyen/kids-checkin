const assert = require('node:assert/strict');

// 使用場景既有返回鍵的實際畫面座標，確認沒有 DOM 導覽仍能離開。
async function clickBack(page,key) {
    const point=await page.evaluate(key=>{
        const scene=__farmGame.scene.getScene(key), camera=scene.cameras.main;
        const x=key==='LobbyScene'?42:55, y=['LobbyScene','VisitScene'].includes(key)?50:60;
        const button=scene.children.list.find(o=>o.input?.enabled&&o.x===x&&o.y===y);
        if(!button) throw Error(`Missing return button: ${key}`);
        const canvas=__farmGame.canvas.getBoundingClientRect();
        return {x:canvas.left+(button.x-camera.worldView.x)*camera.zoom,y:canvas.top+(button.y-camera.worldView.y)*camera.zoom};
    },key);
    await page.mouse.click(point.x,point.y);
    await page.waitForFunction(key=>!__farmGame.scene.isActive(key),key);
}

// 使用 farm-mail-browser 的隔離 Firebase fixture 與真正 Phaser 場景。
module.exports = async function checkFarmHud(page) {
    const dock = page.locator('.farm-hud-bottom');
    const referenceImages = await page.locator('.farm-hud-art--reference img').evaluateAll(async nodes => {
        await Promise.all(nodes.map(node => node.decode()));
        return nodes.map(node => ({file:node.getAttribute('src').split('/').at(-1),width:node.naturalWidth,height:node.naturalHeight}));
    });
    assert.deepEqual(referenceImages.map(image => image.file),['settings.png','tasks.png','trophy.png','gift.png']);
    assert.ok(referenceImages.every(image => image.width===200 && image.height===200));
    assert.equal(await page.locator('.farm-hud-settings svg').count(),0);
    assert.deepEqual(await page.locator('.farm-hud-settings').evaluate(node=>{
        const style=getComputedStyle(node);
        return {background:style.backgroundImage,shadow:style.boxShadow,border:style.borderTopWidth};
    }),{background:'none',shadow:'none',border:'0px'});
    assert.ok(await page.locator('.farm-hud-panel-art,.farm-hud-dock-art,.farm-hud-mail-art').evaluateAll(async nodes => {
        await Promise.all(nodes.map(node => node.decode())); return nodes.length===5 && nodes.every(node=>node.naturalWidth>0);
    }));
    assert.equal(await dock.locator('.farm-hud-art,svg').count(),0);
    assert.equal(await page.locator('.farm-hud-stat,.farm-hud-settings,.farm-hud-side button,.farm-hud-bottom button,.farm-hud-countdown').count(),13);
    assert.equal(await page.locator('.farm-hud-status svg').count(),0);
    await page.waitForSelector('.farm-hud-countdown:not([hidden])');
    assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').timerText.visible),false);
    // UI 直接鏡射場景字串，不複製產蛋公式；非計時提示與重試事件仍正常。
    await page.evaluate(()=>{
        const timer=__farmGame.scene.getScene('MyFarmScene').timerText;
        window.__hudTimerBefore=timer.text; window.__hudSetText=timer.setText;
        timer.setText=function(){ return this; };
        __hudSetText.call(timer,'布雷斯雞下顆蛋 0:38:52');
    });
    await page.waitForFunction(()=>document.querySelector('.farm-hud-countdown-time').textContent==='0:38:52');
    assert.equal(await page.locator('.farm-hud-countdown-label').textContent(),'布雷斯雞下顆蛋');
    await page.evaluate(()=>{
        __hudSetText.call(__farmGame.scene.getScene('MyFarmScene').timerText,'存檔未確認，點此重試');
        window.__hudRetry=__farmGame.retryFarmSave; window.__hudRetryCount=0;
        __farmGame.retryFarmSave=()=>window.__hudRetryCount++;
    });
    await page.waitForFunction(()=>document.querySelector('.farm-hud-countdown-label').textContent==='存檔未確認，點此重試');
    assert.equal(await page.locator('.farm-hud-countdown-time').textContent(),'');
    await page.locator('.farm-hud-countdown').click();
    assert.equal(await page.evaluate(()=>__hudRetryCount),1);
    await page.evaluate(()=>{
        __farmGame.retryFarmSave=__hudRetry;
        const timer=__farmGame.scene.getScene('MyFarmScene').timerText;
        timer.setText=__hudSetText; timer.setText(__hudTimerBefore);
    });
    assert.equal(await page.locator('.farm-hud-label,.farm-hud-soon,.farm-hud-stat small').count(),0);
    assert.deepEqual(await dock.locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label').split('，')[0].replace('開啟',''))),['村落','商店','倉庫','圖鑑','通知']);
    assert.equal(await dock.locator('button.is-selected').count(),0);
    assert.equal(await dock.getByRole('button',{name:'村落',exact:true}).evaluate(node=>getComputedStyle(node).outlineStyle),'none');
    assert.equal(await dock.locator('.farm-hud-dock-sprite').count(),4);
    assert.notEqual(await page.locator('.farm-hud-dock-art').evaluate(node=>getComputedStyle(node).maskImage),'none');
    // 驗證實際圖片跟著縮小，非只有透明熱區；放開後回彈並顯示選取亮框。
    const guide=dock.getByRole('button',{name:'圖鑑，尚未開放',exact:true});
    const guideBounds=await guide.boundingBox();
    const artWidth=await guide.locator('.farm-hud-dock-sprite').evaluate(node=>node.getBoundingClientRect().width);
    await page.mouse.move(guideBounds.x+guideBounds.width/2,guideBounds.y+guideBounds.height/2);
    await page.mouse.down(); await page.waitForTimeout(120);
    const pressedWidth=await guide.locator('.farm-hud-dock-sprite').evaluate(node=>node.getBoundingClientRect().width);
    assert.ok(Math.abs(pressedWidth/artWidth-.95)<.01);
    assert.ok(Math.abs((await guide.boundingBox()).width-guideBounds.width)<.1,'press must keep the hit area stable');
    assert.notEqual(await guide.evaluate(node=>getComputedStyle(node).outlineStyle),'none');
    await page.screenshot({path:'/tmp/farm-hud-button-pressed.png'});
    await page.mouse.up(); await page.waitForTimeout(350);
    const releasedWidth=await guide.locator('.farm-hud-dock-sprite').evaluate(node=>node.getBoundingClientRect().width);
    assert.ok(Math.abs(releasedWidth/artWidth-1)<.01);
    assert.equal(await guide.evaluate(node=>node.classList.contains('is-selected')),true);
    await page.screenshot({path:'/tmp/farm-hud-button-selected.png'});
    assert.equal(await page.getByRole('button',{name:'每日任務',exact:true}).isEnabled(),true);
    for (const name of ['活動，尚未開放','圖鑑，尚未開放','設定，尚未開放']) {
        const entry=page.getByRole('button',{name,exact:true});
        assert.equal(await entry.isEnabled(),true);
        await entry.click();
        assert.equal(await page.locator('.farm-hud-toast').innerText(),name.replace('，',''));
        assert.equal(await page.evaluate(()=>__farmGame.scene.isActive('MyFarmScene')),true);
    }
    assert.equal(await page.locator('[data-hud-value=eggs]').textContent(),'3');
    const dot = await page.locator('.farm-mail-badge').evaluate(n=>({hidden:n.hidden,width:n.offsetWidth,height:n.offsetHeight,font:getComputedStyle(n).fontSize}));
    assert.equal(dot.hidden,false); assert.ok(dot.width>10 && Math.abs(dot.width-dot.height)<=1); assert.equal(dot.font,'0px');
    assert.ok(await page.locator('.farm-mail-badge').evaluate(node=>getComputedStyle(node).backgroundImage.includes('mail_unread_badge.png')));
    await page.evaluate(() => {
        const g=__farmGame; window.__hudOriginal=g.registry.get('myFarmData');
        g.registry.set('myFarmData',{...__hudOriginal,poultryVersion:2,readyEggs:{hen:1,silkie:2,bresse:3,onagadori:4},eggsReady:10,coins:131300,cleanliness:85});
    });
    assert.equal(await page.locator('[data-hud-value=eggs]').textContent(),'10');
    assert.equal(await page.locator('[data-hud-value=coins]').textContent(),'131,300');
    assert.equal(await page.locator('[data-hud-value=dirt]').textContent(),'85/100');
    assert.equal(await page.locator('[data-hud-value=dirt]').evaluate(n=>n.classList.contains('is-warning')),true);
    await page.evaluate(() => __farmGame.registry.set('myFarmData',__hudOriginal));

    // 怪物出現、戰鬥結算與失敗重試期間，左右導覽必須一起消失。
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').preparingGiant=true);
    await page.waitForSelector('.farm-hud-side',{state:'hidden'});
    await page.waitForSelector('.farm-hud-bottom',{state:'hidden'});
    assert.equal(await page.locator('.farm-hud-status').isVisible(),true);
    await page.evaluate(()=>{
        const scene=__farmGame.scene.getScene('MyFarmScene');
        scene.preparingGiant=false;
        scene.giantEncounter={result:'win',settling:true};
    });
    await page.waitForTimeout(150);
    assert.equal(await dock.isVisible(),false);
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.settling=false);
    await page.waitForTimeout(150);
    assert.equal(await dock.isVisible(),false,'failed settlement must keep navigation hidden');
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.settled=true);
    await page.waitForSelector('.farm-hud-bottom',{state:'visible'});
    await page.waitForSelector('.farm-hud-side',{state:'visible'});
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter=null);

    // 按壓時縮小，進入功能頁後隱藏導覽，並保留場景原本的返回鍵。
    const warehouse = dock.getByRole('button',{name:'倉庫',exact:true});
    const bounds=await warehouse.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await page.mouse.down(); await page.waitForTimeout(100);
    const scale=await warehouse.locator('.farm-hud-dock-sprite').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);
    assert.ok(Math.abs(scale-.95)<.01);
    await page.mouse.up();
    await page.waitForFunction(()=>__farmGame.scene.isActive('WarehouseScene'));
    await page.waitForSelector('.farm-hud-bottom',{state:'hidden'});
    await clickBack(page,'WarehouseScene');
    await page.waitForSelector('.farm-hud-bottom',{state:'visible'});
    assert.equal(await dock.locator('button.is-selected').count(),0);
    await dock.getByRole('button',{name:'商店',exact:true}).click();
    await page.waitForFunction(()=>__farmGame.scene.isActive('ShopScene'));
    await page.waitForSelector('.farm-hud-bottom',{state:'hidden'});
    await clickBack(page,'ShopScene');
    await page.waitForSelector('.farm-hud-bottom',{state:'visible'});
    // 避免交易尚未結束就透過新的 DOM 導覽離開，直接派送 click 也須被拒絕。
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').isProcessing=true);
    await page.waitForFunction(()=>document.querySelector('.farm-hud-bottom button').disabled);
    await dock.getByRole('button',{name:'村落',exact:true}).dispatchEvent('click');
    assert.equal(await page.evaluate(()=>__farmGame.scene.isActive('MyFarmScene')),true);
    await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').isProcessing=false);
    await dock.getByRole('button',{name:'村落',exact:true}).click();
    await page.waitForFunction(()=>__farmGame.scene.isActive('LobbyScene'));
    await page.waitForSelector('.farm-hud-bottom',{state:'hidden'});
    await clickBack(page,'LobbyScene');
    await page.waitForFunction(()=>__farmGame.scene.isActive('MyFarmScene'));
    await page.waitForSelector('.farm-hud-bottom',{state:'visible'});

    for (const viewport of [{width:320,height:740},{width:390,height:844},{width:1440,height:900},{width:844,height:390}]) {
        await page.setViewportSize(viewport); await page.waitForTimeout(200);
        await page.evaluate(()=>{
            window.__hudLayoutFarm=__farmGame.registry.get('myFarmData');
            __farmGame.registry.set('myFarmData',{...__hudLayoutFarm,coins:987654321});
        });
        assert.equal(await page.locator('[data-hud-value=coins]').textContent(),'987,654,321');
        const layout=await page.evaluate(()=>{
            const dock=document.querySelector('.farm-hud-bottom').getBoundingClientRect();
            const canvas=document.querySelector('#game-container canvas').getBoundingClientRect();
            const coin=document.querySelector('.farm-hud-stat').getBoundingClientRect();
            const side=document.querySelector('.farm-hud-side').getBoundingClientRect();
            const countdown=document.querySelector('.farm-hud-countdown').getBoundingClientRect();
            const firstIcon=document.querySelector('.farm-hud-side .farm-hud-art').getBoundingClientRect();
            const eggFrame=document.querySelector('[data-panel=eggs]').getBoundingClientRect();
            const dirtFrame=document.querySelector('[data-panel=cleanliness]').getBoundingClientRect();
            const timerStyle=getComputedStyle(document.querySelector('.farm-hud-countdown'));
            const panelRects=[...document.querySelectorAll('.farm-hud-stat,.farm-hud-settings')].map(n=>n.getBoundingClientRect());
            const panels=[...document.querySelectorAll('.farm-hud-stat')];
            const croppedRopes=panels.every(node=>{const style=getComputedStyle(node),art=node.querySelector('img').getBoundingClientRect();return style.overflow==='hidden'&&art.top<node.getBoundingClientRect().top;});
            return {croppedRopes,topGap:panelRects[0].top-canvas.top,topAligned:panelRects.every(rect=>Math.abs(rect.top-panelRects[0].top)<1),sideGap:firstIcon.top-coin.bottom,sideLeft:side.left-coin.left,scroll:document.documentElement.scrollWidth>innerWidth,clear:Math.abs(canvas.bottom-innerHeight)<2&&dock.top>=canvas.top,
                countdownClear:countdown.top>=Math.max(eggFrame.bottom,dirtFrame.bottom)&&Math.abs((countdown.left+countdown.right)/2-innerWidth/2)<1&&countdown.right<=innerWidth,
                simpleTimer:timerStyle.backgroundColor==='rgba(0, 0, 0, 0.5)'&&timerStyle.color==='rgb(255, 255, 255)'&&timerStyle.transform!=='none'&&!document.querySelector('.farm-hud-countdown img'),
                aligned:panelRects.slice(1).every((r,i)=>r.left>=panelRects[i].right),
                textFits:[...document.querySelectorAll('[data-hud-value],.farm-hud-countdown>span')].every(n=>n.scrollWidth<=n.clientWidth+1),
                buttons:[...document.querySelectorAll('.farm-hud-bottom button')].map(n=>{const b=n.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=dock.top&&b.bottom<=innerHeight;})};
        });
        const manifest=require('../../assets/farm/reference-ui/v2/manifest.json');
        const zones=await dock.locator('button').evaluateAll(nodes=>nodes.map(node=>{
            const b=node.getBoundingClientRect(),dock=node.parentElement.getBoundingClientRect();
            return {id:node.dataset.dockZone,x:(b.left-dock.left)/dock.width,y:(b.top-dock.top)/dock.height,w:b.width/dock.width,h:b.height/dock.height};
        }));
        zones.forEach((zone,i)=>{
            const expected=manifest.dock_hotzones[i]; assert.equal(zone.id,expected.id);
            for(const [key,dimension] of [['x',1495],['y',356],['w',1495],['h',356]]) assert.ok(Math.abs(zone[key]-expected[key]/dimension)<.001);
        });
        assert.ok(zones.slice(1).every((zone,i)=>zone.x>=zones[i].x+zones[i].w-.001));
        const sizes=await page.evaluate(()=>{
            const side=document.querySelector('.farm-hud-side .farm-hud-art').getBoundingClientRect();
            return {side:side.width,scale:new DOMMatrix(getComputedStyle(document.querySelector('.farm-hud-bottom')).transform).a,touch:[...document.querySelectorAll('.farm-hud-side button,.farm-hud-bottom button')].every(n=>{const b=n.getBoundingClientRect();const min=n.closest('.farm-hud-bottom')?44*.8:44;return b.width>=min&&b.height>=min;})};
        });
        const narrow=viewport.width<359, short=viewport.height<=520;
        assert.ok(Math.abs(sizes.side-(short?41:narrow?49:56)*.8)<.1);
        assert.equal(sizes.touch,true);
        assert.equal(sizes.scale,.8);
        assert.ok(Math.abs(layout.sideGap-96/2.54*.5)<1); assert.ok(Math.abs(layout.sideLeft)<1);
        assert.ok(Math.abs(layout.topGap-96/2.54*.3)<1);assert.equal(layout.topAligned,true);assert.equal(layout.croppedRopes,true);assert.equal(layout.scroll,false); assert.equal(layout.clear,true); assert.equal(layout.countdownClear,true); assert.equal(layout.simpleTimer,true); assert.equal(layout.aligned,true); assert.equal(layout.textFits,true); assert.ok(layout.buttons.every(Boolean));
        await page.evaluate(()=>__farmGame.registry.set('myFarmData',__hudLayoutFarm));
        await page.waitForSelector('.farm-hud-toast',{state:'hidden'});
        await page.screenshot({path:`/tmp/farm-hud-${viewport.width}.png`});
    }
    await page.setViewportSize({width:390,height:844});
    console.log('Farm HUD: resource totals, unavailable entries, press/selection states, navigation, transaction lock and responsive layout passed');
};
module.exports.clickBack=clickBack;
