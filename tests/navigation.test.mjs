import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanNavigation,resolveNavigation,MAX_NAV_FEATURES} from '../js/navigation-config.js';
test('six-feature maximum, stable order, duplicates and unknown features removed',()=>{
 assert.equal(MAX_NAV_FEATURES,6);
 assert.deepEqual(cleanNavigation(['todo','todo','bogus','calendar','chat','finance','photodump','food','gamezone']),['todo','calendar','chat','finance','photodump','food']);
});
test('permission filtering, explicit empty selection and legacy defaults',()=>{
 const user={menus:['food','todo','calendar']};
 assert.deepEqual(resolveNavigation(user,{navigation:{items:['chat','todo','food']}}),['todo','food']);
 assert.deepEqual(resolveNavigation(user,{navigation:{items:[]}}),[]);
 assert.deepEqual(resolveNavigation(user,{order:['calendar','bogus','food']}),['calendar','food','todo']);
 assert.equal(resolveNavigation({}).length,6);
 assert.deepEqual(resolveNavigation({menus:[]}),[]);
});
