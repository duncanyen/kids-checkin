/** Evidence consistency check, not a signature or production release approval. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),P=require('./firestore-emulator-proof.cjs');
const required=['game-admin/tests/private-callables.emulator.cjs','game-admin/tests/private-farm-rules.emulator.cjs','game-admin/tests/refinement-http.emulator.cjs','game-admin/tests/helpers/refinement-http-spec.cjs','scripts/run-refinement-callable-tests.cjs'];
function verify(root,r){try{
 const expected=require(path.join(root,'game-admin/tests/helpers/refinement-http-spec.cjs')).caseCount,nested=r.refinementHTTP,counts=r.tests,expectedTotal=(r.fullRequested===true?9:6)+expected;
 if(r.project!=='demo-nexus-private-farm'||r.refinementHTTPRequested!==true||r.refinementPlayerFeaturesEnabled!==true||r.passed!==true||r.formalData!==false||r.deployed!==false||!r.completedAt||r.sourceChangedDuringRun!==false)return false;
 if(!counts||counts.summaryPresent!==true||counts.tests!==expectedTotal||counts.pass!==expectedTotal||counts.exitCode!==0||counts.fail||counts.cancelled||counts.skipped||counts.observedFail)return false;
 if(!nested||nested.project!==r.project||nested.passed!==true||nested.realAuth!==true||nested.realFunctionsHTTP!==true||nested.realFirestore!==true||nested.authOrHandlerMocks!==false||nested.productionData!==false||nested.deployed!==false||nested.expectedChecks!==expected)return false;
 const audit=nested.walletAudit;if(!audit||audit.verified!==true||!Array.isArray(audit.receipts)||!Array.isArray(audit.ledger)||audit.receipts.length<1||audit.receiptsCount!==audit.receipts.length||audit.ledgerCount!==audit.ledger.length||audit.ledger.length!==audit.receipts.length)return false;
 const keys=audit.ledger.map(x=>x.ownerId+':'+x.transactionId);if(new Set(keys).size!==keys.length)return false;
 for(const row of audit.ledger){const receipt=audit.receipts.find(x=>x.ownerId===row.ownerId&&x.transactionId===row.transactionId);if(!receipt||receipt.action!==row.action||!['refineWeapon','resetRefinement'].includes(row.action))return false;for(const k of ['coins','stones'])if(![row.before[k],row.after[k],row.amount[k]].every(x=>Number.isSafeInteger(x)&&x>=0)||row.amount[k]!==receipt.amount[k]||BigInt(row.after[k])-BigInt(row.before[k])!==BigInt(row.action==='resetRefinement'?1:-1)*BigInt(row.amount[k]))return false;}
 const names=[...fs.readFileSync(path.join(root,'game-admin/tests/refinement-http.emulator.cjs'),'utf8').matchAll(/^check\('([^']+)'/gm)].map(x=>x[1]);
 if(names.length!==expected||nested.checks?.length!==expected||new Set(nested.checks.map(x=>x.name)).size!==expected||nested.checks.some(x=>x.passed!==true||!names.includes(x.name)))return false;
 if(JSON.stringify(r.sourceSha256)!==JSON.stringify(P.hashes(root)))return false;
 for(const file of required)if(r.testHashes?.[file]!==crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'))return false;
 if(r.fullRequested){const names=['firestore','database','storage'],defs=r.emulator?.artifacts;if(r.emulator?.distribution!=='firebase-tools'||!Array.isArray(defs)||defs.length!==3||!Array.isArray(r.artifacts)||r.artifacts.length!==3||new Set(r.artifacts.map(x=>x.name)).size!==3||r.artifacts.some(x=>!names.includes(x.name)||x.verified!==true||!/^[a-f0-9]{64}$/.test(x.actualSha256||'')||x.actualSha256!==x.expectedSha256||defs.find(d=>d.name===x.name)?.expectedSha256!==x.expectedSha256))return false;}else {const pin=require('../setup-firestore-emulator.cjs').PIN;if(r.emulator?.distribution!=='cloud-sdk'||r.emulator.version!==pin.version||r.emulator.jarSha256!==pin.jarSha256)return false;}
 return true;
 }catch{return false;}}
module.exports={verify,required};
