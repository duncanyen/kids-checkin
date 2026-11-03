import { GAME_OPERATIONS_ENABLED, OPERATIONS_APP_CHECK_SITE_KEY } from './operations-config.js';
export { GAME_OPERATIONS_ENABLED } from './operations-config.js';
export function createGameOperationsClient(context) {
    let connecting;
    async function connect(){
        if(!GAME_OPERATIONS_ENABLED)throw Error('公告與禮包服務尚未啟用，請稍後再試。');
        if(!connecting)connecting=(async()=>{
            const [appSDK,authSDK,functionSDK,config]=await Promise.all([
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js'),import('../firebase-config.js')
            ]);
            const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
            if(user?.accountId!==context.accountId)throw Error('玩家身分已變更，請重新登入。');
            const app=appSDK.getApps().find(a=>a.name==='nexus-operations-player')||appSDK.initializeApp(config.firebaseConfig,'nexus-operations-player');
            if(OPERATIONS_APP_CHECK_SITE_KEY){const check=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js');check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(OPERATIONS_APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});}
            const functions=functionSDK.getFunctions(app,'asia-southeast1'),auth=authSDK.getAuth(app);
            // Reuse the existing server-validated player-to-Firebase Auth bridge.
            const session=await functionSDK.httpsCallable(functions,'photoSession')({accountId:context.accountId,groupId:context.groupId,secret:user.password||user.pin||''});
            await authSDK.setPersistence(auth,authSDK.inMemoryPersistence);await authSDK.signInWithCustomToken(auth,session.data.token);
            return async(name,payload)=>(await functionSDK.httpsCallable(functions,name)({...payload,groupId:context.groupId})).data;
        })().catch(error=>{connecting=null;throw error;});
        return connecting;
    }
    return{
        async announcements(cursor){return(await connect())('gameOpsAnnouncements',{cursor:cursor||null});},
        async redeem(code){
            const normalized=String(code).normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
            const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
            const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
            const key=`nexus.ops.pending:${context.accountId}:${context.groupId}:${hash}`;
            const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
            const response=await(await connect())('gameOpsRedeem',{code,requestId});
            sessionStorage.removeItem(key);return response;
        }
    };
}
