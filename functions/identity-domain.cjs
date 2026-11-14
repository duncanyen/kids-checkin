/** 私有身分共用純函式；不將明文憑證、雜湊或鹽值回傳瀏覽器。 */
const crypto=require('node:crypto'),{promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
class IdentityError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new IdentityError(code,message);};
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const normalize=value=>String(value??'').trim().toLowerCase();
const profileUid=docId=>'nexus_'+hash('profile:'+docId).slice(0,60);
const text=(value,max=160,required=true)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('invalid-argument','欄位格式不正確');return value.trim();};
const publicLabel=(value,max=100)=>{const result=text(value,max);if(/[<>]/.test(result))fail('invalid-argument','名稱不可包含 < 或 >');return result;};
const id=value=>{const result=text(value);if(result.includes('/'))fail('invalid-argument','識別碼格式不正確');return result;};
const safeProfile=(uid,data)=>({docId:uid,accountId:data.accountId,name:data.name||data.accountId,email:data.email||null,avatar:data.avatar||'',role:data.role||'member',menus:Array.isArray(data.menus)?data.menus:null});
async function hashSecret(secret){
 if(typeof secret!=='string'||secret.length<4||secret.length>1000)fail('invalid-argument','密碼長度須為 4～1000 字元');
 const salt=crypto.randomBytes(16).toString('hex'),derived=await scrypt(secret,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return{algorithm:'scrypt-v1',salt,hash:derived.toString('hex')};
}
async function matches(secret,stored){
 if(typeof secret!=='string'||secret.length>1000||stored?.algorithm!=='scrypt-v1'||!/^[0-9a-f]{32}$/.test(stored.salt||'')||!/^[0-9a-f]{128}$/.test(stored.hash||''))return false;
 const derived=await scrypt(secret,stored.salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return crypto.timingSafeEqual(derived,Buffer.from(stored.hash,'hex'));
}
async function verify(secret,credentials){
 // 依序核對最多兩組既有 password/PIN；不接受遠端自訂 scrypt 成本。
 if(!Array.isArray(credentials?.secrets)||credentials.secrets.length>2)return false;
 let valid=false;for(const stored of credentials.secrets)valid=(await matches(secret,stored))||valid;return valid;
}
module.exports={IdentityError,fail,hash,normalize,profileUid,text,publicLabel,id,safeProfile,hashSecret,matches,verify};
