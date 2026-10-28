const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/theme-bootstrap.js','utf8');
function setup(){
 const local=new Map(),session=new Map(),listeners={},vars={};
 const storage=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)});
 const root={dataset:{},style:{setProperty:(key,value)=>vars[key]=value}};
 const context={document:{documentElement:root,querySelector:()=>null},localStorage:storage(local),sessionStorage:storage(session),CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},window:{dispatchEvent(){},addEventListener:(key,cb)=>listeners[key]=cb}};
 vm.runInNewContext(source,context);return {api:context.window.NexusTheme,context,local,session,root,vars,listeners};
}
const lum=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('all ten palettes have readable primary, secondary and action text',()=>{
 const {api}=setup();assert.equal(api.themes.length,10);
 for(const t of api.themes)for(const [fg,bg]of [[t.text,t.bg],[t.text,t.surface],[t.muted,t.bg],[t.muted,t.surface],[t.onPrimary,t.primary]])assert.ok(ratio(fg,bg)>=4.5,`${t.id} ${fg}/${bg} ratio ${ratio(fg,bg)}`);
});
test('preview is not persisted, account changes and server hydration are isolated',()=>{
 const {api,session,root,local}=setup();session.set('familyCheckInUser',JSON.stringify({accountId:'alice'}));
 api.refresh();api.apply('grape');assert.equal(root.dataset.colorMode,'dark');assert.equal(local.size,0);
 api.refresh();assert.equal(api.current,'honey');api.hydrate('alice',{theme:'lapis'});assert.equal(api.current,'lapis');
 session.set('familyCheckInUser',JSON.stringify({accountId:'bob'}));api.refresh();assert.equal(api.current,'honey');
 api.hydrate('alice',{theme:'grape'});assert.equal(api.current,'honey');api.hydrate('bob',{theme:'evergreen'});assert.equal(api.current,'evergreen');
 session.set('familyCheckInUser',JSON.stringify({accountId:'alice'}));api.refresh();assert.equal(api.current,'lapis');
 api.apply('<script>');assert.equal(api.current,'honey');assert.equal(api.remember('alice','bad'),false);
});
test('corrupt or unavailable local storage never prevents rendering',()=>{
 const {api,context,local,session}=setup();session.set('familyCheckInUser',JSON.stringify({accountId:'alice'}));local.set('nexus.appearance.v1:alice','{invalid');api.refresh();assert.equal(api.current,'honey');
 context.localStorage.getItem=()=>{throw Error('blocked');};context.localStorage.setItem=()=>{throw Error('blocked');};api.refresh();assert.equal(api.current,'honey');api.hydrate('alice',{theme:'grape'});assert.equal(api.current,'grape');assert.equal(api.remember('alice','sea'),false);
});
