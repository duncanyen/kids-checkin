// Independent test-only guard: never load this from the game.
const {chromium}=require('playwright');
const guarded=new WeakSet();
async function guard(context){
 if(guarded.has(context))return;guarded.add(context);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)||['data:','blob:','about:'].includes(url.protocol))return route.continue();
  // Page-specific fixtures take precedence over this context fallback.
  return route.abort('blockedbyclient');
 });
}
const launch=chromium.launch.bind(chromium);
chromium.launch=async(...args)=>{
 const browser=await launch(...args),newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
 browser.newContext=async(...args)=>{const context=await newContext(...args);await guard(context);return context;};
 browser.newPage=async(...args)=>{const page=await newPage(...args);await guard(page.context());return page;};
 return browser;
};
const persistent=chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext=async(...args)=>{const context=await persistent(...args);await guard(context);return context;};
