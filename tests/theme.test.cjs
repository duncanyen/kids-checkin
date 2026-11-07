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
test('all 26 palettes have readable primary, secondary and action text',()=>{
 const {api}=setup();assert.equal(api.themes.length,26);
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

test('reference swatches use exact HEX values and Traditional Chinese labels',()=>{
 const {api}=setup();
 const expected=[['柿橙色','#B85516'],['密金色','#EAAE35'],['淺松色','#FFC44F'],['艾草青','#5ECD8C'],['桃緋粉','#F35B83'],['薄荷青','#8AEED1'],['長春花藍','#7B8AD7'],['可可棕','#6D483B'],['裸桃粉','#FACBC6'],['苔青色','#465C47'],['霧堇紫','#615EDE'],['櫻粉色','#FF7EC1'],['漿果紅','#65020A'],['湖藍色','#18D5E7'],['胭脂粉','#FF7CA2'],['墨黑色','#000000']];
 for(const [name,color]of expected){
  const t=api.themes.find(t=>t.name===name);assert.ok(t,name);assert.equal(t.accent,color);
  api.apply(t.id);assert.equal(api.current,t.id);
  for(const bg of [t.bg,t.surface,t.soft,t.tint])assert.ok(ratio(t.primary,bg)>=4.5,`${name}: primary text on ${bg}`);
  assert.ok(ratio(t.onPrimary,t.strong)>=4.5,`${name}: hovered action`);
 }
});
