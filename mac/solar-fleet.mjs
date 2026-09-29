import {FileBridgeError} from './desktop-files.mjs';

// Projection only: no collection, business writes, credentials or raw provider fields.
export function projectFleetOverview(data,q,now) {
  const fail=()=>{throw new FileBridgeError(502,'solar_invalid_overview');};
  const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const txt=(v,max=240)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,'').slice(0,max):'';
  const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
  const rows=v=>{if(!Array.isArray(v)||v.length>10000)fail();return v;};
  if(!data||!['real','demo'].includes(data.mode)||!/^\d{4}-\d\d-\d\d$/.test(data.date??'')||(q.date&&data.date!==q.date))fail();
  if(q.group&&(!data.scope?.valid||data.scope.id!==q.group))throw new FileBridgeError(400,'solar_group_not_found');
  const stations=rows(data.stations),codes=new Set();
  if(data.station_count!==stations.length)fail();
  const energy=stations.map(s=>{
    if(!s||typeof s.station_code!=='string'||!/^[\p{L}\p{N}_=:. -]{1,160}$/u.test(s.station_code)||s.station_code.includes('..')||codes.has(s.station_code))fail();
    codes.add(s.station_code);
    return {station_code:s.station_code,name:txt(s.name)||'未命名电站',value:num(s.day_energy_kwh),unit:'kWh',updated_at:stamp(s.last_updated),stale:s.data_stale===true};
  });
  const points=[];
  for(const [values,reference] of [[data.total_curve_v2??data.total_curve??[],false],[data.total_curve_v2_fallback??[],true]]) {
    for(const p of rows(values)) {
      if(!p||!stamp(p.ts))fail();
      const meta={at:p.ts,unit:'kW',quality:txt(p.quality,80)||'unknown',missing_device_count:num(p.missing_device_count)};
      if(reference)points.push({...meta,value:num(p.power_kw),series:'小时电量折算参考（非实测）'});
      else points.push({...meta,value:num(p.strict_power_kw),series:'完整总功率'}, {...meta,value:num(p.power_kw),series:'可用功率小计（非完整总量）'});
    }
  }
  const updated=stamp(data.last_updated),historical=data.historical===true;
  const stale=!historical&&(!updated||now-Date.parse(updated)>20*60000||Date.parse(updated)>now+120000);
  const metric=(key,label,value,unit)=>({key,label,value:num(value),unit});
  return {schema_version:'1.0',resource:'overview',title:'全部电站',source_mode:data.mode,
    status:data.mode==='demo'?'demo':!stations.length?'empty':stale?'stale':data.data_complete===true?'ok':'partial',
    fetched_at:new Date(now).toISOString(),source_updated_at:updated,date:data.date,historical,
    current_state_saved:data.current_state_saved===true,data_complete:data.data_complete===true,
    message:'仅查询光伏原站已保存数据。实测可用小计不等于完整总功率；小时参考单独显示。各站发电量为当日累计读数，未结束日不作为最终日结，缺测不补零。',
    metrics:[metric('energy','全站当日累计',data.total_day_energy_kwh,'kWh'),metric('power_strict','完整总功率',data.total_current_power_kw,'kW'),metric('power_available','可用功率小计',data.available_current_power_kw,'kW'),metric('stations','电站',stations.length,'站')],
    points,station_energy:energy,
    rows:energy.map(s=>({id:s.station_code,title:s.name,body:s.value===null?'发电量缺测':s.stale?'读数过期':'当日累计读数',fields:[{label:'当日累计 kWh',value:s.value===null?'未知':String(s.value)},{label:'测量时间',value:s.updated_at??'未知'}]}))};
}
