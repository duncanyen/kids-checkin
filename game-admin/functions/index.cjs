const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createService}=require('./service.cjs');
const {createCallables}=require('./callables.cjs');
initializeApp();
const service=createService({db:getFirestore(),auth:getAuth()});
module.exports=createCallables(service);

// 僅觀測已提交的農場資料；不修改玩家存檔，也不對外開放寫入報表的 callable。
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {createReporting}=require('./reporting.cjs');
const reporting=createReporting({db:getFirestore()});
module.exports.gameOpsFarmReportCapture=onDocumentWritten({document:'groups/{groupId}/users/{accountId}',region:'asia-southeast1',retry:true,maxInstances:5},event=>{
 const before=event.data?.before,after=event.data?.after;
 if(!before?.exists||!after?.exists)return;
 return reporting.capture({id:event.id,...event.params,before:before.data()?.farm,after:after.data()?.farm,occurredAt:after.updateTime.toMillis()});
});
