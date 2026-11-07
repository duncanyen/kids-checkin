/* Synchronous, network-free first paint. Preferences are isolated by accountId. */
(() => {
    'use strict';
    // Keep the supplied swatch exact; derive readable UI surfaces and action colors.
    function mix(color, target, amount) {
        const from = color.slice(1).match(/../g).map(value => parseInt(value, 16));
        const to = target.slice(1).match(/../g).map(value => parseInt(value, 16));
        return '#' + from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, '0')).join('');
    }
    function luminance(color) {
        const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
            .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    }
    function swatchTheme([id, name, description, color]) {
        let primary = color;
        const tint = mix(color, '#ffffff', .85);
        // Primary is also text on tinted controls; keep that pairing readable.
        while ((luminance(tint) + .05) / (luminance(primary) + .05) < 4.5) {
            primary = mix(primary, '#000000', .05);
        }
        return [id, name, description, false, mix(color, '#ffffff', .96), '#ffffff',
            mix(color, '#ffffff', .88), '#25282c', '#575c63', primary,
            mix(primary, '#000000', .18), tint, mix(color, '#ffffff', .78), color];
    }
    const themes = [
        ['honey','蜂蜜','溫暖日常，柔和的蜂蜜金',false,'#faf8f1','#ffffff','#f1eee4','#292c30','#62676e','#956018','#785015','#f9ecd1','#e6e2d8','#eba73d'],
        ['walnut','胡桃','沉靜耐看的胡桃暖棕',false,'#f6f1ea','#ffffff','#efe4d5','#302921','#6d6258','#89603b','#704a2a','#f1e5d6','#e3d9cc','#b68b62'],
        ['terracotta','茜紅','溫柔而有精神的陶土紅',false,'#fcf5f1','#ffffff','#f7e7df','#332924','#786159','#ab4b31','#8e3c27','#fae6de','#ecdcd5','#d26c4b'],
        ['aqua','淺青','清透舒心的湖水藍',false,'#f1f7f8','#ffffff','#e1eff2','#203038','#5d7078','#26768b','#1c6072','#e0f0f4','#d7e5e9','#4b9db1'],
        ['wisteria','紫藤','輕盈安定的淡紫色',false,'#f6f3fa','#ffffff','#ece6f5','#302b3a','#706579','#7458a5','#5f468b','#eee5fa','#e3dcee','#9a80c2'],
        ['citrus','香橙','像晨光一樣明亮的金黃',false,'#f9f7ec','#ffffff','#f1edda','#302f24','#6f6b56','#806b12','#68560c','#f7edc7','#e6e0ca','#c5ab35'],
        ['sea','靜海','平靜清爽的青綠色',false,'#f0f7f5','#ffffff','#e1efeb','#21322e','#5c716b','#247969','#1d6255','#def2eb','#d4e6df','#4a9e8d'],
        ['lapis','琉璃藍','深夜裡清晰柔和的藍',true,'#121722','#1c2332','#28334b','#eef1f8','#acb7ce','#9fb7ff','#bed0ff','#283854','#364259','#8da9fa'],
        ['grape','葡萄','深紫夜色，低調而溫柔',true,'#181421','#241e32','#342943','#f4effa','#c0b2d0','#cfabff','#e3cdff','#3e2e53','#493b5a','#bc92ed'],
        ['evergreen','常青','森林夜色與清新的綠',true,'#111d18','#1b2b23','#263d31','#eef6f0','#afc5b7','#8ad4ab','#b1e7c8','#254735','#385244','#75bd94'],
        ...[
            ['persimmon', '柿橙色', '溫潤醇厚的柿子橙', '#B85516'],
            ['honey-gold', '密金色', '飽滿明亮的蜂蜜金', '#EAAE35'],
            ['light-pine', '淺松色', '輕快燦爛的暖黃色', '#FFC44F'],
            ['mugwort', '艾草青', '清新自然的艾草綠', '#5ECD8C'],
            ['peach-rose', '桃緋粉', '活潑鮮明的桃紅粉', '#F35B83'],
            ['mint-green', '薄荷青', '清涼透亮的薄荷綠', '#8AEED1'],
            ['periwinkle', '長春花藍', '柔和雅緻的長春花藍', '#7B8AD7'],
            ['cocoa', '可可棕', '沉穩溫暖的可可棕', '#6D483B'],
            ['nude-peach', '裸桃粉', '輕柔親切的淡桃粉', '#FACBC6'],
            ['moss-green', '苔青色', '安定質樸的苔蘚綠', '#465C47'],
            ['mist-violet', '霧堇紫', '清雅鮮明的堇花紫', '#615EDE'],
            ['cherry-pink', '櫻粉色', '明亮甜美的櫻花粉', '#FF7EC1'],
            ['berry-red', '漿果紅', '深邃濃郁的漿果紅', '#65020A'],
            ['lake-blue', '湖藍色', '清澈有活力的湖水藍', '#18D5E7'],
            ['rouge-pink', '胭脂粉', '柔美鮮亮的胭脂粉', '#FF7CA2'],
            ['ink-black', '墨黑色', '簡潔俐落的黑白配色', '#000000']
        ].map(swatchTheme)
    ].map(([id,name,description,dark,bg,surface,soft,text,muted,primary,strong,tint,border,accent]) =>
        Object.freeze({id,name,description,dark,bg,surface,soft,text,muted,primary,strong,tint,border,accent,onPrimary:dark?'#15201e':'#ffffff'}));
    const catalog=Object.freeze(themes), root=document.documentElement;
    let current='honey', owner=null;
    const user=()=>{try{return JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');}catch{return null;}};
    const key=id=>`nexus.appearance.v1:${id}`;
    const valid=id=>themes.some(theme=>theme.id===id);
    function cached(accountId) {
        // Session backup preserves the saved theme during same-tab navigation,
        // including browsers that block persistent storage.
        for (const name of ['localStorage', 'sessionStorage']) {
            try {
                const storage = globalThis[name];
                const value = JSON.parse(storage.getItem(key(accountId)) || 'null');
                if (valid(value?.theme)) return value.theme;
            } catch {}
        }
        return null;
    }
    function apply(id){
        const t=themes.find(theme=>theme.id===id)||themes[0];current=t.id;
        root.dataset.nexusTheme=t.id;root.dataset.colorMode=t.dark?'dark':'light';root.style.colorScheme=t.dark?'dark':'light';
        // Paint the correct canvas even before the page stylesheets arrive.
        root.style.backgroundColor=t.bg;root.style.color=t.text;
        const tokens={
            '--n-bg':t.bg,'--n-surface':t.surface,'--n-soft':t.soft,'--n-text':t.text,'--n-muted':t.muted,'--n-primary':t.primary,'--n-strong':t.strong,'--n-tint':t.tint,'--n-border':t.border,'--n-accent':t.accent,'--n-on-primary':t.onPrimary,
            '--primary':t.primary,'--primary-color':t.primary,'--primary-dark':t.strong,'--primary-hover':t.strong,'--primary-light':t.tint,'--accent':t.accent,'--accent-color':t.primary,
            '--bg-body':t.bg,'--bg-color':t.bg,'--bg':t.bg,'--bg-card':t.surface,'--card-bg':t.surface,'--surface':t.surface,'--text-main':t.text,'--text-sub':t.muted,'--ink':t.text,'--muted':t.muted,'--border-color':t.border,'--line':t.border,'--green':t.primary,'--green2':t.strong,'--mint':t.tint,
            '--shadow-soft':t.dark?'0 4px 16px #00000020':'0 4px 16px #30251405','--shadow-sm':'0 2px 8px #00000006'
        };
        for(const [name,value]of Object.entries(tokens))root.style.setProperty(name,value);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t.bg);
        window.dispatchEvent(new CustomEvent('nexus-theme-change',{detail:{id:t.id,theme:t}}));return t;
    }
    function refresh(){window.NexusFontSize?.refresh();const next=user()?.accountId||null;owner=next;return apply(next?cached(next)||'honey':'honey');}
    function remember(accountId,id) {
        if (!accountId || !valid(id)) return false;
        const value = JSON.stringify({theme:id});
        try { sessionStorage.setItem(key(accountId),value); } catch {}
        try { localStorage.setItem(key(accountId),value); return true; } catch { return false; }
    }
    function hydrate(accountId,appearance,metadata){
        if(user()?.accountId!==accountId)return;owner=accountId;
        // Firestore may emit an older disk snapshot before the server response.
        if(metadata?.fromCache && cached(accountId))return;
        if(valid(appearance?.theme)){remember(accountId,appearance.theme);apply(appearance.theme);}
        else apply(cached(accountId)||'honey');
    }
    window.NexusTheme=Object.freeze({themes:catalog,valid,apply,refresh,remember,hydrate,user,get current(){return current;},get accountId(){return owner;}});
    window.addEventListener('storage',event=>{if(event.key===key(owner)||event.key==='familyCheckInUser'||event.key===null)refresh();});
    window.addEventListener('pageshow',refresh);
    refresh();
})();

/* Font scale shares account identity with themes, but uses an independent cache. */
(() => {
    const values = [80,90,100,110,120], root = document.documentElement;
    let current = 100;
    const user = () => window.NexusTheme.user();
    const valid = n => values.includes(n);
    const key = id => `nexus.font-size.v1:${id}`;
    function cached(id) { try { const n = JSON.parse(localStorage.getItem(key(id))); return valid(n) ? n : 100; } catch { return 100; } }
    function apply(n) { current = valid(n) ? n : 100; root.style.setProperty('--n-font-scale', String(current/100)); root.dataset.nexusFontScale = String(current); }
    function refresh() { const id = user()?.accountId; apply(id ? cached(id) : 100); }
    function remember(id,n) { if (!id || !valid(n)) return false; try { localStorage.setItem(key(id),JSON.stringify(n));return true; } catch { return false; } }
    function hydrate(id,appearance) { if (user()?.accountId !== id) return; const n = valid(appearance?.fontScale) ? appearance.fontScale : cached(id); remember(id,n); apply(n); }
    window.NexusFontSize = Object.freeze({values,valid,user,apply,refresh,remember,hydrate,get current(){return current;}});
    window.addEventListener('pageshow',refresh);
    window.addEventListener('storage',e=>{if(e.key === null || e.key === key(user()?.accountId) || e.key === 'familyCheckInUser')refresh();});
    refresh();
})();
