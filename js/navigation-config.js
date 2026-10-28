export const MAX_NAV_FEATURES = 6;
export const NAV_FEATURES = Object.freeze([
    {id:'chat',label:'聊天室',url:'chat.html'},
    {id:'calendar',label:'行事曆',url:'calendar.html'},
    {id:'finance',label:'記帳本',url:'expense.html'},
    {id:'todo',label:'待辦',url:'todo.html'},
    {id:'photodump',label:'Photo Dump',url:'gallery.html'},
    {id:'gamezone',label:'遊戲區',url:'games.html'},
    {id:'checkin',label:'到家打卡',url:'checkin.html'},
    {id:'wishlist',label:'許願牆',url:'wishwall.html'},
    {id:'food',label:'吃什麼',url:'food-decision.html'}
]);
const known=new Set(NAV_FEATURES.map(item=>item.id));
export const allowedNavigation=user=>NAV_FEATURES.filter(item=>(Array.isArray(user?.menus)?user.menus:['chat','calendar','finance','todo','photodump','gamezone','food']).includes(item.id));
export function cleanNavigation(items){return Array.isArray(items)?[...new Set(items.filter(id=>typeof id==='string'&&known.has(id)))].slice(0,MAX_NAV_FEATURES):null;}
export function resolveNavigation(user,settings={}){
    const allowed=allowedNavigation(user).map(item=>item.id);
    const chosen=cleanNavigation(settings.navigation?.items);
    const order=Array.isArray(settings.order)?settings.order:[];
    const defaults=[...new Set([...order,...allowed])].filter(id=>allowed.includes(id)).slice(0,MAX_NAV_FEATURES);
    return (chosen??defaults).filter(id=>allowed.includes(id));
}
const key=id=>`nexus.navigation.v1:${id}`;
export function cacheNavigation(accountId,items){if(!accountId)return false;try{localStorage.setItem(key(accountId),JSON.stringify({items:cleanNavigation(items)||[]}));return true;}catch{return false;}}
export function cachedNavigation(accountId){if(!accountId)return null;try{return cleanNavigation(JSON.parse(localStorage.getItem(key(accountId))||'null')?.items);}catch{return null;}}
