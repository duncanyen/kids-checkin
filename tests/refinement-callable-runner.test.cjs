const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const R=require('../scripts/run-refinement-callable-tests.cjs');
test('callable runner refuses production project contexts',()=>{
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])assert.throws(()=>R.childEnv({[key]:'homebasedb'}),/非demo/);
});
test('callable runner isolates SDK endpoints and drops inherited credentials',()=>{
 const original={GOOGLE_APPLICATION_CREDENTIALS:'/fake/credential',FIREBASE_TOKEN:'fake-token',FIREBASE_CONFIG:'{"projectId":"homebasedb"}',NODE_OPTIONS:'--require=untrusted-hook',FIRESTORE_EMULATOR_HOST:'production.example:443'};
 const env=R.childEnv(original);
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_CONFIG','NODE_OPTIONS'])assert.equal(env[key],undefined);
 assert.equal(env.GCLOUD_PROJECT,'demo-nexus-private-farm');assert.equal(env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8092');assert.equal(env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9098');assert.equal(env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:9008');assert.equal(env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:9198');assert.equal(original.FIREBASE_TOKEN,'fake-token');
});
test('CLI exit zero or incomplete TAP cannot masquerade as completed HTTP/Rules tests',()=>{
 assert.equal(R.result('Clean shutdown',0).passed,false);
 assert.equal(R.result('# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n',0).passed,true);
 for(const [text,exit]of [['# tests 1\n# pass 1\n',0],['# tests 6\n# pass 6\n# fail 1\n',0],['# tests 6\n# pass 6\n# skipped 1\n',0],['# tests 6\n# pass 6\n',1],['# tests 6\n# pass 6\nnot ok 2 - denied\n',0]])assert.equal(R.result(text,exit).passed,false);
});
test('runner accepts only local output selection, never deploy/project/apply',()=>{
 assert.equal(R.parse(['--output','/tmp/callable-proof']),path.resolve('/tmp/callable-proof'));
 for(const args of [['--project','homebasedb'],['--deploy'],['--apply'],['--output','/tmp/proof','--force']])assert.throws(()=>R.parse(args));
});

test('full mode selects only additional local emulators and keeps project/deploy overrides rejected',()=>{
 assert.deepEqual(R.options(['--full','--output','/tmp/full-proof']),{full:true,refinement:false,out:'/tmp/full-proof'});
 assert.deepEqual(R.options(['--output','/tmp/core-proof']),{full:false,refinement:false,out:'/tmp/core-proof'});
 assert.throws(()=>R.options(['--full','--project','homebasedb']));assert.throws(()=>R.options(['--full','--full']));
 assert.equal(R.result('# tests 9\n# pass 9\n# fail 0\n# cancelled 0\n# skipped 0\n',0,9).passed,true);
 assert.equal(R.result('# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n',0,9).passed,false);
});

test('full mode registers Firestore with the same CLI as Storage and never starts an external duplicate',()=>{
 const p=R.emulatorPlan(true,'/tmp/isolated-source');
 assert.equal(p.externalFirestore,false);
 assert.ok(p.only.split(',').includes('firestore'));
 assert.equal(p.config.emulators.firestore.host,'127.0.0.1');assert.equal(p.config.emulators.firestore.port,8092);
 assert.equal(p.config.firestore.rules,'/tmp/isolated-source/rules/firestore.private-farm.candidate.rules');
 assert.equal(p.config.emulators.storage.port,9198);assert.equal(p.expectedTests,9);
 const core=R.emulatorPlan(false);assert.equal(core.externalFirestore,true);assert.equal(core.config.firestore,undefined);assert.equal(core.only,'auth,functions');
});
test('interrupted TAP retains observed successes without inventing a complete passing result',()=>{
 const text=Array.from({length:7},(_,i)=>`ok ${i+1} - completed case`).join('\n')+'\nError: unexpected error\n';
 const r=R.result(text,2,9);assert.equal(r.tests,0);assert.equal(r.observedPass,7);assert.equal(r.summaryPresent,false);assert.equal(r.passed,false);
 assert.equal(R.result('# tests 9\n# pass 9\n',0,9).passed,false);
});
test('unsupported Node fails early instead of falling through to a missing CLI',()=>{
 assert.doesNotThrow(()=>R.assertRuntime('22.23.4'));
 for(const version of ['26.13.0','20.19.0',''])assert.throws(()=>R.assertRuntime(version),/需要 Node 22/);
});
test('official artifact checks reject missing or different bytes',()=>{
 const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'artifact-check-'));
 try{const file=path.join(dir,'test.jar');fs.writeFileSync(file,'synthetic-test-bytes');const sha=crypto.createHash('sha256').update('synthetic-test-bytes').digest('hex');
 const a=R.verifyArtifacts([{file,expectedSha256:sha},{file,expectedSha256:'bad'},{file:path.join(dir,'missing.jar'),expectedSha256:sha}]);assert.deepEqual(a.map(x=>x.verified),[true,false,false]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('refinement mode is explicit, composes with full and cannot pass through production arguments',()=>{
 assert.deepEqual(R.options(['--full','--refinement','--output','/tmp/scoped-http']),{full:true,refinement:true,out:'/tmp/scoped-http'});
 assert.throws(()=>R.options(['--refinement','--refinement']));
 assert.throws(()=>R.options(['--refinement','--project','homebasedb']));
 assert.equal(require('../game-admin/tests/helpers/refinement-http-spec.cjs').caseCount,21);
});
