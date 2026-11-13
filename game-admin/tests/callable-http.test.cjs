const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),path=require('node:path');
const backend=createRequire(path.resolve(__dirname,'../functions/package.json'));
const express=backend('express');
const functions=require('../functions/index.cjs');

test('GitHub Pages preflight reaches each callable and anonymous POST stays denied with CORS headers',async()=>{
    const app=express();app.use(express.json());
    for(const name of ['gameOpsAdmin','gameOpsAnnouncements','gameOpsRedeem','gameOpsDailyChallenges']){
        const callable=functions[name];
        assert.ok(callable.__endpoint.callableTrigger);
        assert.deepEqual(callable.__endpoint.region,['asia-southeast1']);
        app.all('/'+name,callable);
    }
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    try{
        for(const name of ['gameOpsAdmin','gameOpsAnnouncements','gameOpsRedeem','gameOpsDailyChallenges']){
            const url=`http://127.0.0.1:${server.address().port}/${name}`,origin='https://duncanyen.github.io';
            const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-firebase-appcheck'}});
            assert.equal(preflight.status,204);
            assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
            assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);
            assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
            const denied=await fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({data:{action:'dashboard'}})});
            assert.equal(denied.status,401);
            assert.equal(denied.headers.get('access-control-allow-origin'),origin);
            assert.equal((await denied.json()).error.status,'UNAUTHENTICATED');
        }
        // Optional App Check lets a signed-in request reach payload validation.
        // Missing groupId is rejected before any real database access.
        const auth=backend('firebase-admin/auth').getAuth();
        const verify=auth.verifyIdToken,getUser=auth.getUser;
        let accountLookups=0;
        auth.verifyIdToken=async()=>({uid:'isolated-player',photoAccountId:'player',photoGroupId:'A'});
        auth.getUser=async()=>{accountLookups++;throw Error('Invalid payload must reject before the account lookup');};
        try{
            const response=await fetch(`http://127.0.0.1:${server.address().port}/gameOpsRedeem`,{method:'POST',headers:{Origin:'https://duncanyen.github.io','Content-Type':'application/json',Authorization:'Bearer isolated-test-token'},body:JSON.stringify({data:{action:'dashboard'}})});
            assert.equal(response.status,400);
            assert.equal((await response.json()).error.status,'INVALID_ARGUMENT');
            assert.equal(accountLookups,0,'invalid groupId is rejected without account/database access');
        }finally{auth.verifyIdToken=verify;auth.getUser=getUser;}
        const {promisify}=require('node:util'),{execFile}=require('node:child_process');
        const {stdout}=await promisify(execFile)(process.execPath,[path.resolve(__dirname,'../../scripts/check-game-ops.cjs'),'--base-url',`http://127.0.0.1:${server.address().port}/`]);
        assert.equal((stdout.match(/PREFLIGHT_OK/g)||[]).length,3,'CLI validates every real callable preflight');
    }finally{await new Promise(resolve=>server.close(resolve));}
});
