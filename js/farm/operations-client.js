import { GAME_ANNOUNCEMENTS_ENABLED, GAME_REDEMPTION_ENABLED, ANNOUNCEMENTS_APP_CHECK_REQUIRED, REDEMPTION_APP_CHECK_REQUIRED, OPERATIONS_APP_CHECK_SITE_KEY } from './operations-config.js?v=20261108-messages-optional';
export { GAME_OPERATIONS_ENABLED, GAME_ANNOUNCEMENTS_ENABLED, GAME_REDEMPTION_ENABLED } from './operations-config.js?v=20261108-messages-optional';
export function createGameOperationsClient(context,{timeoutMs=20000}={}) {
    const connections=new Map();
    const redemptions=new Map(),guardChanges=new Map();
    const timeoutError=()=>Object.assign(Error('連線逾時，兌換結果尚未確認。請稍後使用同一活動碼重試，不會重複發獎。'),{code:'ops/timeout'});
    const guardTimeoutError=()=>Object.assign(Error('護衛犬操作連線逾時，請稍後到倉庫確認或重試；同一請求不會重複扣款。'),{code:'ops/timeout'});
    async function withDeadline(work,timeoutFailure=timeoutError){
        let timer;
        try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeoutFailure()),timeoutMs);})]);}
        finally{clearTimeout(timer);}
    }
    async function connect(mode){
        if(!(mode==='guard'||(mode==='redeem'?GAME_REDEMPTION_ENABLED:GAME_ANNOUNCEMENTS_ENABLED)))throw Error(mode==='redeem'?'禮包服務尚未啟用。':'公告服務尚未啟用。');
        const requiresCheck=mode==='guard'?false:mode==='redeem'?REDEMPTION_APP_CHECK_REQUIRED:ANNOUNCEMENTS_APP_CHECK_REQUIRED;
        if(requiresCheck&&!OPERATIONS_APP_CHECK_SITE_KEY)throw Error('玩家 App Check 尚未設定，請稍後再試。');
        if(!connections.has(mode))connections.set(mode,(async()=>{
            const [appSDK,authSDK,functionSDK,config]=await Promise.all([
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js'),import('../firebase-config.js')
            ]);
            const user=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
            if(user?.accountId!==context.accountId)throw Error('玩家身分已變更，請重新登入。');
            const appName=mode==='guard'?'nexus-guard-dogs':mode==='redeem'?'nexus-operations-redeem':'nexus-operations-player';
            const app=appSDK.getApps().find(a=>a.name===appName)||appSDK.initializeApp(config.firebaseConfig,appName);
            if(requiresCheck){const check=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js');check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(OPERATIONS_APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});}
            const functions=functionSDK.getFunctions(app,'asia-southeast1'),auth=authSDK.getAuth(app);
            // Reuse the existing server-validated player-to-Firebase Auth bridge.
            const session=await functionSDK.httpsCallable(functions,'photoSession',{timeout:timeoutMs})({accountId:context.accountId,groupId:context.groupId,secret:user.password||user.pin||''});
            await authSDK.setPersistence(auth,authSDK.inMemoryPersistence);await authSDK.signInWithCustomToken(auth,session.data.token);
            return async(name,payload)=>{
                const current=JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');
                if(current?.accountId!==context.accountId||(localStorage.getItem('lastGroupId')||current.groupId)!==context.groupId)throw Error('玩家或群組已變更，請重新進入村落。');
                return(await functionSDK.httpsCallable(functions,name,{timeout:timeoutMs})({...payload,groupId:context.groupId})).data;
            };
        })().catch(error=>{connections.delete(mode);throw error;}));
        return connections.get(mode);
    }
    return{
        async announcements(cursor,channel='announcements'){return(await connect('announcements'))('gameOpsAnnouncements',{cursor:cursor||null,channel});},
        async guardDog(action,payload={}){
            const key=`nexus.guard.pending:${context.accountId}:${context.groupId}:${action}:${JSON.stringify(payload)}`;
            if(guardChanges.has(key))return guardChanges.get(key);
            const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
            const expiresAt=Date.now()+timeoutMs;
            const pending=withDeadline(async()=>{const api=await connect('guard');if(Date.now()>=expiresAt)throw guardTimeoutError();return api('gameOpsGuardDog',{action,...payload,requestId});},guardTimeoutError)
                .then(result=>{sessionStorage.removeItem(key);return result;})
                .catch(error=>{if(['ops/timeout','functions/unauthenticated'].includes(error.code))connections.delete('guard');throw error;})
                .finally(()=>guardChanges.delete(key));
            guardChanges.set(key,pending);return pending;
        },
        async redeem(code){
            if(!GAME_REDEMPTION_ENABLED)throw Error('禮包服務尚未啟用。');
            const normalized=String(code).normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
            if(!/^[A-Z0-9]{8,64}$/.test(normalized))throw Error('兌換碼須為 8–64 位英文字母或數字，請確認是否完整複製。');
            const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
            const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
            const key=`nexus.ops.pending:${context.accountId}:${context.groupId}:${hash}`;
            if(redemptions.has(key))return redemptions.get(key);
            const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
            const expiresAt=Date.now()+timeoutMs;
            const pending=withDeadline(async()=>{
                const api=await connect('redeem');
                if(Date.now()>=expiresAt)throw timeoutError();
                return api('gameOpsRedeem',{code:normalized,requestId});
            }).then(response=>{
                if(!Array.isArray(response?.rewards))throw Error('未能確認獎勵明細，請使用同一活動碼重試。');
                // A late response after the deadline must not clear the retry receipt.
                sessionStorage.removeItem(key);return response;
            }).catch(error=>{
                if(['ops/timeout','functions/unauthenticated'].includes(error.code))connections.delete('redeem');
                throw error;
            }).finally(()=>redemptions.delete(key));
            redemptions.set(key,pending);return pending;
        }
    };
}
