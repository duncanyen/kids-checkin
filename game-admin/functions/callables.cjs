const {onCall,HttpsError}=require('firebase-functions/v2/https');
// 管理與兌換的網站驗證為選用；身分、目前角色、玩家資格及獎勵限額仍由服務檢查。
/**
 * 將服務包為 Firebase v2 callable，統一 CORS、區域與對外錯誤。
 * @param {Object} service - 已包含管理員／玩家驗證的後端服務。
 * @param {Object} [options] - 管理與兌換 App Check 是否必要及隔離 emulator 設定。
 * @returns {Object} 四個具名 callable；App Check 選用不代表取消登入或獎勵驗證。
 */
function createCallables(service,{adminAppCheckRequired=false,redemptionAppCheckRequired=false,emulator=process.env.FUNCTIONS_EMULATOR==='true'}={}) {
    const options={region:'asia-southeast1',cors:true,maxInstances:10,enforceAppCheck:!emulator};
    const wrap=(handler,overrides={})=>onCall({...options,...overrides},async request=>{
        try{return await handler(request);}
        catch(error){
            const valid=['invalid-argument','unauthenticated','permission-denied','failed-precondition','not-found','already-exists','resource-exhausted','deadline-exceeded'];
            if(valid.includes(error.code))throw new HttpsError(error.code,error.message);
            console.error('game-operations-failure',{code:typeof error.code==='string'?error.code:'internal'});
            throw new HttpsError('internal','服務暫時無法使用，請稍後以同一請求重試');
        }
    });
    return {
        gameOpsAdmin:wrap(service.adminAPI,{enforceAppCheck:!emulator&&adminAppCheckRequired}),
        // 唯讀公告仍核對 Auth、目前成員資格、帳號狀態及公告對象。
        gameOpsAnnouncements:wrap(service.announcements,{enforceAppCheck:false}),
        gameOpsGuardDog:wrap(service.guardDog,{enforceAppCheck:false}),
        gameOpsRedeem:wrap(service.redeem,{enforceAppCheck:!emulator&&redemptionAppCheckRequired})
    };
}
module.exports={createCallables};
