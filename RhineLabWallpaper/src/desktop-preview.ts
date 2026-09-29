import { desktopFileAction, localJSON, safePreviewContent, type DesktopFile, type DesktopFolder, type DesktopPreview } from './desktop-files';
import { PdfCanvasPreview } from './pdf-preview';
import './desktop-preview.css';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
};
const summaryNames: Record<string, string> = { extracted: '已抽取', partial: '部分抽取', metadata_only: '仅文件元数据', stale: '摘要版本已过期', not_extracted: '未抽取' };

/** A preview is local and untrusted. Text never passes through innerHTML. */
export class DesktopPreviewPanel {
  private sequence = 0;
  private trail: DesktopFile[] = [];
  private pdfPreview?: PdfCanvasPreview;
  constructor(private root: HTMLElement, file: DesktopFile) { root.classList.add('desktop-preview'); void this.open(file); }
  destroy() { this.sequence++; this.pdfPreview?.destroy(); this.pdfPreview = undefined; this.root.replaceChildren(); }
  private async open(file: DesktopFile, back = false) {
    const sequence = ++this.sequence;
    this.pdfPreview?.destroy(); this.pdfPreview = undefined;
    if (!back) this.trail.push(file);
    this.root.replaceChildren(element('p', '正在读取真实文件…', 'desktop-file-state'));
    try {
      const preview = await localJSON<DesktopPreview>(`/api/desktop/v1/preview?id=${encodeURIComponent(file.id)}`);
      if (sequence !== this.sequence || !this.root.isConnected) return;
      this.render(preview);
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.root.replaceChildren(element('p', error instanceof Error ? error.message : '预览读取失败。', 'desktop-file-state'));
      this.actions(file);
    }
  }
  private actions(file: DesktopFile) {
    const bar = element('div', undefined, 'desktop-file-actions');
    const feedback = element('p', '', 'desktop-file-state'); feedback.setAttribute('role', 'status');
    for (const [action, label] of [['open', '用原应用打开'], ['reveal', '在 Finder 中显示']] as const) {
      if (action === 'open' && file.kind !== 'file') continue;
      const button = element('button', label); button.type = 'button';
      button.addEventListener('click', async () => {
        // This handler is the sole bridge write entry point. No message listener or automatic action.
        if (action === 'open' && !window.confirm(`用系统默认应用打开“${file.name}”？本操作不会修改或删除文件。`)) return;
        button.disabled = true;
        try { await desktopFileAction(file.id, action); feedback.textContent = '已向系统提交打开请求；未在莱茵中修改文件。'; }
        catch (error) { feedback.textContent = error instanceof Error ? error.message : '打开请求失败。'; }
        finally { button.disabled = false; }
      });
      bar.append(button);
    }
    this.root.append(bar, feedback);
  }
  private render(preview: DesktopPreview) {
    const file = preview.file;
    this.root.replaceChildren();
    const breadcrumb = element('nav', undefined, 'desktop-file-breadcrumbs'); breadcrumb.setAttribute('aria-label', '文件夹路径');
    this.trail.forEach((entry, index) => {
      const button = element('button', entry.name); button.type = 'button'; button.disabled = index === this.trail.length - 1;
      button.addEventListener('click', () => { this.trail = this.trail.slice(0, index + 1); void this.open(entry, true); });
      breadcrumb.append(button);
    });
    this.root.append(breadcrumb, element('h3', file.name));
    if (preview.message) this.root.append(element('p', preview.message, 'desktop-file-state'));
    const content = element('section', undefined, 'desktop-file-content'); content.setAttribute('aria-label', '真实内容预览'); this.root.append(content);
    if (preview.kind === 'directory') {
      if (preview.listing) this.folder(content, preview.listing);
      else {
        const sequence = this.sequence;
        void localJSON<DesktopFolder>(`/api/desktop/v1/folder?id=${encodeURIComponent(file.id)}`).then(folder => {
          if (sequence === this.sequence) this.folder(content, folder);
        }).catch(() => { if (sequence === this.sequence) content.textContent = '无法读取该目录。'; });
      }
    } else if (preview.kind === 'text') {
      content.append(element('pre', preview.text ?? '此文件未返回可读文本。'));
    } else if (preview.kind === 'image' || preview.kind === 'pdf') {
      const url = safePreviewContent(preview.content_url);
      if (url) {
        if (preview.kind === 'image') { const image = element('img'); image.src = url; image.alt = file.name; image.addEventListener('error', () => { content.textContent = '图片预览已失效，请重新打开文件。'; }); content.append(image); }
        else { this.pdfPreview = new PdfCanvasPreview(content, url, file.name); }
      } else content.textContent = '预览链接无效或不在本机文件白名单中。';
    } else content.append(element('p', '此格式暂不支持内嵌预览。可以用原应用打开；这不代表文件为空。'));
    this.actions(file);
    const metadata = element('details', undefined, 'desktop-file-info');
    metadata.append(element('summary', '文件信息与版本'));
    metadata.append(element('p', `${file.kind === 'directory' ? '文件夹' : file.extension || '文件'} · 修改 ${file.modified_at || '未知'}\n版本 ${file.version || '未知'}`, 'desktop-file-meta'));
    this.root.append(metadata);
    const summary = element('details', undefined, 'desktop-file-summary');
    const data = file.summary;
    summary.append(element('summary', `独立摘要 · ${summaryNames[data?.status ?? 'not_extracted'] ?? data?.status ?? '未抽取'} · 非 AI 总结`));
    summary.append(element('p', data?.text || data?.message || '当前没有可用内容摘要。真实文件仍可在上方预览。'));
    summary.append(element('small', `本地抽取，非 AI 总结${data?.method ? ` · ${data.method}` : ''}。${data?.source_modified_at ? `对应文件修改时间 ${data.source_modified_at}。` : ''}${data?.index_synced_at ? `索引同步时间 ${data.index_synced_at}（不是总结生成时间）。` : ''}`));
    this.root.append(summary);
  }
  private folder(root: HTMLElement, folder: DesktopFolder) {
    root.replaceChildren(element('p', `${folder.total} 个直接子项${folder.truncated ? ' · 仅显示部分，目录未完整展开' : ''}`, 'desktop-file-meta'));
    if (!folder.entries.length) root.append(element('p', folder.truncated ? '当前页未返回子项。' : '该目录没有可显示子项。'));
    const list = element('div', undefined, 'desktop-file-list');
    folder.entries.forEach(file => {
      const button = element('button'); button.type = 'button'; button.dataset.fileId = file.id;
      button.append(element('span', file.kind === 'directory' ? '▤' : '↳'), element('span', file.name), element('small', file.kind === 'unavailable' ? '不可用' : file.modified_at || '时间未知'));
      button.addEventListener('click', () => void this.open(file)); list.append(button);
    });
    root.append(list);
  }
}
