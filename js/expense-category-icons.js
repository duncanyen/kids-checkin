import { icon } from './ui-icons.js';
export const CATEGORY_ICON_OPTIONS=Object.freeze([
 ['sandwich','三明治'],['lunchbox','餐盒'],['soup','餐碗'],['cart','購物車'],['bus','交通'],['bolt','水電'],['book','書本'],['package','紙箱'],['briefcase','公事包'],['gift','禮物'],['chart','投資'],['laptop','筆電'],['coins','金幣'],['inbox','收入'],['heart','愛心'],['home','房屋'],['sparkles','星光']
].map(([key,label])=>Object.freeze({key,label})));
const supported=new Set(CATEGORY_ICON_OPTIONS.map(option=>option.key));
const legacy=new Map([['🥪','sandwich'],['🍱','lunchbox'],['🍲','soup'],['🛒','cart'],['⛽','bus'],['🚗','bus'],['⚡','bolt'],['📚','book'],['📦','package'],['💼','briefcase'],['🎊','gift'],['🎁','gift'],['📈','chart'],['🧑‍💻','laptop'],['💻','laptop'],['💰','coins'],['📥','inbox'],['❤️','heart'],['✨','sparkles']].map(([emoji,key])=>[emoji.replace(/\uFE0F/g,''),key]));
export function categoryIconKey(value){return supported.has(value)?value:legacy.get(typeof value==='string'?value.replace(/\uFE0F/g,''):'')||'package';}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function categoryIconHTML(category){
 const image=category?.imgBase64;
 if(typeof image==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image))return `<img class="category-custom-image" src="${escape(image)}" alt="">`;
 return icon(categoryIconKey(category?.icon));
}
