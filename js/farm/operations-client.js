import { GAME_ANNOUNCEMENTS_ENABLED, GAME_REDEMPTION_ENABLED, ANNOUNCEMENTS_APP_CHECK_REQUIRED, OPERATIONS_APP_CHECK_SITE_KEY } from './operations-config.js?v=20261108-announcements';
export { GAME_OPERATIONS_ENABLED, GAME_ANNOUNCEMENTS_ENABLED, GAME_REDEMPTION_ENABLED } from './operations-config.js?v=20261108-announcements';
export function createGameOperationsClient(context) {
    const connections=new Map();
    async function connect(mode){
        if(!(mode==='redeem'?GAME_REDEMPTION_ENABLED:GAME_ANNOUNCEMENTS_ENABLED))throw Error(mode==='redeem'?'禮包服務尚未啟用。':'公告服務尚未啟用。');
        const requiresCheck=mode==='redeem'||ANNOUNCEMENTS_APP_CHECK_REQUIRED;
        if(requiresCheck&&!OPERATIONS_APP_CHECK_SITE_KEY)throw Error('玩家 App Check 尚未設定，請稍後再試。');
        if(!connections.has(mode))connections.set(mode,(async()=>{
            const [appSDK,authSDK,functionSDK,config]=await Promise.all([
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js'),import('../firebase-config.js')
            ]);
            const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
            if(user?.accountId!==context.accountId)throw Error('玩家身分已變更，請重新登入。');
            const appName=mode==='redeem'?'nexus-operations-redeem':'nexus-operations-player';
            const app=appSDK.getApps().find(a=>a.name===appName)||appSDK.initializeApp(config.firebaseConfig,appName);
            if(requiresCheck){const check=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js');check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(OPERATIONS_APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});}
            const functions=functionSDK.getFunctions(app,'asia-southeast1'),auth=authSDK.getAuth(app);
            // Reuse the existing server-validated player-to-Firebase Auth bridge.
            const session=await functionSDK.httpsCallable(functions,'photoSession')({accountId:context.accountId,groupId:context.groupId,secret:user.password||user.pin||''});
            await authSDK.setPersistence(auth,authSDK.inMemoryPersistence);await authSDK.signInWithCustomToken(auth,session.data.token);
            return async(name,payload)=>{
                const current=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
                if(current?.accountId!==context.accountId||(localStorage.getItem('lastGroupId')||current.groupId)!==context.groupId)throw Error('玩家或群組已變更，請重新進入村落。');
                return(await functionSDK.httpsCallable(functions,name)({...payload,groupId:context.groupId})).data;
            };
        })().catch(error=>{connections.delete(mode);throw error;}));
        return connections.get(mode);
    }
    return{
        async announcements(cursor){return(await connect('announcements'))('gameOpsAnnouncements',{cursor:cursor||null});},
        async redeem(code){
            if(!GAME_REDEMPTION_ENABLED)throw Error('禮包服務尚未啟用。');
            const normalized=String(code).normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
            const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
            const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
            const key=`nexus.ops.pending:${context.accountId}:${context.groupId}:${hash}`;
            const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
            const response=await(await connect('redeem'))('gameOpsRedeem',{code,requestId});
            sessionStorage.removeItem(key);return response;
        }
    };
}
