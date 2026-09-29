// Local-only performance fixture. Never proxies business data or writes to production.
import http from 'node:http';import {build} from 'esbuild';import {readFile} from 'node:fs/promises';import path from 'node:path';
const assets=new Map();
const instrumentation=`
const variant=new URLSearchParams(location.search).get('variant')||'candidate';
const count=Number(new URLSearchParams(location.search).get('count')||5);
const ids=['priorities','projects','today','schedule','solar.generation'];
localStorage.setItem('rhine-information-layout-v2',JSON.stringify({schema_version:2,widgets:Array.from({length:count},(_,i)=>({id:'fixture-'+i,widget_id:ids[i%5],size:'medium',columns:6,rows:4,project_id:i%5===4?'solar:test:a':null,limit:5}))}));
let stats={variant,count,requests:0,aborts:0,requestMs:[],mainRefreshMs:null,cardChanges:0,addedNodes:0,removedNodes:0,bodyChanges:0,longTasks:[],firstContentMs:null,elapsedMs:0,focusPreserved:null};let start=performance.now();let pendingRequests=0;
const originalFetch=window.fetch;window.fetch=async(...args)=>{const t=performance.now();stats.requests++;pendingRequests++;try{const r=await originalFetch(...args);stats.requestMs.push({path:String(args[0]),ms:+(performance.now()-t).toFixed(2)});return r;}catch(e){if(e.name==='AbortError')stats.aborts++;throw e;}finally{pendingRequests--;}};
try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=start)stats.longTasks.push({start:+(e.startTime-start).toFixed(2),duration:+e.duration.toFixed(2)});}).observe({type:'longtask',buffered:true});}catch{}
new MutationObserver(records=>{for(const r of records){if(r.target.closest?.('.iw-card'))stats.cardChanges++;const body=r.target.closest?.('.iw-body');if(!body)continue;stats.bodyChanges++;for(const n of r.addedNodes)stats.addedNodes+=1+(n.querySelectorAll?.('*').length||0);for(const n of r.removedNodes)stats.removedNodes+=1+(n.querySelectorAll?.('*').length||0);if(stats.firstContentMs===null&&body.querySelector('.iw-summary'))stats.firstContentMs=+(performance.now()-start).toFixed(2);}}).observe(document.querySelector('#app'),{childList:true,subtree:true});
const show=()=>{stats.elapsedMs=+(performance.now()-start).toFixed(2);document.querySelector('#metrics').textContent=JSON.stringify(stats);};
const reset=()=>{stats={variant,count,requests:0,aborts:0,requestMs:[],mainRefreshMs:null,cardChanges:0,addedNodes:0,removedNodes:0,bodyChanges:0,longTasks:[],firstContentMs:null,elapsedMs:0,focusPreserved:null};start=performance.now();};
const app=new InformationWidgets(document.querySelector('#app'));app.setActive(true);
const settled=async()=>{while(pendingRequests)await new Promise(r=>setTimeout(r,20));};
document.querySelector('#measure').onclick=async()=>{await settled();reset();show();const first=document.querySelector('.iw-body button');first?.focus();await app.refresh();stats.mainRefreshMs=+(performance.now()-start).toFixed(2);await settled();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);stats.focusPreserved=document.activeElement===first;show();};
document.querySelector('#stable').onclick=async()=>{await app.refresh();await settled();reset();show();setTimeout(show,30000);};
document.querySelector('#report').onclick=show;
setTimeout(show,2000);
`;
for(const variant of ['baseline','candidate']){
 const result=await build({stdin:{contents:`import {InformationWidgets} from './src/information-widgets';${instrumentation}`,resolveDir:process.cwd()},bundle:true,write:false,outfile:'app.js',plugins:variant==='baseline'?[{name:'baseline',setup(b){b.onLoad({filter:/\/(information-widgets|secretary-client)\.ts$/},async({path:file})=>({contents:await readFile(path.resolve('../backups/20260925-smooth-refresh',path.basename(file)),'utf8'),loader:'ts',resolveDir:path.dirname(file)}));}}]:[]});
 for(const f of result.outputFiles)assets.set(`/${variant}/${path.basename(f.path)}`,f.contents);
}
const items=Array.from({length:125},(_,i)=>({id:'test-'+i,title:'固定样本 '+(i+1),summary:'固定摘要，不连接真实业务。',project_id:'secretary:test',project_name:'隔离项目',status:'active',source_url:null,source_refs:[]}));
const now='2026-09-25T10:00:00+08:00',solar={id:'station',project_id:'solar:test:a',project_name:'固定电站',title:'固定电站',summary:'',status:'ok',source_url:null,source_refs:[],data:{metrics:[{key:'energy',label:'今日发电',value:10,unit:'kWh'}],points:[],items:[],date:'2026-09-25'}};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');const route=u.pathname.split('/').at(-1);const json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
 if(u.pathname.startsWith('/api/')){
  if(route==='revision'){await delay(10);return json({schema_version:'1.0',revision:'fixed-1',poll_seconds:2});}
  if(route==='catalog'){await delay(400);return json({schema_version:'1.0',timezone:'Asia/Shanghai',widgets:['priorities','projects','today','schedule','solar.generation','solar.trend','solar.devices','solar.alerts','solar.revenue'].map(id=>({id,title:id,sizes:['small','medium','large'],default_size:'medium',refresh_seconds:60})),projects:[{id:'secretary:test',name:'隔离项目',source_id:'secretary'},{id:'solar:test:a',name:'固定电站',source_id:'solar-monitor'}]});}
  const isSolar=route.startsWith('solar.');await delay(route==='solar.trend'?800:50);const all=isSolar?[structuredClone(solar)]:items;
  if(route==='solar.trend')all[0].data.points=Array.from({length:160},(_,i)=>({at:new Date(Date.UTC(2026,8,25,0,i)).toISOString(),value:Math.sin(i/30)+2,unit:'kW',series:'power'}));
  const offset=+(u.searchParams.get('offset')||0),limit=+(u.searchParams.get('limit')||1),page=all.slice(offset,offset+limit),next=offset+page.length<all.length?offset+page.length:null;
  return json({schema_version:'1.0',widget_id:route,title:route,status:'ok',generated_at:now,data_updated_at:now,timezone:'Asia/Shanghai',message:'隔离性能夹具',items:page,total:all.length,truncated:all.length>page.length,metrics:[],points:[],source:{id:'fixture',label:'fixture'},snapshot_revision:'fixed-1',pagination:{offset,limit,total:all.length,next_offset:next,has_more:next!==null}});
 }
 if(assets.has(u.pathname)){res.setHeader('content-type',u.pathname.endsWith('.css')?'text/css':'application/javascript');return res.end(assets.get(u.pathname));}
 const variant=u.searchParams.get('variant')==='baseline'?'baseline':'candidate';res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>刷新固定场景测量</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/${variant}/app.css"><style>body{margin:0;background:#eeeae3}#bench{position:sticky;top:0;background:white;z-index:500;padding:8px}#metrics{display:block;white-space:pre-wrap;font-size:11px;max-height:90px;overflow:auto}</style><div id="bench"><button id="measure">测量无变化后台刷新</button><button id="stable">清零并开始稳定轮询测量</button><button id="report">读取测量</button><output id="metrics"></output></div><div id="app"></div><script type="module" src="/${variant}/app.js"></script>`);
}).listen(5198,'127.0.0.1',()=>console.log('Read-only fixed fixture: http://127.0.0.1:5198/?variant=candidate&count=5 (baseline/candidate; 5/24 cards)'));
