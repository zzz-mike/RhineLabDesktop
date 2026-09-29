import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

globalThis.location = { origin: 'http://127.0.0.1:5180' };
globalThis.window = { devicePixelRatio: 2 };
class Node extends EventTarget {
  constructor(tag) { super(); this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.clientWidth = 640; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getContext() { return {}; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
globalThis.document = { baseURI: location.origin + '/', createElement: tag => new Node(tag) };
const source = await readFile('src/pdf-preview.ts', 'utf8');
// No browser is opened: only the fixed module import is substituted by an in-memory
// PDF engine double, leaving production lifecycle/fetch/DOM code under test.
const compiled = await build({ stdin: { contents: source.replace('import(/* @vite-ignore */ moduleUrl)', 'Promise.resolve(globalThis.pdfEngine)'), resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env.PROD': 'false', 'import.meta.env.BASE_URL': '"/"' } });
const pdf = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const url = '/api/desktop/v1/content?token=unit-fixture';
const signal = () => new AbortController().signal;
let calls = [];
const response = (body = '%PDF-1.7\nunit fixture', headers = {}) => new Response(body, { headers: { 'content-type': 'application/pdf', ...headers } });
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(); };
assert.equal(new TextDecoder().decode(await pdf.readLocalPdf(url, signal())), '%PDF-1.7\nunit fixture');
assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'same-origin');
assert.equal(calls[0].options.referrerPolicy, 'no-referrer'); assert.equal(calls[0].options.cache, 'no-store');
for (const address of ['https://evil.test/api/desktop/v1/content?token=a', '/api/desktop/v1/action?token=a', 'file:///private/a.pdf', 'http://user:password@127.0.0.1:5180/api/desktop/v1/content?token=a']) {
  const before = calls.length; await assert.rejects(pdf.readLocalPdf(address, signal()), /白名单/); assert.equal(calls.length, before);
}
globalThis.fetch = async () => response('not pdf'); await assert.rejects(pdf.readLocalPdf(url, signal()), /签名/);
globalThis.fetch = async () => response('%PDF-', { 'content-type': 'text/html' }); await assert.rejects(pdf.readLocalPdf(url, signal()), /不是 PDF/);
globalThis.fetch = async () => response('%PDF-', { 'content-length': String(pdf.PDF_BYTE_LIMIT + 1) }); await assert.rejects(pdf.readLocalPdf(url, signal()), /20 MiB/);
let cancelled = false;
globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/pdf' } });
await assert.rejects(pdf.readLocalPdf(url, signal()), /20 MiB/); assert.equal(cancelled, true, 'Streaming overrun cancels before reading the entire source');
for (const [width, height, available, dpr] of [[612,792,640,2],[1e8,1e9,99999,100],[50000,1,800,2],[1,50000,800,2],[100,100,NaN,NaN]]) {
  const scale = pdf.pdfPageScale(width,height,available,dpr); assert.ok(Number.isFinite(scale) && scale > 0);
  assert.ok(width * height * scale * scale <= pdf.PDF_PIXEL_LIMIT + 0.01); assert.ok(Math.max(width,height) * scale <= 4096 + 0.01);
}
for (const [w,h] of [[0,1],[-1,1],[NaN,1],[1,Infinity]]) assert.throws(() => pdf.pdfPageScale(w,h,800), /尺寸/);

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(test) { for (let i = 0; i < 30 && !test(); i++) await tick(); assert.ok(test(), 'State settled within test budget'); }
let options, destroyed = 0, cleaned = 0, rendered = [], cancelCount = 0, pendingRender;
const engine = {
  GlobalWorkerOptions: {},
  getDocument(value) {
    options = value;
    return { promise: Promise.resolve({ numPages: 3, getPage: async number => ({
      getViewport: ({scale}) => ({width:612*scale,height:792*scale}), cleanup() { cleaned++; return true; },
      render(args) { rendered.push({number,args}); return { promise: pendingRender ?? Promise.resolve(), cancel() { cancelCount++; } }; },
    }) }), destroy: async () => { destroyed++; } };
  },
};
globalThis.pdfEngine = engine; globalThis.fetch = async () => response();
const root = new Node('section'); const view = new pdf.PdfCanvasPreview(root,url,'unit fixture');
await until(() => root.dataset.pdfState === 'rendered');
assert.equal(rendered.length,1); assert.equal(rendered[0].args.annotationMode,0); assert.equal(options.isEvalSupported,false); assert.equal(options.enableXfa,false);
assert.ok(options.data instanceof Uint8Array); assert.equal(options.url,undefined); assert.equal(options.maxImageSize,-1,'Scan images are not silently skipped');
assert.equal(options.standardFontDataUrl, location.origin + '/vendor/pdfjs/standard_fonts/');
assert.equal(engine.GlobalWorkerOptions.workerSrc,location.origin + '/vendor/pdfjs/build/pdf.worker.mjs');
let [previous,counter,next] = root.children[0].children;
assert.equal(counter.textContent,'1 / 3 页'); assert.equal(previous.disabled,true); assert.equal(next.disabled,false);
next.click(); next.click(); await until(() => counter.textContent === '2 / 3 页'); assert.equal(rendered.length,2,'Repeated click during render is ignored');
next.click(); await until(() => counter.textContent === '3 / 3 页'); assert.equal(next.disabled,true);
previous.click(); await until(() => counter.textContent === '2 / 3 页'); assert.ok(cleaned >= 3);
const canvas = root.children[2]; view.destroy(); view.destroy(); await tick();
assert.equal(destroyed,1,'Loading task owns worker/document and is destroyed once'); assert.equal(canvas.width,0); assert.equal(canvas.height,0); assert.equal(root.children.length,0);
let finishRender; pendingRender = new Promise(resolve => { finishRender = resolve; });
const delayedRoot = new Node('section'); const delayed = new pdf.PdfCanvasPreview(delayedRoot,url,'delayed');
await until(() => rendered.length === 5); delayed.destroy(); finishRender(); await tick();
assert.equal(cancelCount,1); assert.equal(delayedRoot.children.length,0,'Late rendering must not restore a closed preview'); assert.equal(destroyed,2);
pendingRender = undefined;
engine.getDocument = () => ({ promise: Promise.reject(Object.assign(new Error('secret-token-or-document-script'),{ name:'PasswordException' })), destroy:async () => { destroyed++; } });
const protectedRoot = new Node('section'); const protectedView = new pdf.PdfCanvasPreview(protectedRoot,url,'protected');
await until(() => protectedRoot.dataset.pdfState === 'error'); assert.match(protectedRoot.children[1].textContent,/密码/); assert.ok(!protectedRoot.children[1].textContent.includes('secret-token')); protectedView.destroy();

assert.ok(!source.includes("createElement('iframe')")); assert.ok(!source.includes('innerHTML')); assert.ok(!source.includes('localStorage'));
for (const forbidden of ['getJavaScript(', 'getJSActions(', 'PDFScriptingManager', 'AnnotationLayer', 'window.open(', 'addEventListener(\'message\'']) assert.ok(!source.includes(forbidden));
assert.ok(source.includes('isEvalSupported: false')); assert.ok(source.includes('enableXfa: false')); assert.ok(source.includes('annotationMode: 0'));
const vendored = ['build/pdf.mjs','build/pdf.worker.mjs','LICENSE'];
for (const directory of ['cmaps','standard_fonts','wasm','iccs']) for (const name of await readdir(`public/vendor/pdfjs/${directory}`)) vendored.push(`${directory}/${name}`);
for (const path of vendored) assert.ok((await readFile(`public/vendor/pdfjs/${path}`)).length > 0,path);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
console.log(`PASS: PDF source URL/byte/signature boundaries; one-page navigation; cancellation/destroy; password fallback; canvas pixel limits; ${vendored.length} local vendor assets.`);
console.log(`PDF.js module SHA256 ${sha256(await readFile('public/vendor/pdfjs/build/pdf.mjs'))}`);
console.log('Not a visual rendering test: production browser page/canvas inspection remains required.');
