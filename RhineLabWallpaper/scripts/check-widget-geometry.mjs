import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'rhine-widget-geometry-'));
try {
  await build({ entryPoints: ['src/widget-layout.ts', 'src/widget-chart.ts'], bundle: true, platform: 'node', format: 'esm', outdir: temp });
  const { capacity, SwipePager } = await import(pathToFileURL(join(temp, 'widget-layout.js')));
  const { buildChartGroups, renderWidgetChart } = await import(pathToFileURL(join(temp, 'widget-chart.js')));
  assert.deepEqual(capacity(200, 180, 100), { count: 1, columns: 1, density: 'compact' });
  assert.equal(capacity(700, 800, 100).density, 'comfortable');
  assert.ok(capacity(700, 800, 100).count > capacity(700, 340, 100).count);
  assert.equal(capacity(700, 800, 100, true).count, 1);
  assert.equal(capacity(700, 340, 100).columns, 2);
  assert.equal(capacity(1000, 340, 100).columns, 3);
  assert.equal(capacity(550, 340, 100).columns, 1);
  assert.ok(capacity(1000, 340, 100).count > capacity(550, 340, 100).count);
  assert.equal(capacity(700, 800, 2).count, 2);
  assert.deepEqual(capacity(NaN, Infinity, NaN), { count: 1, columns: 1, density: 'compact' });
  const swipe = new SwipePager();
  assert.deepEqual(swipe.wheel(5, 30, 0), { consume: false, step: 0 });
  assert.deepEqual(swipe.wheel(60, 0, 10), { consume: false, step: 0 }, 'vertical session remains native');
  assert.deepEqual(swipe.wheel(30, 1, 210), { consume: true, step: 0 });
  assert.deepEqual(swipe.wheel(30, 1, 220), { consume: true, step: 1 });
  assert.deepEqual(swipe.wheel(-120, 0, 230), { consume: true, step: 0 }, 'inertia cannot flip repeatedly');
  assert.deepEqual(swipe.wheel(-60, 0, 430), { consume: true, step: -1 });
  assert.equal(swipe.wheel(0, 5, 600, 1).consume, false);
  const point = (minute, value, unit='kW', series='甲') => ({ at: `2026-09-25T08:${String(minute).padStart(2,'0')}:00+08:00`, value, unit, series });
  const points = [point(0, 2), point(1, null), point(2, 5), point(1, 0, 'kWh'), point(0, 9, 'kW', '乙'), { at:null, value:4, unit:'kW' }];
  const groups = buildChartGroups(points);
  assert.equal(groups.length, 2, 'units have separate axes');
  assert.equal(groups[0].series.length, 2);
  assert.equal(groups[0].series[0].segments.length, 2, 'null breaks line');
  assert.equal(groups[0].series[0].gaps, 1);
  assert.equal(groups[0].unknownDates, 1);
  assert.equal(groups[1].series[0].segments[0][0].value, 0, 'real zero is retained');
  class Node {
    children=[]; attributes={}; style={}; textContent=''; className='';
    classList={ add: () => {} }; ownerDocument=doc;
    constructor(tag) { this.tag=tag; }
    setAttribute(k,v) { this.attributes[k]=v; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
  }
  const doc = { createElement: tag => new Node(tag), createElementNS: (_,tag) => new Node(tag) };
  const root = new Node('div');
  renderWidgetChart(root, [...points,point(3,3,'kW','<script>alert(1)</script>')]);
  const all = node => [node,...node.children.flatMap(all)];
  assert.equal(all(root).filter(n=>n.tag==='svg').length,2);
  assert.equal(all(root).filter(n=>n.tag==='script').length,0);
  assert.ok(all(root).some(n=>n.textContent.includes('<script>')), 'untrusted series remains literal text');
  renderWidgetChart(root, []);
  assert.ok(all(root).some(n=>n.textContent.includes('暂无实际曲线')));
  renderWidgetChart(root, [point(0,null)]);
  assert.equal(all(root).filter(n=>n.tag==='svg').length,0);
  assert.ok(all(root).some(n=>n.textContent.includes('缺测')));
  renderWidgetChart(root,[{at:'2026-08',value:3,unit:'kWh'},{at:'2026-09',value:5,unit:'kWh'}]);
  assert.ok(all(root).some(n=>n.textContent.includes('2026-08—2026-09 · 月份统计')),'month labels do not fabricate first-day measurements');
  assert.ok(!all(root).some(n=>n.textContent.includes('08/01')),'month footer must not imply a day or time');
  console.log('PASS: measured capacity, gesture lock/session/boundary consumption, separated units/series, null gaps, real zero, unknown dates, DOM text safety and empty states');
} finally { await rm(temp,{recursive:true,force:true}); }
