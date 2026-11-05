// Original SVG game sprites: identical canvas, ground anchor and footprint to
// existing Growth Forest flowers. All animation stays in the shared scene.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'assets/growth-forest');
const stem=(d,color='#46754e',width=6)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
const leaf=(x,y,angle=0,scale=1,color='#679c60',outline='#3c7150')=>`<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"><path d="M0 0Q18 -29 37 -24Q38 -4 0 0Z" fill="${color}" stroke="${outline}" stroke-width="2"/><path d="M3 -2 29 -19" fill="none" stroke="${outline}" stroke-width="1.4" opacity=".55"/></g>`;
const bulb=()=>'<path d="M94 173Q95 181 86 187Q79 195 86 200Q99 207 113 200Q120 194 109 186Q103 180 104 173Z" fill="#ecd7a4" stroke="#ac9165" stroke-width="2.3"/><path d="M98 177Q89 196 98 201M103 177Q111 194 104 201" fill="none" stroke="#c8b17b" stroke-width="1.5"/>';
const narrow=(d,color='#7e9b7f',outline='#526f5c')=>`<path d="${d}" fill="${color}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`;
function rose(stage){
 if(stage===1)return '<path d="M94 196Q85 188 95 182Q104 177 109 182Q110 194 100 198Z" fill="#966647" stroke="#674734" stroke-width="2"/><path d="m96 185 5 6" stroke="#c89e72" stroke-width="1.7" stroke-linecap="round"/>';
 if(stage===2)return stem('M100 198Q96 184 100 172')+leaf(100,181,-10,.65)+leaf(99,178,-135,.6);
 const y=stage===3?133:stage===4?111:78;
 let s=stem(`M100 198Q109 159 100 ${y}`);
 s+=stem('M102 169 129 152M101 150 77 137','#46754e',3);
 s+=leaf(127,154,-9,.68)+leaf(122,158,-67,.6)+leaf(78,139,-151,.74)+leaf(85,144,-85,.58)+leaf(101,185,-157,.87);
 s+='<path d="m104 172 7 -4 -6 10M99 147l-6 -2 6 8" fill="#527c4e"/>';
 if(stage===3){s+=leaf(100,136,-35,.7);return s;}
 s+=`<path d="M100 ${y+16}Q81 ${y+6} 77 ${y-6}L98 ${y+2}L118 ${y-8}Q119 ${y+10} 100 ${y+16}" fill="#679c60" stroke="#3c7150" stroke-width="2"/>`;
 if(stage===4)return s+'<path d="M100 120Q73 108 83 82L97 91L106 76Q127 99 113 113Z" fill="#cc7188" stroke="#a85e76" stroke-width="2.7"/><path d="M101 116Q92 101 97 91M102 115Q118 102 106 82" fill="none" stroke="#ed9eac" stroke-width="2.5" stroke-linecap="round"/>';
 s+='<g transform="translate(100 66)"><path d="M-35 6Q-51 -10 -33 -25Q-33 -42 -12 -39Q2 -54 18 -36Q40 -39 40 -17Q55 -1 35 16Q34 37 10 34Q-9 48 -25 29Q-47 28 -35 6Z" fill="#d67d8f" stroke="#a85e76" stroke-width="2.7"/><path d="M-32 -18Q-4 -36 11 -16Q34 -28 36 -8Q37 13 11 20Q-7 41 -26 19Q-45 3 -20 -9" fill="#df8b9a" stroke="#b2647a" stroke-width="2.3"/><path d="M-20 -12Q-16 -29 5 -23Q25 -21 23 -5Q24 11 5 18Q-12 19 -23 6Q-31 -5 -20 -12Z" fill="#cc7188" stroke="#a85e76" stroke-width="2.2"/><path d="M-13 5Q-22 -10 -8 -16Q8 -22 16 -8Q20 3 5 9Q-8 12 -10 1Q-12 -8 -2 -8Q8 -9 7 -1" fill="#e7a0ac" stroke="#b2647a" stroke-width="2.2" stroke-linecap="round"/><path d="M-30 -23Q-21 -29 -13 -27M19 23Q27 21 29 15" fill="none" stroke="#f1b4bd" stroke-width="2.5" stroke-linecap="round"/></g>';
 return s;
}
function daffodil(stage){
 if(stage===1)return bulb();
 if(stage===2)return narrow('M99 189Q88 170 98 155Q107 166 103 189Z','#85a768','#4d7d50')+narrow('M101 191Q109 167 119 165Q119 182 105 194Z','#96b575','#4d7d50')+bulb();
 let s=narrow(`M96 198Q75 165 ${stage===3?'76 140Q91 151':'62 115Q89 138'} 102 198Z`,'#86a967','#4d7d50');
 s+=narrow(`M100 198Q112 153 ${stage===3?'126 135Q129 163':'143 106Q142 145'} 106 198Z`,'#9ab777','#4d7d50');
 s+=narrow(`M99 198Q89 153 103 ${stage===3?122:102}Q115 143 105 198Z`,'#739c63','#4d7d50');
 if(stage===3)return s;
 const y=stage===4?111:78;s+=stem(`M102 198Q111 146 108 ${y}`,'#638c58',5);
 if(stage===4)return s+'<path d="M108 126Q92 115 98 101Q99 94 109 83Q126 94 124 106Q123 119 108 126Z" fill="#f3e6b6" stroke="#c1ad76" stroke-width="2.5"/><path d="M108 120Q114 103 109 87" fill="none" stroke="#dfc989" stroke-width="2"/><path d="M107 129 99 115 111 120 125 112 117 128" fill="#85a768" stroke="#4d7d50" stroke-width="2"/>';
 s+='<path d="M105 88Q131 96 139 88Q135 78 120 80" fill="#d4c59a" stroke="#b0a17a" stroke-width="1.7"/>';
 s+='<g transform="translate(106 76) rotate(-8)">';
 for(let i=0;i<6;i++)s+=`<path d="M0 5Q-22 -12 0 -43Q21 -14 0 5Z" transform="rotate(${i*60})" fill="${i%2?'#f5ebcc':'#fff4d9'}" stroke="#c8b77d" stroke-width="2"/>`;
 s+='<path d="M-18 -9Q-18 -18 -10 -17Q-5 -25 1 -18Q10 -23 13 -15Q23 -14 18 -6Q25 2 17 7Q18 17 8 16Q1 23 -6 16Q-17 20 -18 10Q-27 6 -19 -1Z" fill="#ecc76b" stroke="#c49645" stroke-width="2.2"/><ellipse cy="-1" rx="10" ry="11" fill="#dca44f" stroke="#c49645" stroke-width="1.8"/><ellipse cy="1" rx="5" ry="6" fill="#b78643"/><path d="M-8 -12Q-1 -17 6 -13" fill="none" stroke="#ffe4a0" stroke-width="2.5" stroke-linecap="round"/></g>';
 return s;
}
const lavenderLeaves=stage=>{
 let s='';const tips=stage===3?[[67,155],[83,131],[108,126],[133,144],[142,169]]:[[61,153],[76,127],[92,114],[121,126],[142,146],[148,174]];
 for(const [x,y]of tips)s+=narrow(`M100 198Q${x-9} ${y+15} ${x} ${y}Q${x+11} ${y+6} 104 198Z`,'#8ca78a','#5c7c68');
 return s;
};
function spike(x,y,angle=0,bloom=true){
 let s=`<g transform="translate(${x} ${y}) rotate(${angle})">`+stem('M0 32V-12','#6d8e72',2.5);
 for(let j=0;j<4;j++){const yy=23-j*11,rx=7-j*.7;s+=`<ellipse cx="-4" cy="${yy}" rx="${rx}" ry="5.5" transform="rotate(20 -4 ${yy})" fill="${bloom?(j%2?'#b09bc8':'#a187bc'):'#a7b39c'}" stroke="${bloom?'#7e689a':'#708b76'}" stroke-width="1.7"/><ellipse cx="4" cy="${yy-2}" rx="${rx}" ry="5.5" transform="rotate(-20 4 ${yy-2})" fill="${bloom?'#c0acd5':'#aebca2'}" stroke="${bloom?'#7e689a':'#708b76'}" stroke-width="1.7"/>`;}
 return s+`<ellipse cy="-16" rx="4.5" ry="7" fill="${bloom?'#b49acb':'#ae9cbb'}" stroke="#7e689a" stroke-width="1.7"/></g>`;
}
function lavender(stage){
 if(stage===1)return '<g fill="#997957" stroke="#6c5640" stroke-width="1.7"><ellipse cx="91" cy="193" rx="5" ry="3.5" transform="rotate(24 91 193)"/><ellipse cx="102" cy="186" rx="3.5" ry="5" transform="rotate(25 102 186)"/><ellipse cx="110" cy="195" rx="5" ry="3.5" transform="rotate(-25 110 195)"/></g>';
 if(stage===2)return stem('M100 198Q97 185 100 177','#6d8e72',5)+leaf(100,183,-6,.6,'#9ab09a','#5c7c68')+leaf(99,180,-145,.55,'#9ab09a','#5c7c68');
 if(stage===3)return lavenderLeaves(stage);
 let s='';const flowers=stage===4?[[79,118,-13],[101,96,0],[125,113,13]]:[[61,104,-19],[78,75,-11],[100,55,0],[124,76,12],[140,109,20]];
 for(const [x,y,angle]of flowers)s+=stem(`M101 198Q${x} 153 ${x} ${y+27}`,'#6d8e72',3.5);
 s+=lavenderLeaves(stage);
 flowers.forEach(([x,y,angle],i)=>s+=spike(x,y,angle,stage===5||i===1));return s;
}
const species={rose:{name:'玫瑰花',draw:rose},daffodil:{name:'水仙花',draw:daffodil},lavender:{name:'薰衣草',draw:lavender}};
const shadow='<ellipse cx="100" cy="203" rx="31" ry="6" fill="#35563d" opacity=".13"/>';
fs.mkdirSync(target,{recursive:true});
for(const [type,{draw}]of Object.entries(species))for(let level=1;level<=5;level++){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240" viewBox="0 0 200 240" stroke-linejoin="round">${shadow}${draw(level)}</svg>`;
 fs.writeFileSync(path.join(target,`${type}-${level}.svg`),svg);
}
// Review sheet uses the actual exported sprites, rather than concept artwork.
let preview='<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="860" viewBox="0 0 1120 860" stroke-linejoin="round"><rect width="1120" height="860" fill="#f8f5e9"/><g fill="#496d55" font-family="sans-serif" font-size="20">';
for(let level=1;level<=5;level++)preview+=`<text x="${220+(level-1)*200}" y="32" text-anchor="middle">Lv.${level}</text>`;
const catalog=require('../functions/growth-domain.cjs').PLANTS;
let row=0;for(const [type,{name}]of Object.entries(species)){
 preview+=`<text x="18" y="${170+row*270}">${name}</text><text x="18" y="${196+row*270}" font-size="14" fill="#758072">${catalog[type].price} 金幣</text>`;
 for(let level=1;level<=5;level++)preview+=`<g transform="translate(${120+(level-1)*200} ${55+row*270})">${shadow}${species[type].draw(level)}</g>`;
 row++;
}
preview+='</g></svg>';fs.writeFileSync(path.join(root,'docs/growth-forest-new-flowers.svg'),preview);
