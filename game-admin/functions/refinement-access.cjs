/** Phase 5 is restricted to explicitly listed isolated-test farm scopes. */
function testAccess(testEnvironment,accounts=[]){
 const scopes=new Set(accounts.map(a=>JSON.stringify([a.uid,a.groupId,a.accountId])));
 return actor=>testEnvironment===true&&!!actor&&scopes.has(JSON.stringify([actor.uid,actor.groupId,actor.accountId]));
}
module.exports={testAccess};
