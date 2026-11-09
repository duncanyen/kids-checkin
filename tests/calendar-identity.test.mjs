import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {calendarPerson} from '../js/calendar-identity-core.js';
import {photoAvatar} from '../js/gallery-profile-core.js';

const profiles=[
    {docId:'document-a',accountId:'alice',name:'新名字',nameHistory:['原名','更早名字'],avatar:'alice.jpg'},
    {docId:'document-b',accountId:'bob',name:'原名',photoURL:'bob.jpg'}
];
test('stable calendar account selects the current profile despite renamed or conflicting stored labels',()=>{
    assert.equal(photoAvatar(calendarPerson({accountId:'alice',operator:'原名'},profiles)),'alice.jpg');
    assert.equal(photoAvatar(calendarPerson({accountId:'bob',operator:'新名字'},profiles)),'bob.jpg');
    assert.equal(photoAvatar(calendarPerson({accountId:'outside',operator:'原名'},profiles)),'');
    assert.equal(photoAvatar(calendarPerson({accountId:'alice',operator:'原名'},[{...profiles[0],role:'removed'}])),'');
});
test('legacy document identity and unique historical names resolve only inside supplied group profiles',()=>{
    assert.equal(calendarPerson({accountId:'document-a',operator:'原名'},profiles).accountId,'alice');
    assert.equal(calendarPerson({operator:'更早名字'},profiles).accountId,'alice');
    assert.equal(calendarPerson({operator:'原名'},profiles).accountId,undefined,'ambiguous current or historical name must not pick another user');
    assert.equal(calendarPerson({operator:'不存在'},profiles).accountId,undefined);
    assert.equal(calendarPerson({accountId:'alice'},[profiles[0],{...profiles[0],docId:'duplicate'}]).avatar,undefined);
});
test('homepage agenda uses latest account avatar and safely renders profile names without mutating stored events',async()=>{
    const source=await fs.readFile(new URL('../js/dashboard.js',import.meta.url),'utf8');
    const event={accountId:'alice',operator:'原名',title:'今天行程',isAllDay:true};
    const container={innerHTML:''},context={window:{groupMembers:profiles,userAvatarMap:{原名:'bob.jpg'}},document:{getElementById:()=>container},cachedCalendarEvents:[event],calendarPerson,photoAvatar};
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('window.renderAgendaUI ='),source.indexOf('window.fetchAndRenderPhotoCarousel =')),context);
    context.window.renderAgendaUI();
    assert.match(container.innerHTML,/alice.jpg/);assert.ok(!container.innerHTML.includes('bob.jpg'));
    context.window.groupMembers=[{...profiles[0],name:'再次改名 "<姓名>"',avatar:'latest.jpg?x=1&y=2'}];
    context.window.renderAgendaUI();
    assert.match(container.innerHTML,/latest.jpg\?x=1&amp;y=2/);
    assert.match(container.innerHTML,/再次改名 &quot;&lt;姓名&gt;&quot;/);
    assert.equal(event.operator,'原名');assert.equal(event.accountId,'alice');
});
