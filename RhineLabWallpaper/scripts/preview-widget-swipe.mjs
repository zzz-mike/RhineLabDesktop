// Isolated read-only fixture. Wheel replay buttons exist only on this QA page.
import http from "node:http";
import { build } from "esbuild";
const ids = [
  "priorities",
  "projects",
  "today",
  "schedule",
  "solar.generation",
  "solar.trend",
  "solar.devices",
  "solar.alerts",
  "solar.revenue",
];
const source = `import {InformationWidgets} from './src/information-widgets';
localStorage.setItem('rhine-information-layout-v2',JSON.stringify({schema_version:2,widgets:['priorities','projects','today','schedule'].map((widget_id,i)=>({id:'swipe-'+i,widget_id,size:'medium',columns:6,rows:4,limit:5,project_id:null}))}));
let slow=false,fail=false;const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('offset=')&&!String(args[0]).includes('offset=0')){if(slow)await new Promise(r=>setTimeout(r,1800));if(fail){fail=false;return new Response(JSON.stringify({error:'隔离翻页失败',code:'qa_failure'}),{status:502,headers:{'content-type':'application/json'}});}}return original(...args);};
new InformationWidgets(document.querySelector('#app')).setActive(true);
const stats={wheelEvents:[],samples:[],ghostMaximum:0};const out=document.querySelector('#qa-result');const report=()=>out.textContent=JSON.stringify({...stats,pages:[...document.querySelectorAll('.iw-page-number')].map(e=>e.textContent),hints:[...document.querySelectorAll('.iw-page-hint:not([hidden])')].map(e=>e.textContent),ghosts:document.querySelectorAll('.iw-page-ghost').length,scrollY,animated:document.getAnimations().length});
document.querySelector('#slow').onclick=()=>{slow=!slow;document.querySelector('#slow').textContent=slow?'延迟：开':'延迟：关';};document.querySelector('#fail').onclick=()=>{fail=true;};
document.querySelector('#reduce').onclick=()=>{document.querySelector('#app').classList.toggle('reduce-motion');};
document.querySelector('#read').onclick=report;
const first=()=>document.querySelector('.iw-body');const wheel=(x,y=0)=>first().dispatchEvent(new WheelEvent('wheel',{deltaX:x,deltaY:y,bubbles:true,cancelable:true}));
document.querySelector('#short').onclick=()=>{wheel(24);report();};document.querySelector('#inertia').onclick=()=>{[30,30,25,20,16,12,9,7,5,3].forEach((x,i)=>setTimeout(()=>wheel(x),i*18));};
document.querySelector('#previous').onclick=()=>wheel(-65);
document.querySelector('#repeat').onclick=()=>{const values=[24,32,40,36,30,24,18,12,8,5,3,2,1,18,30,38,30,20,12,6,3,1,2,4,7,10,14,18,20,15,9,4,1,...Array(190).fill(.5)];values.forEach((x,i)=>setTimeout(()=>wheel(x),i*16));};
document.addEventListener('wheel',e=>{stats.wheelEvents.push({x:e.deltaX,y:e.deltaY,target:e.target.closest('.iw-card')?.dataset.instanceId??'outside',prevented:e.defaultPrevented});},{capture:true,passive:true});
let scheduled=false;const sample=()=>{scheduled=false;const ghosts=document.querySelectorAll('.iw-page-ghost').length;stats.ghostMaximum=Math.max(stats.ghostMaximum,ghosts);const bodies=[...document.querySelectorAll('.iw-body-viewport[data-page-motion]')];if(bodies.length){stats.samples.push(bodies.map(e=>({phase:e.dataset.pageMotion,transform:getComputedStyle(e.querySelector('.iw-body:not(.iw-page-ghost)')).transform,ghosts:e.querySelectorAll('.iw-page-ghost').length,animations:e.getAnimations({subtree:true}).length})));if(stats.samples.length>150)stats.samples.shift();scheduled=true;requestAnimationFrame(sample);}else report();};
new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(sample);}}).observe(document.querySelector('#app'),{subtree:true,attributes:true,attributeFilter:['data-page-motion']});setTimeout(report,500);
`;
const buildResult = await build({
  stdin: { contents: source, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  outfile: "app.js",
});
const assets = new Map(
  buildResult.outputFiles.map((f) => [
    "/" + f.path.split("/").at(-1),
    f.contents,
  ]),
);
const now = "2026-09-25T10:00:00+08:00",
  items = Array.from({ length: 25 }, (_, i) => ({
    id: "record-" + i,
    title: "隔离事项 " + (i + 1),
    summary: "双指左右切换组件内容，上下滚动页面。",
    project_id: "secretary:qa",
    project_name: "测试项目",
    status: "active",
    source_refs: [],
    source_url: null,
  }));
http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const route = u.pathname.split("/").at(-1);
    const json = (o) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (route === "revision")
      return json({
        schema_version: "1.0",
        revision: "fixed-1",
        poll_seconds: 2,
      });
    if (route === "catalog")
      return json({
        schema_version: "1.0",
        timezone: "Asia/Shanghai",
        widgets: ids.map((id) => ({
          id,
          title: id,
          sizes: ["small", "medium", "large"],
          default_size: "medium",
          refresh_seconds: 60,
        })),
        projects: [
          { id: "secretary:qa", name: "测试项目", source_id: "secretary" },
        ],
      });
    if (ids.includes(route)) {
      const offset = Number(u.searchParams.get("offset") || 0),
        limit = Number(u.searchParams.get("limit") || 2),
        page = items.slice(offset, offset + limit),
        next =
          offset + page.length < items.length ? offset + page.length : null;
      return json({
        schema_version: "1.0",
        widget_id: route,
        title: route,
        status: "ok",
        generated_at: now,
        data_updated_at: now,
        timezone: "Asia/Shanghai",
        message: "只读隔离样本",
        items: page,
        total: items.length,
        truncated: page.length < items.length,
        metrics: [],
        points: [],
        source: { id: "fixture", label: "fixture" },
        snapshot_revision: "fixed-1",
        pagination: {
          offset,
          limit,
          total: items.length,
          next_offset: next,
          has_more: next !== null,
        },
      });
    }
    if (assets.has(u.pathname)) {
      res.setHeader(
        "content-type",
        u.pathname.endsWith(".css") ? "text/css" : "application/javascript",
      );
      return res.end(assets.get(u.pathname));
    }
    res.setHeader("content-type", "text/html;charset=utf-8");
    res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>组件触控板隔离验收</title><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#eeeae3}#qa{position:sticky;top:0;z-index:20;padding:8px;background:white}#qa-result{display:block;font:10px monospace;max-height:70px;overflow:auto}</style><div id="qa"><button id="short">短滑动</button><button id="inertia">连续惯性</button><button id="previous">向前一页</button><button id="repeat">连续三次滑动加三秒惯性</button><button id="slow">延迟：关</button><button id="fail">下一次翻页失败</button><button id="reduce">切换减少动态效果</button><button id="read">读取记录</button><output id="qa-result"></output></div><div id="app"></div><script type="module" src="/app.js"></script>',
    );
  })
  .listen(5199, "127.0.0.1", () =>
    console.log("Isolated swipe QA http://127.0.0.1:5199"),
  );
