import { modernUI } from './release-access';
import { manualDisplayQuality, normalizeMacDisplay } from './mac-pixel-budget';
import type { RenderQuality } from './render-quality';
import { normalizeShadowMode } from './mac-shadow-mode';
type Plugin = 'diagnostics' | 'reuseWork' | 'staticViewer' | 'lowLoad' | 'projectedShadows' | 'lightweightDof' | 'simpleArray';
const defaults: Record<Plugin, boolean> = { diagnostics: true, reuseWork: true, staticViewer: true, lowLoad: true, projectedShadows: true, lightweightDof: true, simpleArray: true };
const active = modernUI;
export const macPerformanceEnabled = active;
let shadowMode = normalizeShadowMode(null);
try { shadowMode = normalizeShadowMode(localStorage.getItem('rhine-mac-shadows')); } catch {}
export const macShadowMode = () => active ? shadowMode : null;
function shadowMarkup() {
  return `<section class="wb-settings" aria-label="阴影设置"><strong>阴影设置</strong><label style="display:block;padding:8px 0">阴影模式 <select data-mac-shadow-mode aria-label="阴影模式">${([['off','全部关闭'],['original','保留原版'],['texture','贴图版']] as const).map(([value,label])=>`<option value="${value}" ${value === shadowMode ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p>即时生效并自动保存。全部关闭会同时停用实时投影、贴图投影和环境遮蔽（AO）暗部；材质自身明暗仍保留。保留原版恢复实时投影和 AO，开销较高；贴图版使用预制柔影，按相邻文件实际高度同步，替代 AO，属于近似效果。</p></section>`;
}
if (active) document.addEventListener('change', event => {
  const input = event.target as HTMLSelectElement;
  if (!input.hasAttribute('data-mac-shadow-mode')) return;
  shadowMode = normalizeShadowMode(input.value);
  try { localStorage.setItem('rhine-mac-shadows', shadowMode); } catch {}
  window.dispatchEvent(new Event('rhine-mac-performance-change'));
});
let display = normalizeMacDisplay(null);
try { display = normalizeMacDisplay(JSON.parse(localStorage.getItem('rhine-mac-display') || 'null')); } catch {}
export const macDisplaySettings = () => active ? display : null;
export const macRenderQuality = (quality: RenderQuality) => manualDisplayQuality(quality, macDisplaySettings(), devicePixelRatio);
function displayMarkup() {
  const manual = display.scale !== null;
  return `<section class="wb-settings" aria-label="分辨率与抗锯齿"><strong>分辨率与抗锯齿</strong>
    <label style="display:block;padding:8px 0">分辨率模式 <select data-mac-display="mode" aria-label="分辨率模式"><option value="auto" ${manual ? '' : 'selected'}>沿用原有画质／省电设置</option><option value="manual" ${manual ? 'selected' : ''}>手动调节</option></select></label>
    <label style="display:block;padding:8px 0">三维渲染比例 <input type="range" min="50" max="150" step="5" value="${display.scale ?? 100}" data-mac-display="scale" aria-label="三维渲染比例" ${manual ? '' : 'disabled'}> <output data-mac-display-output>${display.scale ?? 100}%</output></label>
    <label style="display:block;padding:8px 0"><input type="checkbox" data-mac-display="antialias" ${display.antialias ? 'checked' : ''} ${manual ? '' : 'disabled'}>抗锯齿（SMAA，平滑边缘）</label>
    <p id="mac-resolution-summary" aria-live="polite"></p><p>100% 按当前屏幕像素绘制；超过 100% 更细腻，也更费性能。手动模式优先于低负载和超级性能的分辨率限制，松开滑块生效并自动保存。文字保持清晰；磨砂玻璃和景深的虚化仍保留。</p></section>`;
}
function syncDisplayUI() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-mac-display]').forEach(input => {
    const key = input.dataset.macDisplay;
    if (key === 'mode') input.value = display.scale === null ? 'auto' : 'manual';
    else { input.disabled = display.scale === null;
      if (key === 'scale') input.value = String(display.scale ?? 100);
      else (input as HTMLInputElement).checked = display.antialias;
    }
  });
  const output = document.querySelector('output[data-mac-display-output]');
  if (output) output.textContent = `${display.scale ?? 100}%`;
  const low = document.querySelector<HTMLInputElement>('[data-mac-plugin="lowLoad"]');
  if (low) { low.disabled = display.scale !== null; low.title = display.scale !== null ? '手动分辨率已优先生效' : ''; }
}
if (active) document.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.macDisplay === 'scale') {
    const output = document.querySelector('output[data-mac-display-output]');
    if (output) output.textContent = `${input.value}%`;
  }
});
if (active) document.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const key = input.dataset.macDisplay;
  if (!key) return;
  display = normalizeMacDisplay({ ...display,
    ...(key === 'mode' ? { scale: input.value === 'manual' ? display.scale ?? 100 : null } : {}),
    ...(key === 'scale' ? { scale: Number(input.value) } : {}),
    ...(key === 'antialias' ? { antialias: input.checked } : {}),
  });
  try { localStorage.setItem('rhine-mac-display', JSON.stringify(display)); } catch {}
  syncDisplayUI();
  window.dispatchEvent(new Event('rhine-mac-performance-change'));
});
let settings = { ...defaults };
try { const saved = JSON.parse(localStorage.getItem('rhine-mac-performance') || '{}'); for (const key of Object.keys(defaults) as Plugin[]) if (typeof saved[key] === 'boolean') settings[key] = saved[key]; } catch {}
const samples: { ms: number; mode: string }[] = [];
let rendered = 0, reused = 0;
export const performancePlugin = (key: Plugin) => active && settings[key];
export function recordFrame(ms: number, mode: string) {
  if (!performancePlugin('diagnostics')) return;
  samples.push({ ms, mode }); if (samples.length > 600) samples.shift();
}
export function recordViewer(reuse: boolean) { if (performancePlugin('diagnostics')) reuse ? reused++ : rendered++; }
export function performanceMarkup() {
  if (!active) return '';
  return `${displayMarkup()}${shadowMarkup()}<section class="wb-settings"><strong>MAC 性能优化</strong><p>保留呼吸、漂浮和原有动画速度。背景可改用贴图盖板；所有文件的固定件均为无槽圆柱，选中文档保留玻璃与内构。贴图阴影近似地面投影与文件间暗部，轻量景深保留远近虚实。</p>${(Object.entries({ simpleArray: '简化背景文件（贴图盖板、低面数圆柱）', lightweightDof: '轻量景深（低分辨率模糊）', lowLoad: '低负载三维（手动分辨率优先）', diagnostics: '性能记录', reuseWork: '减少重复计算与对象分配', staticViewer: '查看器静帧复用' }) as [Plugin,string][]).map(([key,label]) => `<label style="display:block;padding:6px 0"><input type="checkbox" data-mac-plugin="${key}" ${settings[key] ? 'checked' : ''} ${key === 'lowLoad' && display.scale !== null ? 'disabled' : ''}> ${label}</label>`).join('')}<button type="button" data-mac-performance="reset">关闭性能优化（负载较高）</button> <button type="button" data-mac-performance="export">导出本次性能记录</button><p>记录的是主线程更新及提交绘制耗时，不是 GPU 时间或温度。开关即时生效；关闭优化仍保留圆柱固定件、手动分辨率和所选阴影模式。</p></section>`;
}
if (active) document.addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const key = input.dataset.macPlugin as Plugin;
  if (!Object.hasOwn(defaults, key)) return;
  samples.length = 0; rendered = 0; reused = 0;
  settings[key] = input.checked; localStorage.setItem('rhine-mac-performance', JSON.stringify(settings));
  window.dispatchEvent(new Event('rhine-mac-performance-change'));
});
if (active) document.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-mac-performance]')?.dataset.macPerformance;
  if (action === 'reset') {
    samples.length = 0; rendered = 0; reused = 0;
    for (const key of Object.keys(defaults) as Plugin[]) settings[key] = false;
    localStorage.setItem('rhine-mac-performance', JSON.stringify(settings));
    document.querySelectorAll<HTMLInputElement>('[data-mac-plugin]').forEach(input => input.checked = false);
    window.dispatchEvent(new Event('rhine-mac-performance-change'));
  }
  if (action === 'export') {
    const payload = { date: new Date().toISOString(), settings, display, shadowMode, viewer: { rendered, reused }, note: 'CPU update + rendering submission milliseconds, not GPU time; latest 600 admitted frames', samples };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], { type:'application/json' }));
    const link = document.createElement('a'); link.href=url; link.download='rhine-performance.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
