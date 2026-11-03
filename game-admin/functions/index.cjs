const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createService}=require('./service.cjs');
initializeApp();
const service=createService({db:getFirestore(),auth:getAuth()});
const options={region:'asia-southeast1',cors:true,maxInstances:10,enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true'};
const wrap=handler=>onCall(options,async request=>{
    try{return await handler(request);}
    catch(error){
        const valid=['invalid-argument','unauthenticated','permission-denied','failed-precondition','not-found','already-exists','resource-exhausted','deadline-exceeded'];
        if(valid.includes(error.code))throw new HttpsError(error.code,error.message);
        console.error('game-operations-failure',{code:typeof error.code==='string'?error.code:'internal'});
        throw new HttpsError('internal','服務暫時無法使用，請稍後以同一請求重試');
    }
});
exports.gameOpsAdmin=wrap(service.adminAPI);
exports.gameOpsAnnouncements=wrap(service.announcements);
exports.gameOpsRedeem=wrap(service.redeem);
