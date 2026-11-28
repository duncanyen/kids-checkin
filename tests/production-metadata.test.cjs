const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('read-only production inventory: route boundaries, GET-only, redaction, auth failures and metadata integrity',()=>{
 const r=spawnSync('python3',[path.join(__dirname,'production-metadata-tests.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stderr,/Ran 10 tests/);
});
