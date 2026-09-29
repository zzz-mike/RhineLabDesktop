import http from 'node:http';
import {FileBridgeError} from './desktop-files.mjs';
import {projectFleetOverview} from './solar-fleet.mjs';

// Read-only, fixed loopback access to normalized solar data. Never calls a
// vendor, loads credentials, starts a collector, or forwards arbitrary URLs.
export const SOLAR_TIMEOUT_MS = 10000;
export const SOLAR_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 5000;
const MAX_KEYS = 64;
const fields = {
  catalog: [], overview: ['date', 'group'], station: ['station_code', 'date'],
  period: ['period_type', 'period', 'station_code', 'group'],
  devices: ['station_code', 'type', 'status', 'group', 'limit', 'offset'],
  alerts: ['station_code', 'status', 'severity', 'group', 'limit', 'offset'],
  reports: ['group', 'limit', 'offset'], health: [],
};
const titles = {catalog:'光伏电站与日期',station:'电站详情',period:'发电统计',devices:'设备与状态',alerts:'告警与采集缺口',reports:'报告与下载',health:'光伏接收状态'};
const deviceStatuses = new Set(['online','offline','stale','unsupported','unknown','normal','abnormal']);
const metricNames = new Set(['有功功率(kW)','有功功率(W)','今日发电量(kWh)','当日发电量(kWh)','累计发电量(kWh)','内部温度(°C)','转换效率(%)','电网频率(Hz)','MPPT输入功率(kW)','PV输入功率(kW)','功率因数','逆变器状态码','运行状态码','瑞光状态标志','正向有功电量(kWh)','反向有功电量(kWh)']);
const fail = (status, code) => {throw new FileBridgeError(status, code);};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max=240) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const when = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(value) && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const latest = values => values.map(when).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1) ?? null;
const field = (label,value) => ({label,value:typeof value === 'number' ? String(value) : text(value,900) || '未知'});
const metric = (key,label,value,unit) => ({key,label,value:number(value),unit});
const sum = values => values.some(v=>number(v)!==null) ? values.reduce((s,v)=>s+(number(v)??0),0) : null;
const array = value => {if(!Array.isArray(value) || value.length>20000)fail(502,'solar_invalid_data');return value;};
const mode = data => {if(!object(data) || !['real','demo'].includes(data.mode) || ('is_demo' in data && data.is_demo !== (data.mode==='demo')))fail(502,'solar_invalid_data');return data.mode;};
const stale = (stamp,now) => !stamp || now-Date.parse(stamp)>20*60*1000 || Date.parse(stamp)>now+120000;
function dateValid(value) {const stamp=new Date(value+'T00:00:00Z');return /^\d{4}-\d\d-\d\d$/.test(value) && value>='2000-01-01' && value<='2100-12-31' && Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0,10)===value;}
function queryText(value,max=100) {return typeof value==='string' && value.length>0 && value.length<=max && !/[\x00-\x1f\x7f]/.test(value);}
function stationValid(value) {return queryText(value,160) && /^[\p{L}\p{N}_=:. -]+$/u.test(value) && !value.includes('..');}

export function solarQuery(url) {
  if(!(url instanceof URL) || url.hash)fail(400,'invalid_solar_query');
  const match=url.pathname.match(/^\/api\/solar\/v1\/([a-z]+)$/);
  const resource=match?.[1];
  if(!fields[resource])fail(404,'solar_route_not_allowed');
  for(const key of url.searchParams.keys())if(!fields[resource].includes(key) || url.searchParams.getAll(key).length!==1)fail(400,'invalid_solar_query');
  const q=Object.fromEntries(url.searchParams);
  if(q.station_code!==undefined && !stationValid(q.station_code))fail(400,'invalid_station_code');
  if(resource==='station' && !q.station_code)fail(400,'invalid_station_code');
  if(q.group!==undefined && !/^grp_[0-9a-f]{24}$/.test(q.group))fail(400,'invalid_solar_group');
  if(q.date!==undefined && !dateValid(q.date))fail(400,'invalid_solar_date');
  if(q.type!==undefined && !queryText(q.type,80))fail(400,'invalid_device_type');
  if(q.severity!==undefined && !queryText(q.severity,40))fail(400,'invalid_alarm_severity');
  if(q.status!==undefined && !(resource==='alerts'?['active','recovered','all'].includes(q.status):deviceStatuses.has(q.status)))fail(400,'invalid_solar_status');
  if(q.limit!==undefined && (!/^[1-9][0-9]?$/.test(q.limit) || +q.limit>50))fail(400,'invalid_solar_limit');
  if(q.offset!==undefined && (!/^(0|[1-9][0-9]{0,5})$/.test(q.offset)))fail(400,'invalid_solar_offset');
  if(resource==='period') {
    if(!['monthly','yearly'].includes(q.period_type))fail(400,'invalid_solar_period');
    if(q.period_type==='monthly' ? !/^\d{4}-\d\d$/.test(q.period??'') || !dateValid(q.period+'-01') : !/^20\d{2}$|^2100$/.test(q.period??''))fail(400,'invalid_solar_period');
  }
  const params=new URLSearchParams(Object.entries(q).sort(([a],[b])=>a.localeCompare(b)));
  return {resource,q,key:resource+'?'+params};
}

function upstreamPathAllowed(path) {
  if(typeof path!=='string' || !path.startsWith('/api/') || path.includes('#'))return false;
  const url=new URL(path,'http://127.0.0.1:8765');
  if(url.origin!=='http://127.0.0.1:8765')return false;
  let route=url.pathname;
  if(route.startsWith('/api/stations/')) {
    let code;try{code=decodeURIComponent(route.slice(14));}catch{return false;}
    if(!stationValid(code))return false;
    route='/api/stations';
  }
  const allowed={'/api/overview':['date','group'], '/api/groups':[], '/api/data/available-dates':[], '/api/stations':['date'], '/api/data/monthly':['month','group'], '/api/data/yearly':['year','group'], '/api/devices':['station','type','status','group'], '/api/alarms':['group'], '/api/reports':['group'], '/api/health':[]}[route];
  return !!allowed && [...url.searchParams.keys()].every(k=>allowed.includes(k)&&url.searchParams.getAll(k).length===1);
}

export function fetchSolar(path,{timeout=SOLAR_TIMEOUT_MS,maxBytes=SOLAR_MAX_BYTES}={}) {
  if(!upstreamPathAllowed(path))fail(404,'solar_route_not_allowed');
  if(!Number.isFinite(timeout)||timeout<=0||!Number.isSafeInteger(maxBytes)||maxBytes<=0)fail(400,'invalid_solar_transport_limit');
  maxBytes=Math.min(maxBytes,SOLAR_MAX_BYTES);
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const request=http.request({hostname:'127.0.0.1',port:8765,path,method:'GET',headers:{Accept:'application/json'}},response=>{
      if(response.statusCode!==200){response.resume();finish(new FileBridgeError(response.statusCode>=300&&response.statusCode<400?502:response.statusCode===400?400:502,response.statusCode>=300&&response.statusCode<400?'solar_redirect_denied':'solar_upstream_error'));return;}
      if(!/^application\/json(?:;|$)/i.test(String(response.headers['content-type']||''))){response.resume();finish(new FileBridgeError(502,'solar_invalid_data'));return;}
      let bytes=0;const chunks=[];
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){response.destroy();finish(new FileBridgeError(502,'solar_response_too_large'));}else chunks.push(chunk);});
      response.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));mode(data);finish(null,{status:200,data});}catch{finish(new FileBridgeError(502,'solar_invalid_data'));}});
      response.on('error',()=>finish(new FileBridgeError(502,'solar_unavailable')));
      response.on('aborted',()=>finish(new FileBridgeError(502,'solar_unavailable')));
    });
    const timer=setTimeout(()=>{request.destroy();finish(new FileBridgeError(504,'solar_timeout'));},Math.min(SOLAR_TIMEOUT_MS,Math.max(1,timeout)));
    request.on('error',()=>finish(new FileBridgeError(502,'solar_unavailable')));request.end();
  });
}

const base = (resource,source,now) => ({schema_version:'1.0',resource,title:titles[resource],status:source==='demo'?'demo':'ok',source_mode:source,fetched_at:new Date(now).toISOString(),source_updated_at:null,message:'仅读取原站本地已保存数据；刷新不触发厂家采集。',rows:[],metrics:[],points:[]});
function scopeValid(data,q) {if(q.group && (!data.scope || data.scope.valid!==true || data.scope.id!==q.group))fail(400,'solar_group_not_found');}
function paginate(rows,q) {const offset=+(q.offset??0),limit=+(q.limit??20);return {rows:rows.slice(offset,offset+limit),pagination:{offset,limit,total:rows.length,next_offset:offset+limit<rows.length?offset+limit:null,has_more:offset+limit<rows.length}};}
function catalogStation(row) {if(!object(row)||!stationValid(row.station_code))fail(502,'solar_invalid_data');return{station_code:row.station_code,name:text(row.name)||'未命名电站',manufacturer:text(row.manufacturer,60)||'unknown'};}
function pointsFrom(readings,series) {return array(readings??[]).map(p=>({at:when(p.ts),value:number(p.power_kw),available_value:number(p.available_power_kw),unit:'kW',series,quality:text(p.quality,80)||'unknown',missing_device_count:number(p.missing_device_count)})).filter(p=>p.at);}
function deviceRow(d) {
  const metrics=object(d.metrics_json)?Object.entries(d.metrics_json).filter(([k,v])=>metricNames.has(k)&&number(v)!==null).map(([k,v])=>field(k,v)):[];
  return{id:text(d.device_id),kind:'device',title:text(d.device_type,100)||'设备',body:text(d.station_name),status:text(d.status,40)||'unknown',station_code:text(d.station_code),fields:[field('通信',d.communication_status),field('运行',d.operating_status),field('数据时效',d.data_freshness),field('功率 kW',number(d.current_power_kw)),field('测量时间',when(d.last_updated)),...metrics]};
}
function alertRow(a) {return{id:text(a.alarm_id??String(a.id??'')),kind:'alarm',title:text(a.name)||'来源告警',body:text(a.cause,800),status:text(a.status,40),station_code:text(a.station_code),fields:[field('电站',a.station_name),field('等级',a.level??a.severity),field('触发',when(a.raised_at)),field('恢复',when(a.recovered_at)),field('最后观察',when(a.last_seen_at)),field('来源建议',text(a.suggestion,900))]};}
function gapRow(g) {return{id:'gap:'+text(String(g.id??'')),kind:'gap',title:'采集缺口 · '+text(g.gap_type,80),body:text(g.note,800),status:'unknown',station_code:text(g.station_code),fields:[field('电站',g.station_name),field('开始',when(g.started_at)),field('结束',when(g.ended_at)),field('缺失点',number(g.missing_points))]};}

function stationPayload(data,q,now) {
  if(!object(data.station) || data.station.station_code!==q.station_code || (q.date && data.date!==q.date))fail(502,'solar_identity_mismatch');
  const r=base('station',mode(data),now),s=data.station;
  r.title=text(s.name)||r.title;r.station_code=s.station_code;r.date=text(data.date,10);r.historical=data.historical===true;r.current_state_saved=data.current_state_saved===true;
  r.source_updated_at=when(s.last_updated);r.data_complete=data.data_complete===true;
  r.metrics=[metric('energy','当日发电量',s.day_energy_kwh,'kWh'),metric('power_strict','当前功率（严格值）',s.current_power_kw,'kW'),metric('power_available','当前功率（可用小计）',s.available_current_power_kw,'kW'),metric('peak','当日峰值',s.peak_power_kw,'kW'),metric('capacity','装机容量',s.capacity_kw,'kW'),metric('completeness','日数据完整性',data.daily_completeness,'比例')];
  r.points=[...pointsFrom(data.readings,'realtime'),...pointsFrom(data.fallback_readings,'hourly_reference')];
  r.rows=[...array(data.devices??[]).slice(0,50).map(deviceRow),...array(data.alarms??[]).slice(0,50).map(alertRow),...array(data.gaps??[]).slice(0,50).map(gapRow)];
  r.message=r.historical?'历史日曲线；当时设备与告警状态未保存。小时参考与实测分列，缺测不补零。':'当前设备与已有历史告警；告警全量覆盖未知。小时参考与实测分列，严格值不以可用小计替代。';
  if(r.historical){r.rows=array(data.gaps??[]).slice(0,50).map(gapRow);r.metrics=r.metrics.filter(m=>!m.key.startsWith('power_'));}
  if(r.source_mode!=='demo')r.status=!data.has_data?'empty':!r.historical&&stale(r.source_updated_at,now)?'stale':r.data_complete?'ok':'partial';
  r.summary_counts={devices:r.historical?null:number(data.device_count),gaps:number(data.gap_count),recorded_alarms:r.historical?null:array(data.alarms??[]).length,alarm_coverage:'unverified'};
  return r;
}

function periodPayload(data,q,now) {
  const r=base('period',mode(data),now);if(data.period_type!==q.period_type || data.period!==q.period)fail(502,'solar_identity_mismatch');scopeValid(data,q);
  const stations=array(data.stations);const selected=q.station_code?stations.filter(s=>s.station_code===q.station_code):stations;
  if(q.station_code && selected.length!==1)fail(404,'solar_station_not_found');
  r.period_type=q.period_type;r.period=q.period;r.station_code=q.station_code??null;r.title=q.station_code?text(selected[0].name)+' · 发电统计':titles.period;
  let timeline;
  if(q.station_code){
    const daily=array(selected[0].daily??[]);const buckets=new Map();
    for(const d of daily){if(!dateValid(d.day??''))continue;const key=q.period_type==='monthly'?d.day:d.day.slice(0,7);if(!key.startsWith(q.period))continue;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(d);}
    const year=+q.period.slice(0,4),month=+q.period.slice(5,7);
    const size=q.period_type==='monthly'?new Date(Date.UTC(year,month,0)).getUTCDate():12;
    timeline=Array.from({length:size},(_,i)=>{const key=q.period+'-'+String(i+1).padStart(2,'0');const rows=buckets.get(key)??[];const expected=q.period_type==='monthly'?1:new Date(Date.UTC(year,i+1,0)).getUTCDate();const complete=rows.length===expected && rows.every(d=>number(d.energy_kwh)!==null&&number(d.completeness)>=1);return{period:key,energy_kwh:complete?sum(rows.map(d=>d.energy_kwh)):null,available_energy_kwh:sum(rows.map(d=>d.energy_kwh)),data_complete:complete};});
  }else timeline=array(data.timeline);
  const complete=selected.length>0&&selected.every(s=>s.data_complete===true);
  const strict=complete?sum(selected.map(s=>s.energy_kwh)):null,available=sum(selected.map(s=>s.available_energy_kwh));
  r.metrics=[metric('energy_strict','期间发电量（完整数据）',strict,'kWh'),metric('energy_available','已保存数据小计',available,'kWh'),metric('stations','电站数',selected.length,'站')];
  r.data_complete=complete;r.source_updated_at=latest(selected.flatMap(s=>array(s.daily??[]).map(d=>d.last_updated)));
  r.points=timeline.flatMap(p=>[{at:text(p.period,10),value:number(p.energy_kwh),unit:'kWh',series:'strict',quality:p.data_complete?'complete':'partial'},{at:text(p.period,10),value:number(p.available_energy_kwh),unit:'kWh',series:'available',quality:p.data_complete?'complete':'partial'}]);
  r.rows=selected.map(s=>({id:text(s.station_code),title:text(s.name),body:s.data_complete?'期间数据完整':'期间存在缺日或不完整记录',fields:[field('完整发电量 kWh',number(s.energy_kwh)),field('已保存小计 kWh',number(s.available_energy_kwh)),field('缺失/不完整天数',number(s.missing_days))]}));
  r.message='已保存日结数据统计，不代表收款或收益。严格总数与可用小计分开；缺日、未结束日期不按零处理。';
  if(r.source_mode!=='demo')r.status=available===null?'empty':complete?'ok':'partial';return r;
}

function listPayload(resource,data,q,now) {
  const r=base(resource,mode(data),now);scopeValid(data,q);let rows=[];
  if(resource==='devices') {
    const devices=array(data.devices).filter(d=>(!q.station_code||d.station_code===q.station_code)&&(!q.type||d.device_type===q.type)&&(!q.status||d.status===q.status));
    rows=devices.map(deviceRow);r.source_updated_at=latest(devices.map(d=>d.last_updated));
    r.metrics=[metric('devices','筛选设备',devices.length,'台'),metric('offline','来源标记离线',devices.filter(d=>d.status==='offline').length,'台')];
    r.message='当前已保存设备状态。未提供、数据过期与设备离线分开；不支持设备控制。';
    if(r.source_mode!=='demo')r.status=devices.length===0?'empty':devices.some(d=>stale(when(d.last_updated),now)||d.status==='stale')?'stale':devices.some(d=>d.status==='unsupported')?'partial':'ok';
  } else if(resource==='alerts') {
    const alerts=array(data.alarms).filter(a=>(!q.station_code||a.station_code===q.station_code)&&(!q.status||q.status==='all'||a.status===q.status)&&(!q.severity||String(a.level??a.severity)===q.severity));
    const gaps=(!q.status||q.status==='all')&&!q.severity?array(data.data_gaps??[]).filter(g=>!q.station_code||g.station_code===q.station_code):[];
    rows=[...alerts.map(alertRow),...gaps.map(gapRow)];r.source_updated_at=latest(alerts.flatMap(a=>[a.raised_at,a.recovered_at,a.last_seen_at]));
    r.metrics=[metric('active_total','当前活动告警总数（覆盖未知）',null,'条'),metric('records','筛选历史告警记录',alerts.length,'条'),metric('gaps','筛选采集缺口',gaps.length,'段')];
    r.message='告警全量覆盖未获逐站采集证明；空列表不等于没有告警。采集缺口不是设备故障，历史触发/恢复/观察时间分别保留。';
    r.coverage_status='unverified';if(r.source_mode!=='demo')r.status='partial';
  } else {
    const reports=array(data.reports).filter(a=>!q.group||a.scope_group_id===q.group);
    rows=reports.map(a=>{
      const validId=Number.isSafeInteger(a.id)&&a.id>0?String(a.id):null;
      const row={id:validId??'',title:text(a.period_key,10)+' '+({daily:'日报',monthly:'月报',yearly:'年报'}[a.period_type]??'报告'),body:text(a.scope_name_snapshot)||'全部电站',fields:[field('类型',a.artifact_type==='pdf'?'PDF':a.artifact_type==='ai_package'?'AI 资料包':'其他'),field('生成状态',a.status),field('数据完整性',a.data_complete?'完整':'存在缺失'),field('生成时间',when(a.generated_at)),field('大小 bytes',number(a.file_size))]};
      if(validId&&a.status==='ready'&&a.artifact_type==='pdf')row.preview_url='http://127.0.0.1:8765/preview/'+validId;
      if(validId&&a.status==='ready')row.download_url='http://127.0.0.1:8765/download/'+validId;
      return row;
    });r.source_updated_at=latest(reports.map(a=>a.generated_at));
    r.message='已生成本地报告，可按页查看并预览/下载。生成时间不是数据测量时间；报告生成和分组编辑暂留原站，避免刷新时触发重任务。';
    if(r.source_mode!=='demo')r.status=rows.length?'ok':'empty';
  }
  Object.assign(r,paginate(rows,q));return r;
}

function healthPayload(data,now) {
  const r=base('health',mode(data),now);if(!object(data.providers))fail(502,'solar_invalid_data');
  const providers=[['huawei','华为',data.providers.huawei],['growatt','瑞光汇总',data.providers.growatt],...(Array.isArray(data.providers.growatt_sources)?data.providers.growatt_sources.slice(0,20).map((p,i)=>['growatt-'+i,'瑞光数据源 '+(i+1),p]):[])].filter(([, ,p])=>object(p));
  r.rows=providers.map(([id,title,p])=>({id,title,body:p.enabled===false?'未接入':'仅表示采集连接健康，不证明每个电站数据完整',fields:[field('连接状态',p.status),field('数据时效',p.freshness),field('最近成功接收',when(p.last_success)),field('最近有效测量',when(p.last_valid_measurement))]}));
  r.source_updated_at=latest(providers.map(([, ,p])=>p.last_success));r.message='连接成功不等于设备正常或告警覆盖完整；这里不显示凭据或内部错误原文。';
  if(r.source_mode!=='demo')r.status=data.status==='healthy'?'ok':'partial';return r;
}

/** Consumer receives stable 1.0 projections, never original provider payloads. */
export function createSolarReader({transport=fetchSolar,clock=Date.now}={}) {
  const cache=new Map(),inflight=new Map();
  return async url=>{
    const {resource,q,key}=solarQuery(url);const now=clock(),hit=cache.get(key);
    if(hit && now-hit.at>=0 && now-hit.at<CACHE_MS)return hit.result;
    if(inflight.has(key))return inflight.get(key);
    if(inflight.size>=MAX_KEYS)fail(503,'solar_busy');
    const pending=(async()=>{
      const deadline=now+SOLAR_TIMEOUT_MS;
      const get=async path=>{
        const remaining=deadline-clock();if(remaining<=0)fail(504,'solar_timeout');
        let timer;const result=await Promise.race([transport(path,{timeout:remaining,maxBytes:SOLAR_MAX_BYTES}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new FileBridgeError(504,'solar_timeout')),remaining);})]).finally(()=>clearTimeout(timer));
        if(clock()>deadline)fail(504,'solar_timeout');
        if(result?.status!==200 || !object(result.data))fail(502,'solar_upstream_error');mode(result.data);return result.data;
      };
      try {
        let data,cacheable=true;const params=new URLSearchParams();if(q.group)params.set('group',q.group);
        if(resource==='catalog') {
          const results=await Promise.allSettled([get('/api/groups'),get('/api/data/available-dates')]);
          const groups=results[0].status==='fulfilled'?results[0].value:null,dates=results[1].status==='fulfilled'?results[1].value:null;
          if(!groups&&!dates)fail(502,'solar_unavailable');if(groups&&dates&&groups.mode!==dates.mode)fail(502,'solar_identity_mismatch');
          data=base(resource,mode(groups??dates),clock());data.stations=groups?array(groups.stations).map(catalogStation):[];
          data.groups=groups?array(groups.groups).filter(g=>/^grp_[0-9a-f]{24}$/.test(g.id??'')).map(g=>({id:g.id,name:text(g.name),member_count:number(g.member_count)})):[];
          data.available_dates=dates?array(dates.dates).filter(d=>typeof d==='string'&&dateValid(d)):[];
          data.latest_date=dates&&typeof dates.latest==='string'&&dateValid(dates.latest)?dates.latest:null;
          data.capabilities={station_history:true,monthly:true,yearly:true,devices:true,alerts:true,reports:true,group_filter:true,device_control:false,revenue:false,report_generation:false,group_edit:false};
          if(!groups||!dates){cacheable=false;data.status=data.source_mode==='demo'?'demo':'partial';data.message='目录或日期读取未完整成功，请重试；未用旧缓存冒充当前结果。';}
        } else if(resource==='overview') {
          if(q.date)params.set('date',q.date);
          data=projectFleetOverview(await get('/api/overview'+(params.size?'?'+params:'')),q,clock());
        } else if(resource==='station') {
          if(q.date)params.set('date',q.date);data=stationPayload(await get('/api/stations/'+encodeURIComponent(q.station_code)+(params.size?'?'+params:'')),q,clock());
        } else if(resource==='period') {
          params.set(q.period_type==='monthly'?'month':'year',q.period);data=periodPayload(await get('/api/data/'+q.period_type+'?'+params),q,clock());
        } else if(resource==='health')data=healthPayload(await get('/api/health'),clock());
        else {
          if(resource==='devices'){if(q.station_code)params.set('station',q.station_code);if(q.type)params.set('type',q.type);if(q.status)params.set('status',q.status);}
          data=listPayload(resource,await get('/api/'+(resource==='alerts'?'alarms':resource)+(params.size?'?'+params:'')),q,clock());
        }
        const result={status:200,data};if(cacheable){cache.delete(key);cache.set(key,{at:clock(),result});while(cache.size>MAX_KEYS)cache.delete(cache.keys().next().value);}return result;
      } catch(error) {
        cache.delete(key);const status=error instanceof FileBridgeError?error.status:502;const code=error instanceof FileBridgeError&&['solar_group_not_found','solar_station_not_found','solar_identity_mismatch','solar_timeout'].includes(error.code)?error.code:'solar_unavailable';
        return{status,data:{...base(resource,'unknown',clock()),status:'disconnected',code,message:'当前无法完整读取光伏原站数据，请重试。未返回空数据或过期缓存作为正常结果。'}};
      }
    })();
    inflight.set(key,pending);try{return await pending;}finally{inflight.delete(key);}
  };
}
