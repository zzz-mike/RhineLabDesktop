import { assetUrl } from './asset-url';
import { safePreviewContent } from './desktop-files';

export const PDF_BYTE_LIMIT = 20 * 1024 * 1024;
export const PDF_PIXEL_LIMIT = 4_000_000;
const PDF_EDGE_LIMIT = 4096;
const PDF_OPERATION_TIMEOUT = 30000;
class LocalPdfError extends Error {}

interface PdfViewport { width: number; height: number; }
interface PdfRenderTask { promise: Promise<void>; cancel(): void; }
interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; annotationMode: number; background: string }): PdfRenderTask;
  cleanup(): boolean;
}
interface PdfDocument { numPages: number; getPage(number: number): Promise<PdfPage>; }
interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void>; }
interface PdfModule { GlobalWorkerOptions: { workerSrc: string }; getDocument(options: Record<string, unknown>): PdfLoadingTask; }

let library: Promise<PdfModule> | undefined;
function vendorUrl(path: string): string {
  const url = new URL(assetUrl(`vendor/pdfjs/${path}`), document.baseURI);
  if (url.origin !== location.origin) throw new Error('PDF 组件必须从当前本机服务加载。');
  return url.href;
}
function loadPdfLibrary(): Promise<PdfModule> {
  if (!library) {
    const moduleUrl = vendorUrl('build/pdf.mjs');
    library = import(/* @vite-ignore */ moduleUrl).then((module: PdfModule) => {
      module.GlobalWorkerOptions.workerSrc = vendorUrl('build/pdf.worker.mjs');
      return module;
    }).catch(() => { library = undefined; throw new Error('本地 PDF 组件加载失败。请重新打开，或用原应用打开。'); });
  }
  return library;
}

/** Bound both area and edge length even for pathological PDF page dimensions. */
export function pdfPageScale(width: number, height: number, availableWidth: number, deviceScale = 1): number {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('PDF 页面尺寸无效。');
  const cssWidth = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 600;
  const density = Number.isFinite(deviceScale) ? Math.max(1, Math.min(2, deviceScale)) : 1;
  return Math.min(Math.min(1800, cssWidth * density) / width, Math.sqrt(PDF_PIXEL_LIMIT / width / height), PDF_EDGE_LIMIT / Math.max(width, height));
}

/** The PDF itself is fetched only from the existing capability endpoint, never by PDF.js. */
export async function readLocalPdf(value: string, signal: AbortSignal): Promise<Uint8Array> {
  const url = safePreviewContent(value);
  if (!url || new URL(url).username || new URL(url).password) throw new LocalPdfError('PDF 预览地址不在本机白名单中。');
  const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) { await response.body?.cancel(); throw new LocalPdfError('PDF 读取失败或预览链接已过期，请重新打开文件。'); }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') { await response.body?.cancel(); throw new LocalPdfError('本机返回的内容不是 PDF。'); }
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > PDF_BYTE_LIMIT) { await response.body?.cancel(); throw new LocalPdfError('PDF 超过 20 MiB 预览限制，请用原应用打开。'); }
  if (!response.body) throw new LocalPdfError('PDF 未返回可读内容。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > PDF_BYTE_LIMIT) { await reader.cancel(); throw new LocalPdfError('PDF 超过 20 MiB 预览限制，请用原应用打开。'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new LocalPdfError('文件签名不是 PDF，未执行预览。');
  return bytes;
}

/** Canvas-only renderer: no viewer scripting, annotation/link layer, form or embedded attachments. */
export class PdfCanvasPreview {
  private readonly controller = new AbortController();
  private loading?: PdfLoadingTask;
  private document?: PdfDocument;
  private page?: PdfPage;
  private renderTask?: PdfRenderTask;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private failed = false;
  private busy = true;
  private pageNumber = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly status = document.createElement('p');
  private readonly counter = document.createElement('output');
  private readonly previous = document.createElement('button');
  private readonly next = document.createElement('button');

  constructor(private readonly root: HTMLElement, url: string, private readonly title: string) {
    root.classList.add('desktop-pdf-preview');
    root.dataset.pdfState = 'loading';
    const controls = document.createElement('div'); controls.className = 'desktop-pdf-controls'; controls.setAttribute('aria-label', 'PDF 翻页');
    this.previous.textContent = '上一页'; this.next.textContent = '下一页';
    for (const button of [this.previous, this.next]) { button.type = 'button'; button.disabled = true; }
    this.previous.addEventListener('click', () => void this.showPage(this.pageNumber - 1));
    this.next.addEventListener('click', () => void this.showPage(this.pageNumber + 1));
    this.counter.textContent = '正在读取页数'; this.counter.setAttribute('aria-live', 'polite');
    controls.append(this.previous, this.counter, this.next);
    this.status.className = 'desktop-file-state'; this.status.setAttribute('role', 'status');
    this.status.textContent = '正在本机读取 PDF…';
    this.canvas.className = 'desktop-pdf-canvas'; this.canvas.hidden = true; this.canvas.setAttribute('role', 'img');
    const note = document.createElement('p'); note.className = 'desktop-file-meta';
    note.textContent = '本地逐页画布预览 · 不执行 PDF 脚本或链接 · 表单和批注不显示 · 原文件未改动';
    root.replaceChildren(controls, this.status, this.canvas, note);
    this.armTimeout();
    void this.load(url);
  }

  private armTimeout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail('PDF 读取或渲染超时，请用原应用打开。'), PDF_OPERATION_TIMEOUT);
  }
  private updateButtons() {
    this.previous.disabled = this.busy || this.failed || this.pageNumber <= 1;
    this.next.disabled = this.busy || this.failed || !this.document || this.pageNumber >= this.document.numPages;
  }
  private async load(url: string) {
    try {
      const [data, pdf] = await Promise.all([readLocalPdf(url, this.controller.signal), loadPdfLibrary()]);
      if (this.disposed || this.failed) return;
      this.loading = pdf.getDocument({ data, isEvalSupported: false, enableXfa: false, stopAtErrors: true,
        cMapUrl: vendorUrl('cmaps/'), cMapPacked: true, standardFontDataUrl: vendorUrl('standard_fonts/'),
        wasmUrl: vendorUrl('wasm/'), iccUrl: vendorUrl('iccs/'), useWorkerFetch: true,
        disableRange: true, disableStream: true, disableAutoFetch: true,
        // Keep large scan images: maxImageSize would silently omit them. PDF.js
        // downscales image canvases instead; our final page canvas is also bounded.
        maxImageSize: -1, canvasMaxAreaInBytes: PDF_PIXEL_LIMIT * 4, verbosity: 0 });
      const document = await this.loading.promise;
      if (this.disposed || this.failed) return;
      this.document = document;
      if (!Number.isInteger(this.document.numPages) || this.document.numPages < 1) throw new Error('PDF 没有可显示页面。');
      this.busy = false;
      await this.showPage(1);
    } catch (error) {
      if (this.disposed || this.failed) return;
      const password = error instanceof Error && error.name === 'PasswordException';
      // PDF/parser errors are untrusted and may contain paths or capability URLs.
      this.fail(error instanceof LocalPdfError ? error.message : password ? 'PDF 需要密码，请用原应用打开。' : 'PDF 无法安全读取或渲染（可能损坏、超限或链接过期）。请重新打开文件或用原应用打开。');
    }
  }
  private async showPage(number: number) {
    if (this.disposed || this.failed || this.busy || !this.document || number < 1 || number > this.document.numPages) return;
    this.busy = true; this.updateButtons(); this.armTimeout();
    this.root.dataset.pdfState = 'loading'; this.canvas.hidden = true;
    this.status.textContent = `正在渲染第 ${number} 页…`;
    try {
      this.page?.cleanup(); this.page = undefined;
      const page = await this.document.getPage(number);
      if (this.disposed || this.failed) { page.cleanup(); return; }
      this.page = page;
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pdfPageScale(original.width, original.height, this.root.clientWidth, window.devicePixelRatio) });
      this.canvas.width = Math.max(1, Math.floor(viewport.width)); this.canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = this.canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas unavailable');
      this.renderTask = page.render({ canvas: this.canvas, canvasContext: context, viewport, annotationMode: 0, background: '#ffffff' });
      await this.renderTask.promise;
      if (this.disposed || this.failed) return;
      this.renderTask = undefined; this.pageNumber = number;
      this.counter.textContent = `${number} / ${this.document.numPages} 页`;
      this.canvas.setAttribute('aria-label', `${this.title}，第 ${number} 页，共 ${this.document.numPages} 页`);
      this.canvas.hidden = false; this.root.dataset.pdfState = 'rendered';
      this.status.textContent = `已渲染第 ${number} 页；翻页查看其余内容。`;
      clearTimeout(this.timer); this.busy = false; this.updateButtons();
    } catch {
      if (!this.disposed && !this.failed) this.fail('此页无法渲染，请用原应用检查完整 PDF。');
    }
  }
  private releaseResources() {
    clearTimeout(this.timer); this.controller.abort();
    this.renderTask?.cancel(); this.renderTask = undefined;
    this.page?.cleanup(); this.page = undefined;
    const loading = this.loading; this.loading = undefined; this.document = undefined;
    if (loading) void loading.destroy().catch(() => { /* Cancellation must never become an unhandled rejection. */ });
    this.canvas.width = 0; this.canvas.height = 0;
  }
  private fail(message: string) {
    if (this.disposed || this.failed) return;
    this.failed = true; this.busy = false; this.releaseResources(); this.updateButtons();
    this.canvas.hidden = true; this.root.dataset.pdfState = 'error';
    this.counter.textContent = '预览未完成'; this.status.textContent = message;
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.releaseResources(); this.root.replaceChildren();
  }
}
