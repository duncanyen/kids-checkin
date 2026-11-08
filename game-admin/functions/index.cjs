const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createService}=require('./service.cjs');
const {createCallables}=require('./callables.cjs');
initializeApp();
const service=createService({db:getFirestore(),auth:getAuth()});
module.exports=createCallables(service);
