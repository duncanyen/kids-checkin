// 從 Functions 的套件範圍載入 Admin SDK，保留 firebase-admin 的 exports 子路徑解析。
const path=require('node:path'),{createRequire}=require('node:module');
module.exports=createRequire(path.resolve(__dirname,'../functions/package.json'));
