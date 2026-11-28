/** Immutable config versions, published by an authenticated admin only. */
const D=require('./domain.cjs'),Core=require('./refinement-core.cjs');
const pointerPath='ops_game_config/refining',versionPath=version=>'ops_refinement_versions/'+D.id(version);
async function active(db,t,stamp){
 const pointer=(await t.get(db.doc(pointerPath))).data();if(!pointer||pointer.schemaVersion!==1)Core.reject('CONFIG_UNPUBLISHED','精煉設定尚未發布');
 D.integer(pointer.revision,1,Number.MAX_SAFE_INTEGER-1);
 const raw=(await t.get(db.doc(versionPath(pointer.activeVersion)))).data();let config;
 try{config=Core.validateConfig(raw);}catch{Core.reject('CONFIG_INVALID','精煉設定無效，停止扣款');}
 if(config.version!==pointer.activeVersion||raw.contentHash!==D.fingerprint(config)||config.effectiveAt>stamp)Core.reject('CONFIG_INVALID','精煉版本內容或生效時間不符');
 return{config,contentHash:raw.contentHash,revision:pointer.revision};
}
async function publish({db,t,uid,input,requestId,stamp}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['config','expectedRevision'].includes(key)))D.fail('invalid-argument','精煉發布資料格式無效');
 D.integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER-2);
 const config=Core.validateConfig(input.config);if(config.effectiveAt>stamp)D.fail('invalid-argument','本階段只支援立即生效版本，不支援排程發布');
 const ref=db.doc(versionPath(config.version)),pointer=db.doc(pointerPath),receipt=db.doc('ops_refinement_config_requests/'+D.hash(uid+':'+requestId)),hash=D.fingerprint(input);
 const [old,existing,prior]=await Promise.all([t.get(pointer),t.get(ref),t.get(receipt)]);
 if(prior.exists){if(prior.data().fingerprint!==hash)D.fail('already-exists','交易編號已用於其他設定');return{response:{...prior.data().response,replayed:true},commit:()=>{}};}
 if(existing.exists)D.fail('already-exists','設定版本已存在，不可覆寫');
 if(input.expectedRevision!==(old.data()?.revision||0))D.fail('failed-precondition','設定已更新，請重新確認');
 const revision=(old.data()?.revision||0)+1,contentHash=D.fingerprint(config),response={version:config.version,revision,contentHash};
 return{response,commit:()=>{t.create(ref,{...config,contentHash,publishedBy:uid,publishedAt:stamp});t.set(pointer,{schemaVersion:1,activeVersion:config.version,revision,updatedAt:stamp,updatedBy:uid});t.create(db.doc('ops_audit/refinement-'+D.hash(uid+':'+requestId)),{action:'publishRefinementConfig',adminUid:uid,createdAt:stamp,before:old.data()||null,after:{version:config.version,revision,contentHash},result:'success',requestId});t.create(receipt,{fingerprint:hash,response,createdAt:stamp});}};
}
module.exports={pointerPath,versionPath,active,publish};
