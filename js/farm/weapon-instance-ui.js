import { refinementClient, pendingRefinement } from './refinement-client.js';
import { mountWeaponDetails } from './weapon-refinement-ui.js';
/** Individual weapon cards and in-place refinement pages, using the existing modal lifecycle. */
import { createFarmDialog } from './farm-dialog.js';
import { weaponRepository, pendingWeaponAction, mutateWeapon } from './weapon-instance-client.js';
import { WEAPONS_CONFIG } from './combat-rules.js';
import { readGameContext } from '../game-context.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function openWeaponInstances(scene,{mode='warehouse',weaponId=null}={}){
    if(scene.eggResultDialog)return scene.eggResultDialog;
    const context=readGameContext(),dialog=createFarmDialog(scene,{kind:'weapons',panelClass:'farm-chest-panel',label:mode==='sell'?'出售武器個體':'我的武器',valid:()=>{const now=readGameContext();return now.groupId===context.groupId&&now.accountId===context.accountId&&now.user.docId===context.user.docId;}});
    const {panel}=dialog;let cursor=null,busy=false,generation=0,capabilities={},disposeDetails=null;
    const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='farm-chest-button';b.onclick=fn;return b;};
    const title=el('h2',mode==='sell'?'出售武器個體':'我的武器'),close=button('關閉',dialog.close),rows=el('div');
    rows.className='farm-chest-inventory';rows.style.overflowY='auto';rows.tabIndex=0;rows.setAttribute('aria-label','武器個體清單');
    const message=el('p'),footer=el('footer');footer.className='farm-chest-footer';panel.append(title,close,rows,message,footer);dialog.protectScroll(rows);
    panel.addEventListener('keydown',event=>{if(event.key==='Escape')dialog.close();if(event.key==='Tab'){const nodes=[...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')];const i=nodes.indexOf(document.activeElement);if(nodes.length){event.preventDefault();nodes[(i+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}}});
    async function execute(action,payload){
        if(busy)return;busy=true;for(const b of panel.querySelectorAll('button'))if(b!==close)b.disabled=true;message.textContent='正在確認武器操作…';
        try{await mutateWeapon(action,payload);if(!dialog.isCurrent())return;cursor=null;busy=false;await load();message.textContent='操作完成';}
        catch(error){if(!dialog.isCurrent())return;busy=false;message.textContent=pendingWeaponAction()?'結果確認中，請確認原交易。':error.message||'操作未完成';recovery();}
    }
    function recovery(){const pending=pendingWeaponAction();footer.replaceChildren();if(pending)footer.append(button('確認原交易結果',()=>execute(pending.action,pending.payload)));else footer.append(button('重新讀取',()=>{cursor=null;void load();}));}
    async function load(){
        disposeDetails?.();disposeDetails=null;
        if(busy||!dialog.isCurrent())return;const token=++generation;title.textContent=mode==='sell'?'出售武器個體':'我的武器';rows.replaceChildren();footer.replaceChildren();message.textContent='正在讀取武器…';
        if(pendingWeaponAction()){message.textContent='上次武器操作結果確認中';recovery();return;}
        try{
            const unresolved=pendingRefinement();if(unresolved){disposeDetails=mountWeaponDetails({scene,dialog,item:{instanceId:unresolved.payload.instanceId,weaponId:unresolved.display.weaponId},rows,footer,message,onBack:()=>{cursor=null;void load();},onAction:()=>{}});return;}
            const [result,permissions]=await Promise.all([weaponRepository.list({pageSize:20,...(weaponId?{weaponId}:{}),...(cursor?{cursor}:{})}),refinementClient.capabilities()]);if(!dialog.isCurrent()||token!==generation)return;capabilities=permissions;
            if(result.schemaVersion!==2)throw Error('此農場尚未移轉，請關閉後使用原倉庫');
            message.textContent=result.rows.length?'':'本頁沒有武器';
            for(let item of result.rows){
                const config=WEAPONS_CONFIG[item.weaponId],card=el('article');card.className='farm-weapon-card';card.dataset.weaponInstanceId=item.instanceId;card.style.flexWrap='wrap';card.dataset.refineTier=item.refineLevel===9?'gold':item.refineLevel>=6?'blue':item.refineLevel>=3?'green':'normal';
                try{if(scene.textures.exists(config.icon)){const img=el('img');img.src=scene.textures.getBase64(config.icon);img.alt=config.name;img.width=48;img.height=48;img.style.objectFit='contain';card.append(img);}}catch{}
                const label=el('span',`${config.name} +${item.refineLevel}${item.equipped?'（裝備中）':''}`);label.title=item.instanceId;card.append(label);
                const details=el('small',`${item.bound?'系統綁定 · ':''}${capabilities.battleLocked?'戰鬥中鎖定 · ':''}編號 ${item.instanceId.slice(-8)}`);card.append(details);
                const perform=(action,selected=item)=>{
                    item=selected;
                    footer.replaceChildren();message.textContent=`${action==='equipWeapon'?(item.equipped?'卸下':'裝備'):action==='sellItem'?`出售，獲得 ${config.sellPrice} 金幣${item.refineLevel>0?'；精煉能力永久消失，直接出售不退精煉成本，可先解除再出售':''}`:'丟棄'}「${config.name} +${item.refineLevel}」？`;
                    const payload={item:item.weaponId,expectedWeaponRevision:item.ownerRevision,...(action==='sellItem'?{quantity:1,instanceIds:[item.instanceId]}:{instanceId:item.instanceId}),...(action==='equipWeapon'?{currentlyEquipped:item.equipped}:{}),...(action==='sellItem'&&item.refineLevel>0?{acknowledgeRefinementLoss:true,expectedStateRevision:item.stateRevision}:{})};
                    footer.append(button('取消',()=>{message.textContent='';if(selected.restrictions)showDetails();else footer.replaceChildren();}),button('確定',()=>execute(action,payload)));
                };
                const showDetails=()=>{disposeDetails?.();disposeDetails=mountWeaponDetails({scene,dialog,item,rows,footer,message,onBack:()=>{cursor=null;void load();},onAction:perform});};
                if(capabilities.detailsAvailable)card.append(button('詳細資訊',showDetails));
                if(pendingRefinement()?.payload.instanceId===item.instanceId)queueMicrotask(showDetails);
                if(mode==='sell'){const sell=button('出售',()=>perform('sellItem'));sell.disabled=item.bound||item.equipped||capabilities.battleLocked||item.refineLevel>0&&!capabilities.refinedSalesEnabled||!config.sellPrice;card.append(sell);}
                else{const equip=button(item.equipped?'卸下':'裝備',()=>perform('equipWeapon'));equip.disabled=capabilities.battleLocked;card.append(equip);const discard=button('丟棄',()=>perform('discardItem'));discard.disabled=item.bound||item.equipped||item.refineLevel>0||capabilities.battleLocked;card.append(discard);}
                rows.append(card);
            }
            if(result.nextCursor)footer.append(button('下一頁',()=>{cursor=result.nextCursor;void load();}));if(cursor)footer.append(button('回第一頁',()=>{cursor=null;void load();}));
        }catch(error){if(!dialog.isCurrent()||token!==generation)return;message.textContent=error.message||'無法讀取武器';recovery();}
    }
    dialog.mount();void load();return dialog;
}
