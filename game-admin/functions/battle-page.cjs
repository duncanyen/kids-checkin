/** 頁面離開只作廢未結算戰鬥，不發獎、不扣損失、不改累積擊殺／任務。 */
const D=require('./domain.cjs');
const intervals={giant:50,cobra:100,mole:30};
function assertBattlePage(session,pageId){
 if(session?.ownerPageId&&(session.ownerPageId!==pageId||session.pageClosed))D.fail('failed-precondition','目前遊戲頁面已失效，請重新載入');
}
function changeBattlePage({farm,session,pageId,stamp,close=false}){
 const patch={},pending=!!session&&!session.result;
 for(const kind of Object.keys(intervals)){
  const challenge=farm?.[kind+'Challenge'];
  if(!challenge||session?.result&&session.id===challenge.id)continue;
  // 僅退回此場開戰時消耗的門檻，保留所有既有擊殺／抓蟲進度。
  patch['farm.'+kind+'Challenge']=null;
  if(Number.isSafeInteger(challenge.milestone)&&farm[kind+'LastMilestone']===challenge.milestone){
   const prior=session?.id===challenge.id?session.previousMilestone:undefined;
   patch['farm.'+kind+'LastMilestone']=Number.isSafeInteger(prior)&&prior>=0?prior:Math.max(0,challenge.milestone-intervals[kind]);
  }
 }
 return{patch,session:{ownerPageId:pageId,pageClosed:close,kind:null,result:{outcome:'abandoned'},changedAt:stamp},abandoned:pending||Object.keys(patch).length>0};
}
module.exports={assertBattlePage,changeBattlePage};
