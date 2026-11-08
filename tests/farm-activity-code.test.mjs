import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCodes} from '../js/farm/activity-code.js';

test('activity codes support explicit fields and labelled legacy content with normalized duplicates removed',()=>{
 assert.deepEqual(activityCodes({activityCode:'test-２０２６',content:'活動碼：TEST2026\n兌換碼: OTHER2026'}),['TEST2026','OTHER2026']);
 assert.deepEqual(activityCodes({body:'序號：「SUMMER2026」'}),['SUMMER2026']);
 assert.deepEqual(activityCodes({content:'官方網站 https://example.com/SUMMER2026 與一般文字 ABCDEFGH'}),[]);
});
test('invalid and oversized codes never become redeem actions and extraction is bounded',()=>{
 assert.deepEqual(activityCodes({activityCode:'<img src=x>',content:'活動碼：短碼\n活動碼：'+ 'A'.repeat(129)}),[]);
 assert.equal(activityCodes({content:Array.from({length:10},(_,i)=>'活動碼: EVENT202'+i).join('\n')}).length,5);
});
