// Only explicit activity-code fields or labelled codes become redeem actions.
export function activityCodes(record){
    const candidates=[record.activityCode||''];
    const body=String(record.content||record.body||'').normalize('NFKC');
    for(const match of body.matchAll(/(?:活動碼|兌換碼|禮包碼|序號)\s*[:：]\s*[`「『"']?([A-Za-z0-9][A-Za-z0-9-]{7,127})(?![A-Za-z0-9-])/g))candidates.push(match[1]);
    return [...new Set(candidates.map(value=>String(value).normalize('NFKC').toUpperCase().replace(/[\s-]/g,'')).filter(value=>/^[A-Z0-9]{8,64}$/.test(value)))].slice(0,5);
}

export function activityCodeCard(code,onRedeem){
    const card=document.createElement('section');card.className='farm-activity-code';
    const label=document.createElement('label');label.textContent='活動碼';
    const input=document.createElement('input');input.value=code;input.readOnly=true;input.setAttribute('aria-label','活動碼');
    input.addEventListener('click',()=>{input.select();input.setSelectionRange(0,input.value.length);});
    label.append(input);
    const actions=document.createElement('div');actions.className='farm-activity-actions';
    const feedback=document.createElement('p');feedback.setAttribute('role','status');
    const copy=document.createElement('button');copy.type='button';copy.className='farm-mail-button';copy.textContent='複製活動碼';
    copy.onclick=async()=>{
        try{await navigator.clipboard.writeText(code);feedback.textContent='活動碼已複製';}
        catch{
            input.focus();input.select();input.setSelectionRange(0,input.value.length);
            let copied=false;try{copied=document.execCommand('copy');}catch{}
            feedback.textContent=copied?'活動碼已複製':'已選取活動碼，請長按或使用複製功能';
        }
    };
    const redeem=document.createElement('button');redeem.type='button';redeem.className='farm-mail-button';redeem.textContent='前往兌換';redeem.onclick=()=>onRedeem(code);
    actions.append(copy,redeem);card.append(label,actions,feedback);return card;
}
