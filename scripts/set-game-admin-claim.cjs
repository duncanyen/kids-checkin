// Run only by the project owner with ADC in a trusted environment. No credentials
// or passwords are accepted or printed by this script.
const path=require('node:path'),{createRequire}=require('node:module');
const requireBackend=createRequire(path.resolve(__dirname,'../game-admin/functions/package.json'));
const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
const projectId=value('--project'),uid=value('--uid');
if(!projectId||!uid||!args.includes('--grant-admin')){console.error('Usage: node scripts/set-game-admin-claim.cjs --project PROJECT --uid EXISTING_AUTH_UID --grant-admin');process.exit(2);}
if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&!projectId.startsWith('demo-')){console.error('Emulator must use a demo project');process.exit(2);}
const {initializeApp}=requireBackend('firebase-admin/app'),{getAuth}=requireBackend('firebase-admin/auth');
const auth=getAuth(initializeApp({projectId}));
(async()=>{const user=await auth.getUser(uid);if(user.disabled)throw Error('Cannot grant a disabled user');await auth.setCustomUserClaims(uid,{...user.customClaims,role:'admin'});console.log(`Admin role granted to UID ${uid} in ${projectId}. Sign in again to use the dashboard. MFA enrollment is optional.`);})().catch(error=>{console.error('Admin setup failed:',error.code||error.message);process.exitCode=1;});
