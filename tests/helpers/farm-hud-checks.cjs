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
    assert.ok(await page.evaluate(async()=>{
        const image=new Image(); image.src='/assets/farm/ui-icon-pedestal.png';
        await image.decode(); return image.naturalWidth>0;
    }));
    assert.equal(await page.locator('.farm-hud-label,.farm-hud-soon,.farm-hud-stat small').count(),0);
    assert.deepEqual(await dock.locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label').split('，')[0].replace('開啟',''))),['村落','商店','倉庫','圖鑑','通知']);
    for (const name of ['每日任務，尚未開放','活動，尚未開放','圖鑑，尚未開放','設定，尚未開放']) {
        const entry=page.getByRole('button',{name,exact:true});
        assert.equal(await entry.isEnabled(),true);
        await entry.click();
        assert.equal(await page.locator('.farm-hud-toast').innerText(),name.replace('，',''));
        assert.equal(await page.evaluate(()=>__farmGame.scene.isActive('MyFarmScene')),true);
    }
    assert.equal(await page.locator('[data-hud-value=eggs]').textContent(),'3');
    const dot = await page.locator('.farm-mail-badge').evaluate(n=>({hidden:n.hidden,width:n.offsetWidth,height:n.offsetHeight,font:getComputedStyle(n).fontSize}));
    assert.deepEqual(dot,{hidden:false,width:14,height:14,font:'0px'});
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
    const scale=await warehouse.evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);
    assert.ok(Math.abs(scale-.95)<.01);
    await page.mouse.up();
    await page.waitForFunction(()=>__farmGame.scene.isActive('WarehouseScene'));
    await page.waitForSelector('.farm-hud-bottom',{state:'hidden'});
    await clickBack(page,'WarehouseScene');
    await page.waitForSelector('.farm-hud-bottom',{state:'visible'});
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
        const layout=await page.evaluate(()=>{
            const dock=document.querySelector('.farm-hud-bottom').getBoundingClientRect();
            const canvas=document.querySelector('#game-container canvas').getBoundingClientRect();
            const coin=document.querySelector('.farm-hud-stat').getBoundingClientRect();
            const side=document.querySelector('.farm-hud-side').getBoundingClientRect();
            const bases=[...document.querySelectorAll('.farm-hud-bottom button')].every(n=>getComputedStyle(n,'::before').backgroundImage.includes('ui-icon-pedestal.png'));
            const firstIcon=document.querySelector('.farm-hud-side .farm-hud-art').getBoundingClientRect();
            return {sideGap:firstIcon.top-coin.bottom,sideLeft:side.left-coin.left,bases,scroll:document.documentElement.scrollWidth>innerWidth,clear:Math.abs(canvas.bottom-innerHeight)<2&&dock.top>=canvas.top,buttons:[...document.querySelectorAll('.farm-hud-bottom button')].map(n=>{const b=n.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=dock.top&&b.bottom<=innerHeight;})};
        });
        assert.ok(Math.abs(layout.sideGap-96/2.54*.5)<1); assert.ok(Math.abs(layout.sideLeft)<1); assert.equal(layout.bases,true);
        assert.equal(layout.scroll,false); assert.equal(layout.clear,true); assert.ok(layout.buttons.every(Boolean));
        await page.waitForSelector('.farm-hud-toast',{state:'hidden'});
        await page.screenshot({path:`/tmp/farm-hud-${viewport.width}.png`});
    }
    await page.setViewportSize({width:390,height:844});
    console.log('Farm HUD: resource totals, unavailable entries, press/selection states, navigation, transaction lock and responsive layout passed');
};
module.exports.clickBack=clickBack;
