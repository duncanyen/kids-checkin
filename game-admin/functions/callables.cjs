const {onCall,HttpsError}=require('firebase-functions/v2/https');
// Website attestation is optional for the admin endpoint. Authentication and
// current admin claims are always checked by service.adminAPI on the backend.
function createCallables(service,{adminAppCheckRequired=false,emulator=process.env.FUNCTIONS_EMULATOR==='true'}={}) {
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
        gameOpsAnnouncements:wrap(service.announcements),
        gameOpsRedeem:wrap(service.redeem)
    };
}
module.exports={createCallables};
