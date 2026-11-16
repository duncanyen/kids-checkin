import { FARM_SCENES, ownedSceneIds, activeSceneId } from './farm-scenes-core.js';
import { farmDialog } from './poultry-housing-ui.js';
import { farmCommand } from './backend-client.js';
import { ensureAssets } from './assets.js';

const currentFarm=scene=>scene.registry.get('myFarmData')||{};
const picture=(parent,scene)=>{
    const img=document.createElement('img');img.src=scene.thumbnail;img.alt=scene.name;img.decoding='async';img.className='farm-scene-preview';parent.append(img);
};
export function openScenePurchase(scene,id) {
    const item=FARM_SCENES[id];if(!item||id==='default')return;
    const dialog=farmDialog(scene,'購買場景');dialog.panel.classList.add('farm-scenes-panel');picture(dialog.panel,item);
    dialog.message.textContent=`${item.name}：${item.price.toLocaleString('zh-TW')} 金幣。永久收藏，不占倉庫容量；購買後可在設定切換。`;
    let busy=false;
    const buy=dialog.button('確認購買',async()=>{
        if(busy||item.purchasable===false)return;busy=true;buy.disabled=true;buy.textContent='購買中…';
        try {
            await farmCommand('buyScene',{sceneId:id});
            if(!dialog.root.isConnected)return;
            buy.remove();dialog.message.textContent='購買成功！場景已放入倉庫，請回到村落右上角設定切換。';
        } catch(error) {
            if(!dialog.root.isConnected)return;
            dialog.message.textContent=error.message||'購買未確認，請重試確認原交易';buy.disabled=false;buy.textContent='重試確認購買';
        } finally {busy=false;}
    });
    const owned=ownedSceneIds(currentFarm(scene)).includes(id);
    buy.disabled=owned||item.purchasable===false;
    if(owned)buy.textContent='已擁有';
    else if(item.purchasable===false){buy.textContent='尚未開賣';dialog.message.textContent=`${item.name}尚未開賣，暫不開放購買。`;}
    dialog.button('關閉',dialog.close);
}
export function openSceneSettings(scene) {
    const dialog=farmDialog(scene,'更換場景');dialog.panel.classList.add('farm-scenes-panel');
    const farm=currentFarm(scene),owned=ownedSceneIds(farm);let active=activeSceneId(farm);
    dialog.message.textContent=owned.length>1?'選擇已擁有的場景，免費切換。':'目前只有初始場景，其他場景開賣後可到商店「場景」購買。';
    const list=document.createElement('div');list.className='farm-scene-list';dialog.panel.append(list);
    let busy=false;const controls=[];
    for(const id of owned){
        const item=FARM_SCENES[id],card=document.createElement('div');card.className='farm-scene-card';list.append(card);picture(card,item);
        const name=document.createElement('p');name.textContent=item.name;card.append(name);
        const button=document.createElement('button');button.type='button';button.className='farm-mail-button';button.textContent=id===active?'使用中':'使用此場景';button.disabled=id===active||owned.length<2;button.dataset.sceneId=id;card.append(button);controls.push(button);
        button.onclick=async()=>{
            if(busy)return;busy=true;controls.forEach(b=>b.disabled=true);dialog.message.textContent='載入場景…';
            try{
                // Prepare both orientations before saving so rotating needs no new wait.
                await ensureAssets(scene,[item.portrait,item.landscape]).catch(()=>{throw Error('場景圖片載入失敗，請重試；目前場景未變更');});
                if(!dialog.root.isConnected)return;
                await farmCommand('setScene',{sceneId:id});
                scene.events.emit('farm-scene-retry');
                if(dialog.root.isConnected){active=id;dialog.message.textContent='場景已更換';controls.forEach(b=>{b.textContent=b.dataset.sceneId===id?'使用中':'使用此場景';b.disabled=b.dataset.sceneId===id;});}
            }catch(error){if(dialog.root.isConnected){dialog.message.textContent=error.message||'切換失敗，請重試';controls.forEach(b=>b.disabled=b.dataset.sceneId===active);}}
            finally{busy=false;}
        };
    }
    dialog.button('關閉',dialog.close);
}
export function openOwnedScene(scene,id){
    const item=FARM_SCENES[id];if(!item||!ownedSceneIds(currentFarm(scene)).includes(id))return;
    const dialog=farmDialog(scene,item.name);dialog.panel.classList.add('farm-scenes-panel');picture(dialog.panel,item);
    dialog.message.textContent=`${activeSceneId(currentFarm(scene))===id?'使用中':'已收藏'}。請回村落右上角設定切換場景。`;
    dialog.button('關閉',dialog.close);
}
