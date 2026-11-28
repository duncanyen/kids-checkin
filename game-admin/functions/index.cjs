const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createService}=require('./service.cjs');
const {createCallables}=require('./callables.cjs');
initializeApp();
const {defineBoolean}=require('firebase-functions/params');
const privateIdentityEnabled=defineBoolean('NEXUS_PRIVATE_IDENTITY_ENABLED',{default:false});
const farmBackendEnabled=defineBoolean('NEXUS_FARM_BACKEND_ENABLED',{default:false});
const refinementReleaseControlEnabled=defineBoolean('NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED',{default:false});
const service=createService({db:getFirestore(),auth:getAuth(),privateIdentityEnabled:()=>privateIdentityEnabled.value(),farmBackendEnabled:()=>farmBackendEnabled.value(),refinementReleaseControlEnabled:()=>refinementReleaseControlEnabled.value()});
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

// Includes Console edits and announcements maintained by the event-management API.
const {bumpFeedVersion}=require('./feed-version.cjs');
for(const [name,document]of [['gameOpsAnnouncementVersion','ops_announcements/{id}'],['gameOpsNotificationVersion','ops_notifications/{id}']]){
 module.exports[name]=onDocumentWritten({document,region:'asia-east1',retry:true,maxInstances:3},event=>bumpFeedVersion(getFirestore(),event.id));
}

// Phase7 observers only: failures retry independently of the completed economic transaction.
const refinementStats=require('./refinement-statistics.cjs').createRefinementStatistics({db:getFirestore()});
const refinementSnapshots=require('./refinement-snapshots.cjs').createSnapshots({db:getFirestore()});
for(const [name,document,handler] of [
 ['gameOpsRefinementReceipt','ops_refinement_transactions/{id}',e=>refinementStats.captureReceipt(e.params.id,e.data.after.data())],
 ['gameOpsRefinementDailyStone','ops_daily_grants/{id}',e=>refinementStats.captureReward('daily',e.params.id,e.data.after.data())],
 ['gameOpsRefinementGiftStone','ops_redemptions/{id}',e=>refinementStats.captureReward('gift',e.params.id,e.data.after.data())],
 ['gameOpsRefinementChestStone','ops_farm_chests/{owner}/boxes/{id}',e=>refinementStats.captureReward('chest',e.params.id,e.data.after.data())],
 ['gameOpsRefinementEconomy','ops_farm_report_events/{id}',e=>refinementStats.captureEconomy(e.params.id,e.data.after.data())],
 ['gameOpsRefinementBattle','ops_verified_farm_events/{id}',e=>refinementStats.captureBattle(e.params.id,e.data.after.data())],
 ['gameOpsRefinementState','ops_weapon_owners/{owner}/states/{id}',e=>refinementStats.captureState(e.data.after.ref.path,e.data.after.data())],
 ['gameOpsRefinementFarmSnapshot','groups/{groupId}/users/{accountId}',e=>refinementSnapshots.captureFarm({id:e.id,...e.params,farm:e.data.after.data()?.farm,before:e.data.before?.data()?.farm,occurredAt:e.data.after.updateTime.toMillis()})]
])module.exports[name]=onDocumentWritten({document,region:'asia-east1',retry:true,maxInstances:3},event=>{if(!event.data?.after?.exists)return;return handler(event);});
