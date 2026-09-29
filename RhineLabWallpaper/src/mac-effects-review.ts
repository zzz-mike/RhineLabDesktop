import { ArchiveScene } from './scene';
import { qualityPresets, type RenderQuality } from './render-quality';
import { performanceMarkup } from './mac-performance';

const view = document.querySelector<HTMLElement>('#view')!;
const report = document.querySelector<HTMLElement>('#report')!;
const status = document.querySelector<HTMLElement>('#status')!;
document.querySelector('#plugins')!.innerHTML = performanceMarkup();
const errors: string[] = [];
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
function plugin(key: string, value: boolean) {
  const input = document.querySelector<HTMLInputElement>(`[data-mac-plugin="${key}"]`)!;
  input.checked = value; input.dispatchEvent(new Event('change', { bubbles: true }));
}
plugin('lowLoad', false);
const scene = new ArchiveScene(view);
scene.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
};
let quality: RenderQuality = { ...qualityPresets.original, pixelRatio: 1 };
scene.setQuality(quality);
await scene.load(); scene.setMode('archive'); scene.revealImmediately();
let playing = false, disposed = false, dark = false, time = 100, last = 0, stopAt = 0, started = 0;
let samples: { cpu: number; calls: number; triangles: number }[] = [];
let label = 'optimized';
const history: unknown[] = [];
const gl = scene.renderer.getContext() as WebGL2RenderingContext;
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
let pending: WebGLQuery[] = [], gpuSamples: number[] = [];
function metrics() {
  const median = (xs: number[]) => xs.length ? [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)] : null;
  return { label, hidden: document.hidden, warmupMs: 2000, samples: samples.length, errors: [...errors], resolution: JSON.parse(view.dataset.renderQuality || '{}'),
    cpuMedianMs: median(samples.map(s=>s.cpu)), calls: median(samples.map(s=>s.calls)), triangles: median(samples.map(s=>s.triangles)),
    gpuTimerAvailable: !!timer, gpuMedianMs: median(gpuSamples), stats: scene.getStats() };
}
function finish() {
  if (!playing) return;
  playing = false; const result = metrics(); history.push(result);
  report.textContent = JSON.stringify({ latest: result, history: history.map(x => { const r=x as any; return { label:r.label, mode:r.stats.cameraDetail, resolution:r.resolution, hidden:r.hidden, warmupMs:r.warmupMs, samples:r.samples, calls:r.calls, triangles:r.triangles, cpuMedianMs:r.cpuMedianMs, gpuMedianMs:r.gpuMedianMs, errors:r.errors }; }) }, null, 2);
  status.textContent = '已暂停';
  void fetch('/__mac_effects_results',{method:'POST',headers:{'Content-Type':'application/json'},body:report.textContent}).catch(()=>{});
}
function run() {
  if (disposed) return;
  if (playing) finish();
  samples = []; gpuSamples = []; pending.forEach(q=>gl.deleteQuery(q)); pending=[];
  playing = true; last = 0; started=performance.now();stopAt = started + 6000; status.textContent='运行中（6 秒自动暂停）';
}
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!playing || disposed) return;
  if (document.hidden || now >= stopAt) { finish(); return; }
  if (now - last < 32) return;
  last = now; time = now/1000;
  if (timer) {
    while (pending.length && gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)) {
      const q=pending.shift()!;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuSamples.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
      gl.deleteQuery(q);
    }
  }
  const measuring = now - started >= 2000;
  const query = measuring && timer && pending.length < 8 ? gl.createQuery() : null;
  if(query) gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
  const start=performance.now(); scene.update(time);
  const cpu=performance.now()-start;
  if(query) {gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push(query);}
  const stats=scene.getStats(); if(measuring) samples.push({cpu,calls:stats.drawCalls,triangles:stats.triangles});
}
document.querySelector('#optimized')!.addEventListener('click',()=>{plugin('projectedShadows',true);plugin('lightweightDof',true);scene.resize();label='optimized';run();});
document.querySelector('#original')!.addEventListener('click',()=>{plugin('projectedShadows',false);plugin('lightweightDof',false);scene.resize();label='original';run();});
document.querySelector('#archive')!.addEventListener('click',()=>{scene.setMode('archive');run();});
document.querySelector('#detail')!.addEventListener('click',()=>{scene.setMode('detail');run();});
document.querySelector('#dark')!.addEventListener('click',()=>{dark=!dark;scene.setTheme(dark);run();});
document.querySelector('#fallback')!.addEventListener('click',()=>{quality={...quality,aoSamples:quality.aoSamples?0:32};scene.setQuality(quality);run();});
document.querySelector('#half')!.addEventListener('click',()=>{quality={...quality,aoResolution:quality.aoResolution===1?.5:1};scene.setQuality(quality);run();});
document.querySelector('#pause')!.addEventListener('click',finish);
document.querySelector('#release')!.addEventListener('click',()=>{finish();scene.dispose();disposed=true;status.textContent='三维已释放';});
status.textContent='就绪，点击运行';
requestAnimationFrame(frame);
