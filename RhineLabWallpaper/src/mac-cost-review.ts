// Isolated diagnostic entry; not imported by the application or production build.
import {ArchiveScene} from './scene';
import {qualityPresets} from './render-quality';
import {performanceMarkup} from './mac-performance';
const view=document.querySelector<HTMLElement>('#view')!;
const status=document.querySelector<HTMLElement>('#status')!;
const report=document.querySelector<HTMLElement>('#report')!;
const startButton=document.querySelector<HTMLButtonElement>('#start')!;
document.querySelector('#plugins')!.innerHTML=performanceMarkup();
for(const input of document.querySelectorAll<HTMLInputElement>('[data-mac-plugin]')){
 input.checked=input.dataset.macPlugin!=='lowLoad';input.dispatchEvent(new Event('change',{bubbles:true}));
}
const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const archive=new ArchiveScene(view);
const s=archive as any; // Access private TS members only in this diagnostic entry.
archive.setQuality({...qualityPresets.original,pixelRatio:1});
await archive.load();archive.setMode('archive');archive.revealImmediately();
// Settle transforms without submitting hundreds of warmup renders.
const originalRender=s.composer.render.bind(s.composer);
s.composer.render=()=>{};
for(let i=0;i<240;i++)archive.update(100+i/60);
s.composer.render=originalRender;
const baseStats=archive.getStats();
const gl=archive.renderer.getContext() as WebGL2RenderingContext;
const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
archive.renderer.debug.onShaderError=(g,p,v,f)=>errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].join('\n'));
type Run={name:string;round:number;frames:any[];gpu:Record<string,number[]>;stats:any;startSensor:any;endSensor?:any;disjoint:number};
const runs:Run[]=[];
let run:Run|null=null,active=false,disposed=false,scope=false,measuring=false,sensor:any=null,polled=0;
let pending:{query:WebGLQuery;run:Run;name:string}[]=[];
let stopReason='',startedAt=0;
const matTrans=new Map<any,number>();
s.scene.traverse((o:any)=>{if(o.isMesh){const m=o.material;if(m.transmission>0)matTrans.set(m,m.transmission);}});
const originalVisible=new Map<any,boolean>();
s.scene.traverse((o:any)=>originalVisible.set(o,o.visible));
function pollQueries(){
 if(!timer)return;
 if(gl.getParameter(timer.GPU_DISJOINT_EXT)){
  for(const item of pending){item.run.disjoint++;gl.deleteQuery(item.query);}pending=[];return;
 }
 while(pending.length&&gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
  const item=pending.shift()!;
  (item.run.gpu[item.name]??=[]).push(gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(item.query);
 }
}
function timed(name:string,fn:()=>any){
 if(!measuring||!run||!timer)return fn();
 const query=gl.createQuery()!;gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
 try{return fn();}finally{gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,run,name});}
}
function wrap(object:any,key:string,name:string|((...args:any[])=>string)){
 const fn=object[key].bind(object);
 object[key]=(...args:any[])=>scope?timed(typeof name==='string'?name:name(...args),()=>fn(...args)):fn(...args);
}
wrap(s.composer.passes[0],'render','colorAndTransmission');
wrap(s.ao,'_renderOverride','normalDepth');
wrap(s.ao,'_renderPass',(_r:any,material:any)=>material===s.ao.ssaoMaterial?'aoEvaluation':material===s.ao.blurMaterial?'aoBlur':'aoComposite');
wrap(s.bokeh,'render','dof');
wrap(s.composer.passes.at(-1),'render','output');
function med(a:number[]){if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length%2?b[i]:(b[i-1]+b[i])/2;}
function summary(){return {date:new Date().toISOString(),completed:stopReason==='完成',stopReason,errors,
 browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
 drawingBuffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight},baseStats,
 settings:JSON.parse(view.dataset.renderQuality||'{}'),cadenceFps:15,fixedAnimationTime:104,
 note:'GPU timer queries. Component omissions are marginal differences, not additive shares. Not a thermal or 60 FPS validation.',
 runs:runs.map(r=>({...r,medians:Object.fromEntries(Object.entries(r.gpu).map(([k,v])=>[k,med(v)]))}))};}
async function save(){const data=summary();report.textContent=JSON.stringify(data,null,2);await fetch('/__cost/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function dispose(){if(disposed)return;disposed=true;archive.dispose();}
function stop(reason:string){active=false;stopReason=reason;status.textContent=reason+'；三维已停止';void save().finally(dispose);}
document.querySelector('#stop')!.addEventListener('click',()=>stop('手动停止'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop('页面进入后台，中止');});
async function telemetry(){
 try{const data=await(await fetch('/__cost/state',{cache:'no-store',signal:AbortSignal.timeout(1800)})).json();sensor=data.sensor;polled=performance.now();
  if(active&&(!sensor||Date.now()-sensor.timeMs>3500||sensor.cpuMaxC>=72))stop('温度保护或读数过期');
 }catch{if(active)stop('温度采集失联');}
}
await telemetry();
const pollId=setInterval(()=>{if(disposed){clearInterval(pollId);return;}void telemetry();if(active&&performance.now()-polled>3500)stop('温度采集失联');},500);
function nextFrame(){return new Promise<number>(resolve=>requestAnimationFrame(resolve));}
async function frame(){
 let now=await nextFrame();while(active&&now-lastFrame<1000/15)now=await nextFrame();lastFrame=now;
 if(!active)throw Error('stopped');
 if(now-startedAt>110000){stop('达到短测时限');throw Error('stopped');}
 pollQueries();archive.renderer.info.reset();
 const begin=performance.now();
 if(scope)s.composer.render();else timed('total',()=>s.composer.render());
 if(measuring)run!.frames.push({cpuSubmitMs:performance.now()-begin,calls:archive.renderer.info.render.calls,triangles:archive.renderer.info.render.triangles});
}
let lastFrame=0;
async function configure(name:string){
 for(const [o,v] of originalVisible)o.visible=v;
 for(const [m,t] of matTrans){if(m.transmission!==t){m.transmission=t;m.needsUpdate=true;}}
 s.ao.enabled=true;s.bokeh.enabled=true;
 await archive.setModelPrecision(name==='medium'?'medium':'high');
 const omit:Record<string,string[]>={noScrews:['Titanium_Fasteners'],noEdges:['Ivory_Edges'],noCover:['Frosted_Polymer'],noSmall:['Optical_Diffuser','Index_Inlay']};
 if(omit[name])for(const object of s.instances)if(omit[name].includes(object.userData.surface??object.material.name.replace(/\.\d+$/,'')))object.visible=false;
 if(name==='noSelected')s.model.visible=false;
 if(name==='noShadows')s.projectedShadows.group.visible=false;
 if(name==='noAO')s.ao.enabled=false;
 if(name==='noDOF')s.bokeh.enabled=false;
 if(name==='noTransmission')for(const m of matTrans.keys()){m.transmission=0;m.needsUpdate=true;}
 scope=name==='passes';s.scene.updateMatrixWorld(true);
}
async function block(name:string,round:number){
 await configure(name);
 run={name,round,frames:[],gpu:{},stats:null,startSensor:sensor,disjoint:0};runs.push(run);
 status.textContent=`阵列短测 ${runs.length}：${name}；当前最高传感器 ${sensor?.cpuMaxC?.toFixed(1)}℃`;
 measuring=false;for(let i=0;i<8;i++)await frame();
 measuring=true;for(let i=0;i<24;i++)await frame();measuring=false;
 for(let i=0;i<15&&pending.length;i++){await nextFrame();pollQueries();}
 run.stats=archive.getStats();run.endSensor=sensor;await save();
}
startButton.disabled=!timer;
status.textContent=timer?'已就绪；仅阵列画面，最多约 1 分钟':'此浏览器不支持 GPU 计时，未开始';
startButton.onclick=async()=>{
 if(active||disposed)return;
 await telemetry();if(!sensor||sensor.cpuMaxC>=72||Date.now()-sensor.timeMs>3500){status.textContent='当前温度不适合开始，保持暂停';return;}
 active=true;startedAt=performance.now();startButton.disabled=true;
 try{
  await block('baseline',0);await block('passes',0);await block('baseline',1);
  const names=['noScrews','noEdges','noCover','noSmall','noSelected','noShadows','noAO','noDOF','noTransmission','medium'];
  for(let i=0;i<names.length;i++){await block(names[i],0);await block('baseline',i+2);}
  stop('完成');
 }catch(e){if(active){errors.push(String(e));stop('测量异常');}}
};
