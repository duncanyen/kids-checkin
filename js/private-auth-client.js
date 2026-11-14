import { PRIVATE_IDENTITY_ENABLED } from './identity-config.js';
export { PRIVATE_IDENTITY_ENABLED } from './identity-config.js';
let connected;
const safe=profile=>{const {password,pin,secret,token,...result}=profile;return result;};
async function connection(){
 if(!PRIVATE_IDENTITY_ENABLED)throw Error('私有登入尚未啟用');
 if(!connected)connected=Promise.all([import('./firebase-config.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js')]).then(async([config,authSDK,functionsSDK])=>{
  const auth=authSDK.getAuth(config.app);await auth.authStateReady();return{auth,authSDK,functionsSDK,functions:functionsSDK.getFunctions(config.app,'asia-southeast1')};
 }).catch(error=>{connected=null;throw error;});return connected;
}
export async function identityCall(action,payload={}){const c=await connection();return(await c.functionsSDK.httpsCallable(c.functions,'nexusIdentity',{timeout:20000})({action,...payload})).data;}
export async function privateLogin(identifier,secret){const result=await identityCall('login',{identifier,secret});await accept(result);return safe(result.profile);}
export async function privateRegister(payload){const result=await identityCall('register',payload);await accept(result);return safe(result.profile);}
async function accept(result){const c=await connection();await c.authSDK.setPersistence(c.auth,c.authSDK.browserSessionPersistence);await c.authSDK.signInWithCustomToken(c.auth,result.token);}
export async function privateChangePassword(currentSecret,newSecret){const result=await identityCall('changePassword',{currentSecret,newSecret});await accept(result);return safe(result.profile);}
export async function privateLogout(){const c=await connection();await c.authSDK.signOut(c.auth);for(const storage of [sessionStorage,localStorage])storage.removeItem('familyCheckInUser');}
export async function groupSession(groupId){return identityCall('groupToken',{groupId});}
export const sanitizeProfile=safe;

export async function privateBridge(name,groupId){if(!['photoSession','liveSession'].includes(name))throw Error('不支援的工作階段');const c=await connection();return(await c.functionsSDK.httpsCallable(c.functions,name,{timeout:20000})({groupId})).data;}

export async function privateUpdateProfile(name,currentSecret,newSecret){const result=await identityCall('updateProfile',{name,currentSecret,newSecret});if(result.token)await accept(result);return safe(result.profile);}

// 切換時清除舊瀏覽器留下的明文欄位；新工作階段只使用 Firebase Auth。
if(PRIVATE_IDENTITY_ENABLED){
 for(const storage of [sessionStorage,localStorage]){
  const raw=storage.getItem('familyCheckInUser');
  if(raw)try{storage.setItem('familyCheckInUser',JSON.stringify(safe(JSON.parse(raw))));}catch{storage.removeItem('familyCheckInUser');}
 }
}

export async function identityAdminCall(action,payload){
 const key='nexus.identity.pending:'+JSON.stringify([action,payload.groupId,payload.profileId||payload.accountId||payload.requestId||'']);
 const operationId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,operationId);
 try{const result=await identityCall(action,{...payload,operationId});sessionStorage.removeItem(key);return result;}
 catch(error){if(!['functions/internal','functions/unavailable','functions/deadline-exceeded'].includes(error.code))sessionStorage.removeItem(key);throw error;}
}

export const hasManagementAccess=user=>PRIVATE_IDENTITY_ENABLED?['owner','admin','parent'].includes(user?.groupRole):['admin','parent'].includes(user?.role);
