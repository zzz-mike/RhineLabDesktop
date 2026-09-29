import { InformationWidgets } from './information-widgets';
import { corePages, PageGesture, restoreWebsites, safeWebsiteUrl, type WebsitePage } from './desktop-navigation';
import './desktop-pages.css';

const storageKey = 'rhine-desktop-pages-v1';
const labels: Record<string, string> = { workbench: '工作台', archive: '桌面档案', information: '秘书信息' };
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result;
};
export class DesktopPages {
  current = 'workbench';
  private sites: WebsitePage[] = [];
  private root = node('div', undefined, 'rhine-desktop-pages');
  private nav = node('nav', undefined, 'rhine-page-nav');
  private panel = node('section', undefined, 'rhine-page-surface');
  private informationRoot = node('div', undefined, 'rhine-information-root');
  private widgets: InformationWidgets;
  private siteView = node('div', undefined, 'rhine-site-view');
  private manager = node('dialog', undefined, 'rhine-site-manager');
  private note = node('span', '', 'rhine-page-note');
  private gesture = new PageGesture();
  private pointers = new Set<number>();
  private ready = false;
  private storageOK = true;
  constructor(private host: HTMLElement, private onChange: (page: string) => void, private onRefresh: () => void, private canNavigate: () => boolean, private canGesture: (target: Element) => boolean = () => true) {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); this.sites = restoreWebsites(saved?.sites, location.origin); if ([...corePages, ...this.sites.map(site => site.id)].includes(saved?.current)) this.current = saved.current; } catch { this.storageOK = false; }
    this.nav.setAttribute('aria-label', '莱茵桌面页面');
    this.nav.title = '在页面背景或顶部导航空白处双指左右滑动切页；内容滚动、文件拖动和编辑布局不切页。';
    this.panel.append(this.informationRoot, this.siteView); this.root.append(this.nav, this.panel, this.manager); host.append(this.root);
    this.widgets = new InformationWidgets(this.informationRoot);
    this.root.hidden = true;
    host.addEventListener('pointerdown', event => this.pointers.add(event.pointerId), true);
    window.addEventListener('pointerup', event => this.pointers.delete(event.pointerId));
    window.addEventListener('pointercancel', event => this.pointers.delete(event.pointerId));
    window.addEventListener('blur', () => this.pointers.clear());
    host.addEventListener('wheel', event => {
      const target = event.target as Element;
      const content = target.closest('input,textarea,select,[contenteditable],iframe,button,a,#detail-ui,#archive-ui,.wb-module,.wb-today,.wb-nav,.rhine-information-root > *,[data-widget-editing="true"]');
      const background = target === this.panel || target === this.informationRoot || target === this.siteView
        || Boolean(target.closest('.rhine-page-nav')) || Boolean(target.closest('#stage'));
      const editing = this.current === 'information' && this.informationRoot.dataset.widgetEditing === 'true';
      const allowed = this.ready && !this.manager.open && !editing && !this.pointers.size && this.canNavigate() && this.canGesture(target) && !content && background;
      const direction = this.gesture.push(event.deltaX, event.deltaY, performance.now(), allowed && !event.ctrlKey, event.deltaMode);
      if (allowed && event.deltaMode === 0 && !event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.7) { event.preventDefault(); event.stopPropagation(); }
      if (direction) this.step(direction);
    }, { passive: false, capture: true });
    this.renderNav(); this.apply();
  }
  get pausesScene() { return this.ready && this.current !== 'workbench' && this.current !== 'archive'; }
  setReady(ready: boolean) { if (this.ready === ready) return; this.ready = ready; this.root.hidden = !ready; this.apply(); }
  setPage(page: string) { if (!this.canNavigate() || ![...corePages, ...this.sites.map(site => site.id)].includes(page)) return; this.current = page; this.save(); this.renderNav(); this.apply(); }
  private step(direction: number) { const pages = [...corePages, ...this.sites.map(site => site.id)]; const index = pages.indexOf(this.current); this.setPage(pages[Math.max(0, Math.min(pages.length - 1, index + direction))]); }
  private save() { try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, current: this.current, sites: this.sites })); this.storageOK = true; } catch { this.storageOK = false; } }
  setArchiveStatus(message: string) { this.note.textContent = message; this.note.title = message; }
  private renderNav() {
    this.nav.replaceChildren();
    for (const page of [...corePages.map(id => ({ id, name: labels[id] })), ...this.sites]) {
      const button = node('button', page.name); button.type = 'button'; button.dataset.page = page.id; button.setAttribute('aria-current', page.id === this.current ? 'page' : 'false');
      button.addEventListener('click', () => this.setPage(page.id)); this.nav.append(button);
    }
    const refresh = node('button', '↻'); refresh.type = 'button'; refresh.title = '重新核对桌面文件'; refresh.setAttribute('aria-label', refresh.title); refresh.hidden = this.current !== 'archive'; refresh.addEventListener('click', () => this.onRefresh());
    const manage = node('button', '＋ 网站'); manage.type = 'button'; manage.addEventListener('click', () => this.openManager());
    const hint = node('span', '背景双指左右切页', 'rhine-page-hint');
    this.note.hidden = this.current !== 'archive';
    this.nav.append(refresh, manage, this.note, hint);
    if (!this.storageOK) { hint.textContent = '布局保存失败'; hint.title = '刷新后可能丢失当前布局，请检查浏览器存储。'; }
  }
  private apply() {
    this.panel.hidden = !this.ready || ['workbench', 'archive'].includes(this.current);
    this.informationRoot.hidden = this.current !== 'information'; this.siteView.hidden = !this.current.startsWith('site:');
    this.widgets.setActive(this.ready && this.current === 'information');
    // Remove inactive frames completely: third-party pages do not keep running in the background.
    this.siteView.replaceChildren();
    if (this.ready && this.current.startsWith('site:')) this.renderWebsite();
    this.host.dataset.desktopPage = this.ready ? this.current : 'boot';
    if (this.ready) this.onChange(this.current);
  }
  private renderWebsite() {
    const site = this.sites.find(entry => entry.id === this.current); if (!site) return;
    const bar = node('header', undefined, 'rhine-site-bar'); bar.append(node('strong', site.name));
    const link = node('a', '在新页面打开 ↗'); link.href = site.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; bar.append(link);
    const help = node('p', site.mode === 'external' ? '此网站设置为外部打开。点击右侧入口，保留网站自己的登录与权限。' : '隔离显示：若网站拒绝嵌入、登录不成功或内容空白，请在新页面打开。外部网站不能调用本机文件能力。');
    this.siteView.append(bar, help);
    if (site.mode === 'embedded') {
      const frame = node('iframe'); frame.title = site.name; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups'); frame.setAttribute('allow', ''); frame.src = site.url;
      frame.addEventListener('error', () => { help.textContent = '网页未能内嵌显示，请使用上方“在新页面打开”。'; }); this.siteView.append(frame);
    }
  }
  private openManager() {
    if (!this.manager.open && !this.canNavigate()) return;
    this.manager.replaceChildren(node('h2', '自定义网站页'), node('p', '只改变展示；不会修改项目网站。最多 24 页。'));
    const list = node('div', undefined, 'rhine-site-list');
    this.sites.forEach((site, index) => {
      const row = node('div'); row.append(node('span', site.name));
      for (const [label, delta] of [['上移', -1], ['下移', 1]] as const) { const button = node('button', label); button.type = 'button'; button.disabled = index + delta < 0 || index + delta >= this.sites.length; button.addEventListener('click', () => { const swap = this.sites[index + delta]; this.sites[index + delta] = site; this.sites[index] = swap; this.save(); this.renderNav(); this.openManager(); }); row.append(button); }
      const remove = node('button', '移除'); remove.type = 'button'; remove.addEventListener('click', () => { this.sites = this.sites.filter(entry => entry.id !== site.id); if (this.current === site.id) this.current = 'information'; this.save(); this.renderNav(); this.apply(); this.openManager(); }); row.append(remove); list.append(row);
    });
    this.manager.append(list);
    const form = node('form');
    const name = node('input'); name.placeholder = '网站名称'; name.name = 'name'; name.maxLength = 60; name.required = true; name.setAttribute('aria-label', '网站名称');
    const url = node('input'); url.placeholder = 'https://… 或 http://127.0.0.1:8765/'; url.name = 'url'; url.type = 'url'; url.maxLength = 2048; url.required = true; url.setAttribute('aria-label', '网站地址');
    const mode = node('select'); mode.setAttribute('aria-label', '网站打开方式'); for (const [value, label] of [['embedded', '隔离嵌入（可外开）'], ['external', '仅在新页面打开']]) { const option = node('option', label); option.value = value; mode.append(option); }
    const submit = node('button', '添加网站'); submit.type = 'submit'; submit.disabled = this.sites.length >= 24;
    const status = node('p', '', 'rhine-manager-status'); status.setAttribute('role', 'status');
    form.append(name, url, mode, submit, status);
    form.addEventListener('submit', event => {
      event.preventDefault(); const target = safeWebsiteUrl(url.value.trim(), location.origin);
      if (!target || !name.value.trim()) { status.textContent = '请输入网站名称和 HTTP(S) 地址；不能嵌入本机莱茵自身或文件能力接口。'; return; }
      this.sites.push({ id: `site:${crypto.randomUUID()}`, name: name.value.trim(), url: target, mode: mode.value === 'external' ? 'external' : 'embedded' });
      this.save(); this.renderNav(); this.openManager();
    });
    const close = node('button', '完成'); close.type = 'button'; close.addEventListener('click', () => this.manager.close());
    this.manager.append(form, close); if (!this.manager.open) this.manager.showModal();
  }
}
