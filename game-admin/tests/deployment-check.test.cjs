const test=require('node:test'),assert=require('node:assert/strict');
const {diagnose,headerValues}=require('../../scripts/check-game-ops.cjs');
const valid={status:204,origin:'https://duncanyen.github.io',methods:'POST',headers:'authorization,content-type,x-firebase-appcheck'};
test('preflight diagnostics distinguish network, missing deployment, rejected ingress and failed startup',()=>{
 for(const [status,code]of [[0,'NETWORK_ERROR'],[404,'NOT_FOUND'],[403,'INGRESS_DENIED'],[401,'INGRESS_DENIED'],[503,'SERVER_ERROR']])assert.equal(diagnose({status}).code,code);
});
test('a successful HTTP response alone does not prove usable CORS',()=>{
 assert.equal(diagnose(valid).ok,true);
 assert.equal(diagnose({...valid,origin:undefined}).code,'CORS_ORIGIN');
 assert.equal(diagnose({...valid,origin:'https://other.example'}).code,'CORS_ORIGIN');
 assert.equal(diagnose({...valid,methods:'GET'}).code,'CORS_METHOD');
 assert.equal(diagnose({...valid,headers:'content-type'}).code,'CORS_HEADERS');
});
test('proxy CONNECT response is not mistaken for the callable response',()=>{
 const raw='HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 404\r\nserver: Google Frontend\r\n\r\n';
 assert.deepEqual(headerValues(raw),{server:'Google Frontend'});
});
