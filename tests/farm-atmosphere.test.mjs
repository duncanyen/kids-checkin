import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereAt, WEATHER_SLOT_MS, WEATHER_FADE_MS } from '../js/farm/atmosphere-core.js';
const at = time => Date.parse('2026-10-24T' + time + '+08:00');

test('Taiwan phases use UTC+8 regardless of device timezone; midnight remains continuous', () => {
    for (const [time, phase] of [['04:59:59','夜晚'],['05:00:00','晨光'],['06:59:59','晨光'],['07:00:00','白晝'],['16:29:59','白晝'],['16:30:00','黃昏'],['18:29:59','黃昏'],['18:30:00','夜晚'],['23:59:59','夜晚'],['00:00:00','夜晚']]) assert.equal(atmosphereAt(at(time),'A').phase, phase);
    assert.equal(atmosphereAt(Date.parse('2026-10-23T23:00:00Z'),'A').time,'07:00');
    assert.equal(atmosphereAt(at('12:00:00'),'A').shade,0);
    assert.equal(atmosphereAt(at('23:00:00'),'A').night,1);
    for (const time of ['05:00:00','06:00:00','07:00:00','16:30:00','17:30:00','18:30:00','00:00:00']) {
        const a=atmosphereAt(at(time)-1,'A'), b=atmosphereAt(at(time),'A');
        assert.ok(Math.abs(a.shade-b.shade)<.001);
        assert.ok(Math.abs(a.night-b.night)<.001);
        assert.ok(a.color.every((v,i)=>Math.abs(v-b.color[i])<=1));
    }
});

test('deterministic group weather, bounded weights and 20-second smooth transitions', () => {
    const weather=new Set();let differences=0,changes=0;
    const start=Math.floor(at('12:00:00')/WEATHER_SLOT_MS)*WEATHER_SLOT_MS;
    for(let i=0;i<160;i++){
        const stamp=start+i*WEATHER_SLOT_MS;
        const a=atmosphereAt(stamp,'A');
        assert.deepEqual(a,atmosphereAt(stamp,'A'));
        if(a.weather!==atmosphereAt(stamp,'B').weather)differences++;
        weather.add(a.weather);
        for(const offset of [0,1000,10000,20000,30000]){
            const s=atmosphereAt(stamp+offset,'A');
            assert.ok(Math.abs(Object.values(s.weights).reduce((sum,v)=>sum+v,0)-1)<1e-10);
            assert.ok(Object.values(s.weights).every(v=>v>=0&&v<=1));
        }
        if(a.previousWeather!==a.weather){
            changes++;
            assert.equal(a.weights[a.previousWeather],1);
            assert.equal(atmosphereAt(stamp+WEATHER_FADE_MS/2,'A').weights[a.weather],.5);
            assert.equal(atmosphereAt(stamp+WEATHER_FADE_MS,'A').weights[a.weather],1);
            assert.equal(atmosphereAt(stamp-1,'A').weights[a.previousWeather],1);
        }
        assert.equal(a.nextWeatherAt,stamp+WEATHER_SLOT_MS);
    }
    assert.equal(weather.size,4);assert.ok(differences>30);assert.ok(changes>30);
});
