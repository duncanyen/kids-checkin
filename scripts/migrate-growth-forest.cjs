// Dry-run by default. Run only in a trusted owner environment with ADC.
const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs');
const backend=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeApp}=backend('firebase-admin/app'),{getFirestore}=backend('firebase-admin/firestore');
const {createGrowthService}=require('../functions/growth-service.cjs');
require('./prepare-growth-forest.cjs');
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1],groupId=args.includes('--group')?value('--group'):null,actor=args.includes('--actor')?value('--actor'):null;
if(!groupId||!actor){console.error('Usage: node scripts/migrate-growth-forest.cjs --project homebasedb --group GROUP_ID --actor PARENT_ACCOUNT_ID [--apply] [--report report.json]');process.exit(2);}
(async()=>{
 const projectId=args.includes('--project')?value('--project'):'homebasedb',apply=args.includes('--apply');
 if(process.env.FIRESTORE_EMULATOR_HOST&&!projectId.startsWith('demo-'))throw Error('Emulator requires a demo project');
 const db=getFirestore(initializeApp({projectId})),service=createGrowthService({db});
 const profiles=await db.collection('users').where('accountId','==',actor).limit(2).get();if(profiles.size!==1)throw Error('Parent identity must resolve uniquely');
 const request={auth:{uid:profiles.docs[0].id,token:{photoAccountId:actor,photoGroupId:groupId}},data:{groupId}};
 const c=await service.context(request);if(!c.parent)throw Error('Actor must be a parent in the selected group');
 const legacy=await import('../functions/game/wishwall-core.mjs');
 const setting=(await db.doc(`groups/${groupId}/settings/wishWall`).get()).data(),settings=legacy.normalizeSettings(setting||legacy.DEFAULT_SETTINGS);
 const [scoreSnap,redeemSnap]=await Promise.all(['scores','redeems'].map(kind=>db.collection(`groups/${groupId}/${kind}`).get()));
 const rows=snap=>snap.docs.map(d=>({...d.data(),id:d.id})),scores=rows(scoreSnap),redeems=rows(redeemSnap),points=legacy.calculatePoints(scores,redeems,settings,groupId).balances;
 const report={schemaVersion:1,projectId,groupId,mode:apply?'apply':'dry-run',createdAt:new Date().toISOString(),unboundScores:scores.filter(r=>!r.accountId).map(r=>r.id),unboundRequests:redeems.filter(r=>!r.accountId).map(r=>r.id),mismatchedRows:[...scores,...redeems].filter(r=>r.groupId&&r.groupId!==groupId).map(r=>r.id),members:[]};
 for(const accountId of c.group.members){
  const row={accountId,legacyAvailable:points.get(accountId)||0,alreadyMigrated:(await db.doc(`groups/${groupId}/growthProfiles/${accountId}`).get()).exists};
  if(apply){try{const w=await service.ensureProfile(request,accountId);row.state='preserved';row.balance=w.pointsBalance;row.reserved=w.pointsReserved;}catch(error){row.state='needs-review';row.reason=error.message;}}
  report.members.push(row);
 }
 if(args.includes('--report'))fs.writeFileSync(value('--report'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report,null,2));if(report.members.some(r=>r.state==='needs-review'))process.exitCode=1;
})().catch(error=>{console.error('Migration stopped:',error.message);process.exitCode=1;});
