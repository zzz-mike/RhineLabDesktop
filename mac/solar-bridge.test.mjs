import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {createSolarReader,solarQuery,fetchSolar,SOLAR_MAX_BYTES} from './solar-bridge.mjs';

const NOW=Date.parse('2026-09-25T04:00:00Z');
const STAMP='2026-09-25T11:58:00+08:00';
const GROUP='grp_1234567890abcdef12345678';
const url=path=>new URL('http://127.0.0.1:5180/api/solar/v1/'+path);
const scope={valid:true,id:GROUP};
const ok=data=>({status:200,data});
const station=(patch={})=>({mode:'real',is_demo:false,date:'2026-09-25',historical:false,current_state_saved:true,has_data:true,data_complete:false,daily_completeness:.7,station:{station_code:'NE=1',name:'测试电站',last_updated:STAMP,current_power_kw:null,available_current_power_kw:3,day_energy_kwh:20,capacity_kw:100,raw_json:{secret:'NOT_PUBLIC'}},readings:[{ts:STAMP,power_kw:null,available_power_kw:3,quality:'partial',raw_json:{secret:'NOT_PUBLIC'}}],fallback_readings:[{ts:STAMP,power_kw:2,quality:'reference'}],devices:[device()],alarms:[alarm()],gaps:[gap()],device_count:1,gap_count:1,...patch});
const device=(patch={})=>({device_id:'d1',station_code:'NE=1',station_name:'测试电站',device_type:'逆变器',status:'online',communication_status:'online',operating_status:'running',data_freshness:'fresh',current_power_kw:3,last_updated:STAMP,name:'NOT_PUBLIC',sn:'NOT_PUBLIC',raw_json:{secret:'NOT_PUBLIC'},metrics_json:{'有功功率(kW)':3,'逆变器状态码':0,'凭据':'NOT_PUBLIC','password':'NOT_PUBLIC'},...patch});
const alarm=(patch={})=>({alarm_id:'a1',station_code:'NE=1',station_name:'测试电站',name:'告警',status:'active',level:'critical',raised_at:STAMP,recovered_at:null,last_seen_at:STAMP,cause:'来源原因',suggestion:'来源建议',raw_json:{secret:'NOT_PUBLIC'},...patch});
const gap=(patch={})=>({id:1,station_code:'NE=1',station_name:'测试电站',gap_type:'missing',started_at:STAMP,ended_at:null,missing_points:2,note:'采集缺口',raw_json:{secret:'NOT_PUBLIC'},...patch});
const source=(data,calls=[])=>async(path,options)=>{calls.push({path,options});return ok(data);};

test('all resource routes and real station identifiers are admitted',()=>{
  for(const path of ['catalog','station?station_code=NE%3D1','station?station_code=growatt%3Asource1%3A2&date=2024-02-29','period?period_type=monthly&period=2026-09','period?period_type=yearly&period=2100','devices?status=unsupported&limit=50&offset=0','alerts?status=all&severity=critical','reports?group='+GROUP,'health'])assert.ok(solarQuery(url(path)).resource,path);
});
test('rejects unsupported paths, duplicate/unknown/empty values, canonical dates and traversal',()=>{
  for(const path of ['catalog?url=http://evil','catalog?group='+GROUP,'revenue','reports/generate','station','station?station_code=','station?station_code=..','station?station_code=a%2Fb','station?station_code=a%3Fb','station?station_code=a%252Fb','station?station_code=a%26x%3Dy','station?station_code=a%00b','station?station_code=NE1&date=2026-02-29','station?station_code=NE1&date=2026-13-01','station?station_code=NE1&date=1999-12-31','station?station_code=NE1&date=2026-9-01','period?period_type=daily&period=2026-09-25','period?period_type=monthly&period=2026-99','period?period_type=yearly&period=1900','period?period_type=yearly&period=2026evil','devices?status=everything','devices?limit=51','devices?limit=00','devices?offset=-1','devices?offset=1000000','devices?type=','reports?group=all','alerts?status=unknown','devices?limit=1&limit=2','catalog#fragment'])assert.throws(()=>solarQuery(url(path)),{name:'Error'},path);
});
test('native transport cannot access arbitrary origins, paths or POST-like routes',()=>{
  for(const path of ['http://evil/api/groups','//evil/api/groups','/api/groups/create','/api/reports/generate','/api/stations/a%2Fb','/api/stations/a%3Fx','/api/groups?url=http://evil','/api/overview?collect=1','/api/data/daily?date=2026-09-25'])assert.throws(()=>fetchSolar(path),/solar_route_not_allowed/,path);
});
test('native transport cannot disable the response cap or deadline',()=>{
  for(const options of [{timeout:NaN},{timeout:Infinity},{timeout:0},{maxBytes:Infinity},{maxBytes:0}])assert.throws(()=>fetchSolar('/api/groups',options),/invalid_solar_transport_limit/);
});
test('catalog combines lightweight directory and dates, reports unavailable revenue honestly',async()=>{
  const calls=[];const reader=createSolarReader({clock:()=>NOW,transport:async path=>{calls.push(path);return ok(path==='/api/groups'?{mode:'real',stations:[{station_code:'NE=1',name:'电站',manufacturer:'huawei',raw_json:'NOT_PUBLIC'}],groups:[{id:GROUP,name:'组',member_count:1,raw_json:'NOT_PUBLIC'}]}:{mode:'real',is_demo:false,dates:['2026-09-24','2026-09-25'],latest:'2026-09-25'});}});
  const {data}=await reader(url('catalog'));assert.deepEqual(calls.sort(),['/api/data/available-dates','/api/groups']);assert.equal(data.status,'ok');assert.equal(data.source_updated_at,null);assert.equal(data.capabilities.revenue,false);assert.equal(data.capabilities.device_control,false);assert.equal(data.stations.length,1);assert.equal(data.available_dates.length,2);assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('partial directory failure is explicit and not cached',async()=>{
  let calls=0;const reader=createSolarReader({clock:()=>NOW,transport:async path=>{calls++;if(path.includes('available'))throw Error('NOT_PUBLIC');return ok({mode:'real',stations:[],groups:[]});}});
  const first=await reader(url('catalog'));assert.equal(first.data.status,'partial');assert.deepEqual(first.data.available_dates,[]);await reader(url('catalog'));assert.equal(calls,4);
});
test('catalog mode mismatch is not a valid real-data result',async()=>{
  const reader=createSolarReader({clock:()=>NOW,transport:async path=>ok(path.includes('available')?{mode:'demo',is_demo:true,dates:[]}:{mode:'real',stations:[],groups:[]})});
  assert.equal((await reader(url('catalog'))).data.code,'solar_identity_mismatch');
});
test('station GET is encoded, single-station, null preserving and deeply allowlisted',async()=>{
  const calls=[];const reader=createSolarReader({transport:source(station(),calls),clock:()=>NOW});const {data}=await reader(url('station?station_code=NE%3D1'));
  assert.equal(calls[0].path,'/api/stations/NE%3D1');assert.equal(calls[0].options.maxBytes,SOLAR_MAX_BYTES);assert.equal(data.points[0].value,null);assert.equal(data.points[0].available_value,3);assert.equal(data.points[1].series,'hourly_reference');assert.equal(data.metrics.find(m=>m.key==='power_strict').value,null);assert.equal(data.source_updated_at,STAMP);assert.equal(data.status,'partial');assert.ok(data.rows.some(r=>r.kind==='device'));assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('historical station cannot present current devices or alarms as historical',async()=>{
  const reader=createSolarReader({transport:source(station({date:'2026-09-24',historical:true,current_state_saved:false})),clock:()=>NOW});const {data}=await reader(url('station?station_code=NE%3D1&date=2026-09-24'));
  assert.equal(data.historical,true);assert.ok(data.rows.every(r=>r.kind==='gap'));assert.equal(data.summary_counts.devices,null);assert.ok(!data.metrics.some(m=>m.key.startsWith('power_')));assert.match(data.message,/未保存/);
});
test('station identity/date mismatch fails closed',async()=>{
  for(const patch of [{station:{station_code:'NE=2'}},{date:'2026-09-20'}]){const reader=createSolarReader({transport:source(station(patch)),clock:()=>NOW});const result=await reader(url('station?station_code=NE%3D1&date=2026-09-25'));assert.equal(result.status,502);assert.equal(result.data.code,'solar_identity_mismatch');}
});
test('actual stale measurements remain stale even on successful fresh fetch',async()=>{
  const data=station();data.station.last_updated='2026-09-01T12:00:00+08:00';const reader=createSolarReader({transport:source(data),clock:()=>NOW});const result=await reader(url('station?station_code=NE%3D1'));assert.equal(result.data.status,'stale');assert.notEqual(result.data.source_updated_at,result.data.fetched_at);
});
test('demo payload never inherits real status',async()=>{
  const reader=createSolarReader({transport:source(station({mode:'demo',is_demo:true})),clock:()=>NOW});assert.equal((await reader(url('station?station_code=NE%3D1'))).data.status,'demo');
});
test('device filters are enforced locally as well as passed upstream; page counts remain true',async()=>{
  const data={mode:'real',devices:[device(),device({device_id:'d2',station_code:'NE=2'}),device({device_id:'d3',status:'offline'}),device({device_id:'d4',device_type:'电表'})],offline_records:[]};const calls=[];const reader=createSolarReader({transport:source(data,calls),clock:()=>NOW});
  const result=await reader(url('devices?station_code=NE%3D1&type=逆变器&status=online&limit=1'));assert.equal(result.data.pagination.total,1);assert.equal(result.data.rows[0].id,'d1');assert.match(calls[0].path,/station=NE%3D1/);assert.ok(!JSON.stringify(result.data).includes('NOT_PUBLIC'));
});
test('device arbitrary metrics and identifiers are never public fields',async()=>{
  const reader=createSolarReader({transport:source({mode:'real',devices:[device()],offline_records:[]}),clock:()=>NOW});const {data}=await reader(url('devices'));assert.equal(data.rows[0].title,'逆变器');assert.ok(data.rows[0].fields.some(f=>f.label==='有功功率(kW)'&&f.value==='3'));assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('alarms retain causes and state times but never claim current complete coverage',async()=>{
  const reader=createSolarReader({transport:source({mode:'real',alarms:[alarm(),alarm({alarm_id:'a2',station_code:'NE=2'})],data_gaps:[gap()]}),clock:()=>NOW});const {data}=await reader(url('alerts?station_code=NE%3D1&status=active&severity=critical'));
  assert.equal(data.status,'partial');assert.equal(data.coverage_status,'unverified');assert.equal(data.metrics[0].value,null);assert.equal(data.rows.length,1);assert.equal(data.rows[0].body,'来源原因');assert.ok(data.rows[0].fields.some(f=>f.label==='来源建议'));assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('empty alarms remain partial rather than no-alarm proof; all tab includes gaps',async()=>{
  const reader=createSolarReader({transport:source({mode:'real',alarms:[],data_gaps:[gap()]}),clock:()=>NOW});const active=await reader(url('alerts?status=active'));assert.equal(active.data.rows.length,0);assert.equal(active.data.status,'partial');assert.equal((await reader(url('alerts?status=all'))).data.rows[0].kind,'gap');
});
test('rows are page-bounded, next offset and total exact',async()=>{
  const reader=createSolarReader({transport:source({mode:'real',devices:Array.from({length:70},(_,i)=>device({device_id:String(i)}))}),clock:()=>NOW});
  const {data}=await reader(url('devices?limit=50&offset=10'));assert.equal(data.rows.length,50);assert.deepEqual(data.pagination,{offset:10,limit:50,total:70,next_offset:60,has_more:true});
});
const period=(period_type='monthly',period='2026-09')=>({mode:'real',is_demo:false,period_type,period,total_energy_kwh:null,available_energy_kwh:5,data_complete:false,timeline:[{period:period_type==='monthly'?'2026-09-01':'2026-09',energy_kwh:null,available_energy_kwh:5,data_complete:false}],stations:[{station_code:'NE=1',name:'电站',energy_kwh:null,available_energy_kwh:5,data_complete:false,missing_days:29,daily:[{day:'2026-09-01',energy_kwh:5,completeness:1,last_updated:STAMP,raw_json:{password:'NOT_PUBLIC'}}]},{station_code:'NE=2',name:'别站',energy_kwh:null,available_energy_kwh:null,data_complete:false,missing_days:30,daily:[]}]});
test('single-station month outputs missing days as null, strips raw data and recomputes timeline scope',async()=>{
  const reader=createSolarReader({transport:source(period()),clock:()=>NOW});const {data}=await reader(url('period?period_type=monthly&period=2026-09&station_code=NE%3D1'));
  assert.equal(data.points.length,60);assert.equal(data.points[0].value,5);assert.equal(data.points[2].value,null);assert.equal(data.metrics.find(m=>m.key==='energy_strict').value,null);assert.equal(data.metrics.find(m=>m.key==='energy_available').value,5);assert.equal(data.rows.length,1);assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('year aggregation creates twelve months with strict and subtotal series, no fake zero',async()=>{
  const reader=createSolarReader({transport:source(period('yearly','2026')),clock:()=>NOW});const {data}=await reader(url('period?period_type=yearly&period=2026&station_code=NE%3D1'));assert.equal(data.points.length,24);assert.equal(data.points.find(p=>p.at==='2026-09'&&p.series==='available').value,5);assert.equal(data.points.find(p=>p.at==='2026-09'&&p.series==='strict').value,null);assert.equal(data.points[0].value,null);
});
test('all-station monthly data preserves original strict and subtotal semantics',async()=>{
  const reader=createSolarReader({transport:source(period()),clock:()=>NOW});const {data}=await reader(url('period?period_type=monthly&period=2026-09'));assert.equal(data.metrics[0].value,null);assert.equal(data.metrics[1].value,5);assert.equal(data.points[0].value,null);assert.equal(data.points[1].value,5);
});
test('unknown group cannot silently fall back to all stations',async()=>{
  const reader=createSolarReader({transport:source({...period(),scope:{valid:false,id:''}}),clock:()=>NOW});const result=await reader(url('period?period_type=monthly&period=2026-09&group='+GROUP));assert.equal(result.status,400);assert.equal(result.data.code,'solar_group_not_found');
});
test('reports expose only safe fixed report IDs and no file paths or raw errors',async()=>{
  const report={id:4,period_type:'monthly',period_key:'2026-08',artifact_type:'pdf',status:'ready',file_path:'/Users/SECRET',error_message:'NOT_PUBLIC',input_fingerprint:'NOT_PUBLIC',scope_members_json:'NOT_PUBLIC',data_complete:0,file_size:123,generated_at:STAMP,scope_group_id:GROUP,scope_name_snapshot:'组'};
  const reader=createSolarReader({transport:source({mode:'real',reports:[report,{...report,id:'../../evil'},{...report,id:5,scope_group_id:'other'}],scope}),clock:()=>NOW});const {data}=await reader(url('reports?group='+GROUP));assert.equal(data.rows.length,2);assert.equal(data.rows[0].preview_url,'http://127.0.0.1:8765/preview/4');assert.equal(data.rows[1].preview_url,undefined);assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('health projection omits raw supplier errors and private state',async()=>{
  const reader=createSolarReader({transport:source({mode:'real',status:'healthy',providers:{huawei:{enabled:true,status:'healthy',last_success:STAMP,last_error:'NOT_PUBLIC',token:'NOT_PUBLIC'}}}),clock:()=>NOW});const {data}=await reader(url('health'));assert.equal(data.status,'ok');assert.equal(data.source_updated_at,STAMP);assert.ok(!JSON.stringify(data).includes('NOT_PUBLIC'));
});
test('successful same-query requests coalesce and five-second cache expires',async()=>{
  let now=NOW,calls=0,release;const gate=new Promise(r=>release=r);const reader=createSolarReader({clock:()=>now,transport:async()=>{calls++;await gate;return ok(station());}});
  const a=reader(url('station?station_code=NE%3D1')),b=reader(url('station?station_code=NE%3D1'));release();await Promise.all([a,b]);assert.equal(calls,1);now+=4999;await reader(url('station?station_code=NE%3D1'));assert.equal(calls,1);now+=1;await reader(url('station?station_code=NE%3D1'));assert.equal(calls,2);
});
test('expired cache is not returned as healthy when source fails, errors are not cached',async()=>{
  let now=NOW,calls=0;const reader=createSolarReader({clock:()=>now,transport:async()=>{calls++;if(calls>1)throw Error('NOT_PUBLIC');return ok(station());}});
  await reader(url('station?station_code=NE%3D1'));now+=5000;const result=await reader(url('station?station_code=NE%3D1'));assert.equal(result.status,502);assert.equal(result.data.status,'disconnected');assert.equal(result.data.rows.length,0);assert.ok(!JSON.stringify(result).includes('NOT_PUBLIC'));await reader(url('station?station_code=NE%3D1'));assert.equal(calls,3);
});
test('overall ten-second deadline applies to injected transport and cache miss',async()=>{
  let now=NOW;const reader=createSolarReader({clock:()=>now,transport:async()=>{now+=10001;return ok(station());}});const result=await reader(url('station?station_code=NE%3D1'));assert.equal(result.status,504);assert.equal(result.data.code,'solar_timeout');
});
test('inflight and cache maps are bounded to 64 queries',async()=>{
  let calls=0,release;const gate=new Promise(r=>release=r);const reader=createSolarReader({clock:()=>NOW,transport:async()=>{calls++;await gate;return ok({mode:'real',devices:[]});}});
  const pending=Array.from({length:64},(_,i)=>reader(url('devices?offset='+i)));await assert.rejects(reader(url('devices?offset=64')),/solar_busy/);release();await Promise.all(pending);assert.equal(calls,64);await reader(url('devices?offset=64'));assert.equal(calls,65);await reader(url('devices?offset=0'));assert.equal(calls,66);
});
test('invalid source schema fails closed without leaking original diagnostics',async()=>{
  for(const data of [{mode:'real',is_demo:true,devices:[]},{mode:'real',devices:'NOT_PUBLIC'},{mode:'fake',devices:[]}]){const reader=createSolarReader({clock:()=>NOW,transport:source(data)});const result=await reader(url('devices'));assert.equal(result.status,502);assert.equal(result.data.status,'disconnected');assert.ok(!JSON.stringify(result).includes('NOT_PUBLIC'));}
});
test('native GET fixes host/method, rejects redirect, oversized response and bad JSON',async t=>{
  let scenario='valid';const requests=[];
  t.mock.method(http,'request',(options,callback)=>{requests.push(options);const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=scenario==='redirect'?302:200;response.headers={'content-type':'application/json'};response.resume=()=>{};response.destroy=()=>{};callback(response);if(scenario==='redirect')return;response.emit('data',Buffer.from(scenario==='oversize'?'x'.repeat(SOLAR_MAX_BYTES+1):scenario==='invalid'?'not json':JSON.stringify({mode:'real',groups:[],stations:[]})));response.emit('end');});return request;});
  assert.equal((await fetchSolar('/api/groups')).status,200);assert.equal(requests[0].hostname,'127.0.0.1');assert.equal(requests[0].port,8765);assert.equal(requests[0].method,'GET');assert.equal(requests[0].headers.Authorization,undefined);
  scenario='redirect';await assert.rejects(fetchSolar('/api/groups'),/solar_redirect_denied/);scenario='oversize';await assert.rejects(fetchSolar('/api/groups'),/solar_response_too_large/);scenario='invalid';await assert.rejects(fetchSolar('/api/groups'),/solar_invalid_data/);
});
