import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFleetOverview} from './solar-fleet.mjs';
const now=Date.parse('2026-09-25T12:00:00+08:00'),stamp='2026-09-25T11:59:00+08:00';
const fixture=()=>({mode:'real',date:'2026-09-25',historical:false,station_count:3,last_updated:stamp,total_day_energy_kwh:null,total_current_power_kw:null,available_current_power_kw:10,data_complete:false,stations:[{station_code:'NE=1',name:'一站',day_energy_kwh:0,last_updated:stamp},{station_code:'NE=2',name:'二站',day_energy_kwh:15,last_updated:stamp,data_stale:true},{station_code:'NE=3',name:'三站',day_energy_kwh:null,last_updated:stamp,raw_json:'SECRET'}],total_curve_v2:[{ts:stamp,strict_power_kw:null,power_kw:10,missing_device_count:1}],total_curve_v2_fallback:[{ts:stamp,power_kw:8}]});
test('all stations retained; actual zero differs from unknown',()=>{
 const r=projectFleetOverview(fixture(),{},now);assert.equal(r.station_energy.length,3);assert.deepEqual(r.station_energy.map(s=>s.value),[0,15,null]);assert.equal(r.station_energy[1].stale,true);assert.equal(r.metrics[0].value,null);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('strict, available and hourly reference remain separate',()=>{
 const r=projectFleetOverview(fixture(),{},now);assert.deepEqual(r.points.map(p=>p.value),[null,10,8]);assert.equal(r.points[0].unit,'kW');assert.match(r.points[1].series,/非完整/);assert.match(r.points[2].series,/非实测/);assert.equal(r.status,'partial');
});
test('timestamps and modes never imply fresh physical state',()=>{
 const d=fixture();d.last_updated=null;assert.equal(projectFleetOverview(d,{},now).status,'stale');d.mode='demo';assert.equal(projectFleetOverview(d,{},now).status,'demo');d.mode='real';d.historical=true;assert.equal(projectFleetOverview(d,{},now).status,'partial');
});
test('identity errors, duplicates and inconsistent coverage are rejected',()=>{
 assert.throws(()=>projectFleetOverview(fixture(),{date:'2026-09-24'},now));assert.throws(()=>projectFleetOverview(fixture(),{group:'missing'},now));
 for(const mutate of [d=>d.station_count=4,d=>d.stations[1].station_code='NE=1',d=>d.total_curve_v2[0].ts='bad',d=>d.stations[0].station_code='../x',d=>d.mode='unknown']){const d=fixture();mutate(d);assert.throws(()=>projectFleetOverview(d,{},now));}
});
test('empty source and fallback-only data do not invent line values',()=>{
 const d=fixture();d.stations=[];d.station_count=0;d.total_curve_v2=[];const r=projectFleetOverview(d,{},now);assert.equal(r.status,'empty');assert.equal(r.points.length,1);assert.match(r.points[0].series,/小时/);
});
