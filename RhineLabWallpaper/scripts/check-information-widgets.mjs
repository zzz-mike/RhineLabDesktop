// Isolated contract and DOM checks. Does not build, modify real data or restart services.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the real module graph, including chart/layout helpers. No browser or real network.
const output = await build({ stdin: { contents: `export * as client from './src/secretary-client'; export * from './src/information-widgets';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' } });
const { client, InformationWidgets, parseInformationLayout, defaultInformationLayout, informationLayoutKey } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const now = '2026-09-24T20:00:00+08:00';
const sampleItem = (id = 'record-a', project = 'secretary:a') => ({ id, project_id: project, project_name: null, title: '项目 <img src=x onerror="window.injected=true">', summary: '真实摘要 <script>window.injected=true</script>', status: 'active', group: 'active', occurred_at: null, updated_at: now, due_at: '2026-09-24T20:30+08:00', all_day: false, source_url: 'http://127.0.0.1:8866/?item=record-a', source_refs: ['source-a'] });
const envelope = (id, items = [sampleItem()]) => ({ schema_version: '1.0', widget_id: id, title: client.widgetTitles[id], status: items.length ? 'ok' : 'empty', generated_at: now, data_updated_at: now, timezone: 'Asia/Shanghai', message: '只展示已接收记录，不代表所有来源。', items, metrics: [], points: [], total: items.length, truncated: false, source: { id: 'secretary', label: 'AI秘书长' }, coverage: { scope: '测试来源范围' } });
const catalog = { schema_version: '1.0', timezone: 'Asia/Shanghai', widgets: client.widgetIds.map(id => ({ id, title: client.widgetTitles[id], sizes: ['small', 'medium', 'large'], default_size: 'medium', refresh_seconds: 60 })), projects: [{ id: 'secretary:a', name: '项目 A', source_id: 'secretary' }, { id: 'secretary:b', name: '项目 B', source_id: 'secretary' }, { id: 'solar:a', name: '电站 A', source_id: 'solar-monitor' }, { id: 'solar:b', name: '电站 B', source_id: 'solar-monitor' }] };

check(client.parseCatalog(catalog).widgets.length === 13, 'twelve offered themes and one legacy mixed view');
check(client.parseWidget(envelope('today'), 'today').items[0].project_name === undefined, 'nullable project_name');
check(client.parseWidget(envelope('projects', [{ ...sampleItem(), evidence_at: '2026-08-19' }]), 'projects').items[0].evidence_at === '2026-08-19', 'date-only evidence preserved');
check(client.formatSourceDate('2026-09-23T16:05:00Z').includes('09/24'), 'Shanghai UTC boundary');
check(client.formatSourceDate('2026-09-24', true).includes('全天'), 'all-day explicit');
check(client.formatSourceDate('2026-09-24').includes('日期级'), 'evidence date not fabricated time');
check(client.formatSourceDate('2026-02-30') === '时间未知', 'invalid dates not normalized');
check(client.formatMetric(null, 'kWh') === '未知 kWh' && client.formatMetric(0, 'kWh') === '0 kWh', 'unknown is not zero');
for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///Desktop/a', '//127.0.0.1:8866/', 'http://127.0.0.1:8866/x/../', 'http://user@127.0.0.1:8866/', 'http://127.0.0.1:8866/?url=http://evil', 'http://127.0.0.1:8866/%2e%2e/', 'http://127.0.0.1:8866/\\evil', 'https://127.0.0.1:8866/', 'http://127.0.0.1:8765/api/device', 'http://127.0.0.1:8866/?item=a&item=b']) check(client.safeDetailUrl(url) === null, `unsafe URL ${url}`);
check(Boolean(client.safeDetailUrl('http://127.0.0.1:8866/?project=%E9%A1%B9%E7%9B%AE')), 'allowed project deep link');
check(Boolean(client.safeDetailUrl('http://127.0.0.1:8765/station?code=a%2Fb')), 'opaque station code');
for (const change of [{ schema_version: '2' }, { widget_id: 'schedule' }, { status: 'healthy' }, { items: null }, { total: 0 }, { truncated: true }, { generated_at: null }, { data_updated_at: '2026-09-24T20:00' }]) { assert.throws(() => client.parseWidget({ ...envelope('today'), ...change }, 'today')); checks++; }
assert.throws(() => client.parseWidget({ ...envelope('today'), metrics: [{ key: 'x', label: 'x', value: '0', unit: 'kW' }] }, 'today')); checks++;
const dirty = client.parseWidget(envelope('today', [{ ...sampleItem(), source_url: 'javascript:alert(1)', credential: 'DO NOT KEEP' }]), 'today');
check(dirty.items[0].source_url === null && !('credential' in dirty.items[0]), 'unsafe URL and unknown field stripped');
const layout = defaultInformationLayout();
check(parseInformationLayout(layout)?.widgets.length === 5, 'default layout includes separate todo and triage');
check(parseInformationLayout({ schema_version: 1, widgets: [] })?.widgets.length === 0, 'intentional empty layout');
for (const change of [{ widget_id: 'unknown' }, { size: 'enormous' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { project_id: '' }, { project_id: 'a'.repeat(241) }, { id: '<script>' }]) { check(parseInformationLayout({ schema_version: 1, widgets: [{ ...layout.widgets[0], ...change }] }) === null, 'corrupt configuration rejected'); }
check(parseInformationLayout({ schema_version: 1, widgets: [layout.widgets[0], layout.widgets[0]] }) === null, 'duplicate instance rejected');
check(!JSON.stringify(parseInformationLayout({ ...layout, token: 'secret', widgets: [{ ...layout.widgets[0], response: envelope('today') }] })).includes('secret'), 'storage only config');

const migrated = parseInformationLayout(layout);
check(migrated.schema_version === 2 && migrated.widgets.map(w => w.id).join() === layout.widgets.map(w => w.id).join(), 'v1 migrates to v2 preserving IDs/order');
check(migrated.widgets[0].columns === 6 && migrated.widgets[0].rows === 4 && migrated.widgets.find(w => w.widget_id === 'today').columns === 4, 'legacy dimensions map to real column and row spans');
check(informationLayoutKey === 'rhine-information-layout-v2', 'v2 separate persistence key');
const custom = { schema_version: 2, widgets: [{ ...layout.widgets[0], columns: 8, rows: 6, project_id: 'secretary:b', limit: 23 }] };
check(JSON.stringify(parseInformationLayout(custom)) === JSON.stringify(custom), 'custom columns rows filter and limit persist');
for (const dimensions of [{columns: 3}, {columns: 13}, {columns: 5.5}, {columns: '6'}, {rows: 2}, {rows: 9}, {rows: 3.5}]) check(parseInformationLayout({schema_version: 2, widgets:[{...layout.widgets[0], ...dimensions}]}) === null, 'invalid grid dimensions rejected');

const nativeFetch = globalThis.fetch; let requested;
try {
  globalThis.fetch = async (url, options) => { requested = { url, options }; return new Response(JSON.stringify(envelope('today')), { headers: { 'content-type': 'application/json' } }); };
  await client.getWidget('today', { project_id: 'secretary:a', limit: 3 });
  check(requested.url === '/api/secretary/widgets/v1/today?limit=3&project_id=secretary%3Aa', 'fixed proxy query');
  check(requested.options.headers['X-Rhine-Local'] === '1' && requested.options.redirect === 'error', 'local header and no redirects');
  await assert.rejects(client.getWidget('today', { limit: 101 })); checks++;
  globalThis.fetch = async () => new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } });
  await assert.rejects(client.getWidget('today'), /HTTP 502/); checks++;
  globalThis.fetch = async () => new Response('not JSON', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(client.getWidget('today')); checks++;
  globalThis.fetch = async () => new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(client.getWidget('today'), /响应过大/); checks++;
} finally { globalThis.fetch = nativeFetch; }

// Exercise the actual asynchronous card loader, with only its DOM rendering seams
// replaced. Real rendering, gesture dispatch and conflict-input behavior are browser QA.
const previousDocument = globalThis.document;
const pagingFetch = globalThis.fetch;
globalThis.document = { hidden: false };
try {
  const host = Object.create(InformationWidgets.prototype);
  const card = { placement: {...layout.widgets[0], widget_id: 'today'}, loading: false, revision: 0, offset: 0, pageSize: 17, density: 'compact', pageNotice: '' };
  Object.assign(host, { active: true, destroyed: false, editing: false, cards: new Map([[card.placement.id, card]]), renderStatus() {}, renderCard() {} });
  const rows = Array.from({length:125},(_,i)=>sampleItem(`record-${i}`));
  let snapshot = 'snapshot-a', requests = [], forceConflict = false;
  globalThis.fetch = async (path, options) => {
    const url = new URL(path,'http://test.local'); const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit'));
    requests.push({offset,limit,snapshot:url.searchParams.get('snapshot_revision')});
    const respond = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    if (forceConflict || (url.searchParams.has('snapshot_revision') && url.searchParams.get('snapshot_revision') !== snapshot)) {forceConflict=false;return respond({error:'快照已更新',code:'snapshot_changed'},409);}
    const items = rows.slice(offset,offset+limit); const next = offset+items.length<rows.length?offset+items.length:null;
    return respond({...envelope('today',items),total:rows.length,truncated:rows.length>items.length,snapshot_revision:snapshot,pagination:{offset,limit,total:rows.length,next_offset:next,has_more:next!==null}});
  };
  const seen=[];
  await host.load(card);
  while(true) {
    seen.push(...card.response.items.map(i=>i.id));
    if (!card.response.pagination.has_more) break;
    host.turn(card,1);
    while(card.loading) await new Promise(resolve=>setImmediate(resolve));
  }
  check(seen.length===125 && new Set(seen).size===125 && seen.every((id,i)=>id===`record-${i}`),'125 records across actual card next-page loads without omission or duplicate');
  check(requests[0].snapshot===null && requests.slice(1).every(r=>r.snapshot==='snapshot-a'),'next pages retain first-page snapshot');
  check(requests.map(r=>r.offset).join() === '0,17,34,51,68,85,102,119','all page offsets contiguous, including short final page');
  const before = requests.length; host.turn(card,1);
  check(requests.length===before && card.offset===119,'last page does not request or advance');
  snapshot='snapshot-b'; await host.load(card,true);
  check(card.offset===119 && card.snapshot==='snapshot-b' && requests.at(-1).snapshot===null,'fresh content preserves current page and requests a new snapshot');
  forceConflict=true;await host.load(card);
  check(card.offset===0 && card.response.items[0].id==='record-0' && card.pageNotice.includes('第一页'),'409 resets actual card loader to first page');
  check(requests.at(-2).snapshot==='snapshot-b' && requests.at(-1).snapshot===null,'snapshot conflict retries once without old snapshot');
  card.offset=119;rows.splice(10);await host.load(card,true);
  check(card.offset===0 && card.response.total===10 && card.response.items.length===10,'removed final page clamps to valid remaining page');
  // Resolve an older request after a newer one; the real generation guard must keep the newer response.
  let resolveOld;const oldResponse={...card.response,items:[sampleItem('outdated')],total:1,truncated:false,pagination:{offset:0,limit:17,total:1,next_offset:null,has_more:false}};
  const latestResponse={...oldResponse,items:[sampleItem('latest')]};
  let requestNumber=0;
  globalThis.fetch=async()=>{requestNumber++;if(requestNumber===1)return new Promise(resolve=>{resolveOld=()=>resolve(new Response(JSON.stringify(oldResponse),{headers:{'content-type':'application/json'}}));});return new Response(JSON.stringify(latestResponse),{headers:{'content-type':'application/json'}});};
  const older=host.load(card,true);host.revision="next-source-revision";await host.load(card,true);resolveOld();await older;
  check(card.response.items[0].id==='latest','late older response never replaces newer page');
  card.offset=5;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'isolated paging failure',code:'upstream_unavailable'}),{status:502,headers:{'content-type':'application/json'}});
  await host.load(card,true);
  check(card.offset===0 && card.response.items[0].id==='latest' && card.snapshot===card.response.snapshot_revision,'failed page restores displayed offset and snapshot without relabeling old rows');
} finally {globalThis.fetch=pagingFetch; if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}

if (process.argv.includes('--live')) {
  const liveCatalog = client.parseCatalog(await (await fetch('http://127.0.0.1:8866/api/widgets/v1/catalog')).json());
  const result = [];
  for (const id of client.widgetIds) { const value = client.parseWidget(await (await fetch(`http://127.0.0.1:8866/api/widgets/v1/${id}?limit=100`)).json(), id); result.push({ id, status: value.status, shown: value.items.length, total: value.total, truncated: value.truncated }); }
  console.log(JSON.stringify({ realReadOnlyContract: { themes: liveCatalog.widgets.length, projects: liveCatalog.projects.length, result } }));
}


for (let columns=4; columns<=12; columns++) check(parseInformationLayout({schema_version:2, widgets:[{...layout.widgets[0],columns,rows:4}]})?.widgets[0].columns === columns, "each integer width persists");

console.log(JSON.stringify({ informationWidgetsChecks: checks, passed: true, browser: 'deferred-to-CUA', noProductionWrites: true }));
