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
 assert.deepEqual(R.options(['--full','--output','/tmp/full-proof']),{full:true,out:'/tmp/full-proof'});
 assert.deepEqual(R.options(['--output','/tmp/core-proof']),{full:false,out:'/tmp/core-proof'});
 assert.throws(()=>R.options(['--full','--project','homebasedb']));assert.throws(()=>R.options(['--full','--full']));
 assert.equal(R.result('# tests 9\n# pass 9\n# fail 0\n# cancelled 0\n# skipped 0\n',0,9).passed,true);
 assert.equal(R.result('# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n',0,9).passed,false);
});
