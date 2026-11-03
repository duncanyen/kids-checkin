import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,setPersistence,browserSessionPersistence,onAuthStateChanged,signInWithEmailAndPassword,signOut,getIdTokenResult,getMultiFactorResolver,TotpMultiFactorGenerator,multiFactor} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFunctions,httpsCallable,connectFunctionsEmulator} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {connectAuthEmulator} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js';
import {config} from './config.js';
const localEmulator=['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('emulators')==='1';
const app=initializeApp({...config,...(localEmulator?{projectId:'demo-nexus-ops'}:{})},'nexus-game-admin'),auth=getAuth(app),functions=getFunctions(app,config.region);
if(localEmulator){
    connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFunctionsEmulator(functions,'127.0.0.1',5001);
}else if(config.appCheckSiteKey){initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
await setPersistence(auth,browserSessionPersistence);
let resolver,totpSecret;
export const observe=callback=>onAuthStateChanged(auth,callback);
export const logout=()=>signOut(auth);
export const identity=async user=>{
    const token=await getIdTokenResult(user,true);
    return{uid:user.uid,email:user.email,admin:token.claims.role==='admin',mfa:!!token.claims.firebase?.sign_in_second_factor,enrolled:multiFactor(user).enrolledFactors.some(f=>f.factorId==='totp')};
};
export async function login(email,password){
    try{await signInWithEmailAndPassword(auth,email,password);return{};}
    catch(error){if(error.code!=='auth/multi-factor-auth-required')throw error;resolver=getMultiFactorResolver(auth,error);if(!resolver.hints.some(f=>f.factorId==='totp'))throw Error('此帳號需使用既有 MFA 驗證方式，請由擁有者協助設定 TOTP。');return{mfaRequired:true};}
}
export async function finishMfa(code){
    if(!resolver)throw Error('驗證階段已失效，請重新登入');
    const hint=resolver.hints.find(f=>f.factorId==='totp');
    await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid,code));resolver=null;
}
export async function beginEnrollment(){
    const session=await multiFactor(auth.currentUser).getSession();totpSecret=await TotpMultiFactorGenerator.generateSecret(session);
    return{secret:totpSecret.secretKey,uri:totpSecret.generateQrCodeUrl(auth.currentUser.email,'Nexus Game Admin')};
}
export async function finishEnrollment(code){
    if(!totpSecret)throw Error('設定已失效，請重新開始');
    await multiFactor(auth.currentUser).enroll(TotpMultiFactorGenerator.assertionForEnrollment(totpSecret,code),'管理員驗證器');totpSecret=null;await logout();
}
export async function api(action,payload={},requestId){
    const result=await httpsCallable(functions,'gameOpsAdmin')({action,payload,...(requestId?{requestId}:{})});return result.data;
}
