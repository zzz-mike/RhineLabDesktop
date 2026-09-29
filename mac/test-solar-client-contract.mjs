// Read-only contract QA: bundles current TypeScript in memory, calls the fixed
// solar reader, and feeds actual projected data into the current UI parser.
// Does not edit src, run report generation, or write business data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSolarReader} from './solar-bridge.mjs';

const require=createRequire(import.meta.url);
const {build}=require('../RhineLabWallpaper/node_modules/esbuild');
const clientPath=fileURLToPath(new URL('../RhineLabWallpaper/src/widget-workbench-client.ts',import.meta.url));
const bundle=await build({entryPoints:[clientPath],bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});
const {parseSolar,getSolar,safeReportURL}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const chartBundle=await build({entryPoints:[fileURLToPath(new URL('../RhineLabWallpaper/src/widget-chart.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});
const {buildChartGroups}=await import('data:text/javascript;base64,'+Buffer.from(chartBundle.outputFiles[0].text).toString('base64'));
const read=createSolarReader();
const endpoint=(resource,parameters={})=>new URL('http://127.0.0.1:5180/api/solar/v1/'+resource+(Object.keys(parameters).length?'?'+new URLSearchParams(parameters):''));
const catalog=await read(endpoint('catalog'));
assert.equal(catalog.status,200);
const code=catalog.data.stations[0]?.station_code;
assert.ok(code,'真实目录至少有一个站');
const historical=catalog.data.available_dates.filter(d=>d<catalog.data.latest_date).at(-1);
const period=catalog.data.latest_date.slice(0,7);
const cases=[
  ['catalog',{}],
  ['station',{station_code:code}],
  ['station',{station_code:code,date:historical}],
  ['period',{period_type:'monthly',period,station_code:code}],
  ['period',{period_type:'yearly',period:period.slice(0,4),station_code:code}],
  ['devices',{station_code:code,limit:'5'}],
  ['alerts',{status:'all',limit:'5'}],
  ['reports',{limit:'5'}],
  ['health',{}],
];
const results=[],warnings=[];
const originalFetch=globalThis.fetch;
const requests=[];
globalThis.fetch=async(path,options={})=>{
  assert.equal(typeof path,'string');
  assert.match(path,/^\/api\/solar\/v1\//);
  assert.ok(!options.method || options.method==='GET');
  assert.equal(options.headers['X-Rhine-Local'],'1');
  requests.push(path);
  const response=await read(new URL(path,'http://127.0.0.1:5180'));
  return new Response(JSON.stringify(response.data),{status:response.status,headers:{'Content-Type':'application/json'}});
};
try {
  for(const [resource,parameters] of cases) {
    const raw=await read(endpoint(resource,parameters));
    assert.equal(raw.status,200,resource+'真实接口成功');
    const start=performance.now();
    const parsed=parseSolar(raw.data,resource);
    const viaGet=await getSolar(resource,parameters);
    assert.equal(viaGet.resource,resource);
    assert.equal(parsed.rows.length,raw.data.rows.length);
    assert.equal(parsed.points.length,raw.data.points.length);
    assert.equal(parsed.source_updated_at,raw.data.source_updated_at);
    assert.equal(parsed.source_mode,raw.data.source_mode);
    assert.equal(parsed.status,raw.data.status);
    assert.deepEqual(parsed.metrics,raw.data.metrics);
    for(let i=0;i<parsed.points.length;i++) {
      assert.equal(parsed.points[i].value,raw.data.points[i].value,'缺测值不能变0');
      assert.equal(parsed.points[i].at,raw.data.points[i].at,'日期/时间应保持原值');
      assert.equal(parsed.points[i].series,raw.data.points[i].series,'曲线类别应保持原值');
    }
    if(raw.data.pagination)assert.deepEqual(parsed.pagination,raw.data.pagination);
    if(resource==='catalog'){assert.deepEqual(parsed.stations,raw.data.stations);assert.deepEqual(parsed.available_dates,raw.data.available_dates);assert.deepEqual(parsed.groups,raw.data.groups);}
    if(resource==='reports')for(let i=0;i<parsed.rows.length;i++){assert.equal(parsed.rows[i].preview_url,raw.data.rows[i].preview_url);assert.equal(parsed.rows[i].download_url,raw.data.rows[i].download_url);}
    if(raw.data.points.some(p=>p.available_value!==undefined)&&parsed.points.every(p=>p.available_value===undefined))warnings.push({resource,field:'points.available_value / missing_device_count',issue:'parser omits optional subtotal and missing-device metadata'});
    const charts=buildChartGroups(parsed.points);
    assert.ok(charts.every(c=>c.unknownDates===0),'所有实际点时间可用于图表');
    results.push({resource,queryVariant:parameters.period_type??(parameters.date?'historical':'default'),ok:true,http:raw.status,status:parsed.status,source_mode:parsed.source_mode,rows:parsed.rows.length,points:parsed.points.length,unknown_source_time:parsed.source_updated_at===null,parseAndCachedGetMs:Math.round((performance.now()-start)*100)/100,chartGroups:charts.length});
  }
} finally {globalThis.fetch=originalFetch;}

const empty={schema_version:'1.0',resource:'health',title:'fixture',status:'disconnected',source_mode:'unknown',fetched_at:'2026-09-25T04:00:00Z',source_updated_at:null,message:'来源时间未知',rows:[],metrics:[],points:[]};
assert.equal(parseSolar(empty,'health').source_updated_at,null);
for(const value of ['http://evil/preview/1','http://127.0.0.1:8765/preview/1?token=x','http://127.0.0.1:8765/preview/1#x','http://name:password@127.0.0.1:8765/preview/1','http://127.0.0.1:8765/preview/../download/1','http://127.0.0.1:8765/preview/01','http://127.0.0.1:8765/preview/%31'])assert.equal(safeReportURL(value,'preview'),undefined,'异常报告URL拒绝');
assert.equal(safeReportURL('http://127.0.0.1:8765/preview/1','preview'),'http://127.0.0.1:8765/preview/1');
assert.throws(()=>parseSolar({...empty,resource:'station'},'health'));
assert.throws(()=>parseSolar({...empty,schema_version:1},'health'));
console.log(JSON.stringify({readOnly:true,source:'fixed loopback solar reader, current TypeScript bundled in memory',clientSha256:createHash('sha256').update(await readFile(clientPath)).digest('hex'),resourcesPassed:[...new Set(results.map(r=>r.resource))].length,cases:results,requests:requests.length,unsafeReportURLsRejected:7,unknownTimestampPreserved:true,warnings},null,2));
