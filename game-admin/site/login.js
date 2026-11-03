import * as runtime from './runtime.js';
const $=id=>document.getElementById(id),status=$('status');
let busy=false;
const message=error=>({'auth/invalid-credential':'登入失敗，請確認帳號或密碼。','auth/too-many-requests':'嘗試次數過多，請稍後再試。','auth/network-request-failed':'網路連線失敗，請稍後重試。','auth/invalid-verification-code':'驗證碼不正確，請重新輸入。','auth/unverified-email':'設定 MFA 前請先完成電子郵件驗證。','auth/requires-recent-login':'請重新登入後再設定 MFA。'}[error.code]||error.message||'操作失敗，請稍後重試。');
async function run(action){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='處理中…';try{await action();}catch(error){status.textContent=message(error);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
$('loginForm').onsubmit=event=>{event.preventDefault();run(async()=>{try{const response=await runtime.login($('email').value.trim(),$('password').value);if(response.mfaRequired){$('loginForm').hidden=true;$('mfaForm').hidden=false;$('cancelLogin').hidden=false;status.textContent='請輸入驗證器代碼';$('mfaCode').focus();}}finally{$('password').value='';}});};
$('mfaForm').onsubmit=event=>{event.preventDefault();run(()=>runtime.finishMfa($('mfaCode').value));};
$('cancelLogin').onclick=()=>run(async()=>{await runtime.logout();location.reload();});
$('beginEnrollment').onclick=()=>run(async()=>{const setup=await runtime.beginEnrollment();$('enrollmentSecret').textContent=setup.secret;$('enrollForm').hidden=false;status.textContent='將金鑰加入驗證器後，輸入產生的代碼。';});
$('enrollForm').onsubmit=event=>{event.preventDefault();run(async()=>{await runtime.finishEnrollment($('enrollCode').value);$('enrollmentSecret').textContent='';$('enrollCode').value='';status.textContent='MFA 已設定，請重新登入並完成雙重驗證。';});};
runtime.observe(async user=>{
    if(!user){$('loginForm').hidden=false;$('mfaForm').hidden=true;$('enrollment').hidden=true;$('enrollmentSecret').textContent='';return;}
    try{
        const identity=await runtime.identity(user);
        if(!identity.admin){await runtime.logout();status.textContent='此帳號不是遊戲管理員，無法進入管理功能。';return;}
        if(identity.mfa){location.replace('index.html'+location.search);return;}
        $('loginForm').hidden=true;$('enrollment').hidden=false;$('cancelLogin').hidden=false;
        $('beginEnrollment').hidden=identity.enrolled;
        status.textContent=identity.enrolled?'請登出後重新登入，完成 MFA 驗證。':'首次登入需完成 MFA 設定。若電子郵件未驗證，請先由專案擁有者協助完成驗證。';
    }catch(error){status.textContent=message(error);}
});
