// Names and inventory IDs match the existing combat and warehouse contracts.
export const BATTLE_REWARDS = Object.freeze({
    eagle:{stunnedFrame:6,name:'巨飛鷹',item:'eagleFeathers',itemName:'巨鷹羽毛',icon:'eagle-feather'},
    dragon:{stunnedFrame:16,name:'烈火龍',item:'dragonScales',itemName:'龍麟',icon:'dragon_scale'},
    gorilla:{stunnedFrame:9,name:'大金剛',item:'gorillaFangs',itemName:'猩猩尖牙',icon:'gorilla_fang'},
    cobra:{stunnedFrame:49,name:'毒牙眼鏡蛇王',item:'cobraFangs',itemName:'眼鏡蛇王毒牙',icon:'cobra_fang'},
    giant:{stunnedFrame:25,name:'遠古巨人',item:'ancientStones',itemName:'遠古巨石',icon:'ancient_stone'},
    mole:{stunnedFrame:5,name:'菜園地鼠 ×3',item:'sweetPotatoes',itemName:'地瓜',icon:'sweet_potato'},
    wolf:{stunnedFrame:10,name:'大野狼',item:'wolfFangs',itemName:'狼牙',icon:'fang'},
    tiger:{stunnedFrame:10,name:'猛虎',item:'tigerPelts',itemName:'虎皮',icon:'tiger_pelt'},
});
export function battleRewardView(result, kind, {legacyInventoryConfirmed=false}={}) {
    const monster=BATTLE_REWARDS[kind];
    if(!monster||!result?.id||result.outcome!=='win'||result.monster&&result.monster!==kind)return null;
    // Existing server settlement: hasSpace reflects the actual inventory patch, not
    // a client capacity guess. Current rules grant exactly one item per victory.
    const inventoryUpdated=typeof result.inventoryUpdated==='boolean'?result.inventoryUpdated:result.hasSpace===true||(result.hasSpace===undefined&&legacyInventoryConfirmed);
    // Optional future server list uses the same inventory IDs; it never grants items.
    const items=Object.values(BATTLE_REWARDS);
    const loot=Array.isArray(result.rewards)?result.rewards.map(row=>{
        const item=items.find(item=>item.item===row.itemId);
        if(!Number.isSafeInteger(row.quantity)||row.quantity<=0)throw Error('戰利品數量無效');
        return {itemId:row.itemId,name:item?.itemName||row.itemName||row.itemId,quantity:row.quantity,icon:item?.icon};
    }):[{itemId:monster.item,name:monster.itemName,quantity:1,icon:monster.icon}];
    return {id:result.id,kind,monsterName:monster.name,inventoryUpdated,loot:inventoryUpdated?loot:[]};
}
