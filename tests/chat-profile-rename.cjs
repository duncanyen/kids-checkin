const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const startServer=require('./helpers/navigation-performance-server.cjs');
(async()=>{
 const server=await startServer(),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();
  await context.addInitScript(()=>{
   const user={accountId:'alice',name:'Alice',nameHistory:['Original Alice'],pin:'1234',role:'member',groupId:'A',menus:['chat']};
   sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('lastGroupId','A');
   window.__perfStore={'users/a':user,'groups/A':{members:['alice']},'userSettings/alice':{accountId:'alice',modules:{},order:[]}};window.__perfOperations=[];
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('https://**',route=>route.abort());await page.goto(server.base+'/settings.html');
  await page.waitForFunction(()=>typeof window.saveUserProfile==='function');
  for(const name of ['New Alice','Third Alice']){
   await page.fill('#settingsName',name);await page.fill('#oldPin','1234');await page.evaluate(()=>saveUserProfile());
   const profile=await page.evaluate(()=>window.__perfStore['users/a']);
   assert.equal(profile.accountId,'alice');assert.equal(profile.name,name);
  }
  assert.deepEqual(await page.evaluate(()=>window.__perfStore['users/a'].nameHistory),['Original Alice','Alice','New Alice']);
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).accountId),'alice');
  assert.deepEqual(errors,[]);console.log('PASS: profile settings preserve account ID and accumulate historical names across repeated renames.');
 }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
