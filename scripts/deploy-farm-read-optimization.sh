#!/usr/bin/env bash
# Cloud Shell only: deploy the scoped read optimization after verified evidence.
set -euo pipefail
NEXUS_READOPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NEXUS_READOPT_ROOT"
export NEXUS_READOPT_PROOF="${1:?請提供本次 Emulator 通過的 verification.json 路徑}"

node <<'JS'
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const proof=JSON.parse(fs.readFileSync(process.env.NEXUS_READOPT_PROOF,'utf8'));
if(proof.schema!==1||![proof.unitPassed,proof.browserPassed,proof.emulatorPassed].every(v=>v===true))throw Error('本次測試尚未全部通過，停止部署');
if(proof.codeSha256!==require('./scripts/private-code-hash.cjs')())throw Error('驗證報告與目前程式不同，請重新驗證；停止部署');
for(const [key,file]of [['rulesSha256','rules/firestore.private-farm.candidate.rules'],['storageRulesSha256','rules/storage.private-farm.candidate.rules'],['databaseRulesSha256','rules/database.private-farm.candidate.json']]){
 if(proof[key]!==crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))throw Error('驗證報告的規則版本不同，停止部署');
}
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_DATABASE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FIREBASE_EMULATOR_HUB'])if(process.env[name])throw Error('目前仍設定 '+name+'，請先清除 Emulator 環境再部署');
if(process.env.FUNCTIONS_EMULATOR==='true')throw Error('目前仍為 Emulator 環境，停止正式部署');
const field='farm.stolenEggs20261116';
const value=JSON.parse(execFileSync('gcloud',['firestore','indexes','fields','describe',field,'--project','homebasedb','--database','(default)','--collection-group','users','--format=json'],{encoding:'utf8'}));
const index=value.indexConfig?.indexes?.find(i=>i.queryScope==='COLLECTION_GROUP'&&(i.order==='DESCENDING'||i.fields?.some(f=>f.fieldPath===field&&f.order==='DESCENDING')));
if(index?.state!=='READY')throw Error('排行榜索引尚未 READY，停止部署；等待後再執行本腳本');
console.log('驗證版本與排行榜索引檢查通過');
JS

cd game-admin
firebase deploy --project homebasedb \
  --only "functions:nexus-ops:gameOpsAnnouncements,functions:nexus-ops:gameOpsFarmTransaction,functions:nexus-ops:gameOpsAdmin,functions:nexus-ops:gameOpsAnnouncementVersion,functions:nexus-ops:gameOpsNotificationVersion"

for NEXUS_READOPT_FUNCTION in gameOpsAnnouncements gameOpsFarmTransaction gameOpsAdmin gameOpsAnnouncementVersion gameOpsNotificationVersion
do
  NEXUS_READOPT_STATE="$(gcloud functions describe "$NEXUS_READOPT_FUNCTION" --gen2 --region asia-east1 --project homebasedb --format='value(state)')"
  if [ "$NEXUS_READOPT_STATE" != ACTIVE ]; then
    echo "$NEXUS_READOPT_FUNCTION 尚未 ACTIVE；停止初始化公告版本"
    exit 1
  fi
done

cd "$NEXUS_READOPT_ROOT"
node scripts/initialize-farm-feed-version.cjs --project homebasedb --apply
echo "讀取優化後端部署與公告版本檢查完成；請繼續遊戲小範圍驗收"
