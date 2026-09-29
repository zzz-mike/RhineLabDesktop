declare const __RHINE_EDITION__: 'display' | 'local';
type Access = { revision?: string; desktop?: boolean; secretary?: boolean; solar?: boolean; media?: boolean; file_actions?: boolean };
declare global { interface Window { __RHINE_ACCESS__?: Access } }
export const localEdition = typeof __RHINE_EDITION__ !== 'undefined' && __RHINE_EDITION__ === 'local';
export const modernUI = true;
export const access: Access = localEdition && typeof window !== 'undefined' ? window.__RHINE_ACCESS__ ?? {} : {};
export const desktopConnected = localEdition && access.desktop === true;
export function allowsService(path: string): boolean {
  if (!localEdition) return false;
  if (path.startsWith('/api/desktop/')) return desktopConnected;
  if (path.startsWith('/api/secretary/')) return access.secretary === true;
  if (path.startsWith('/api/solar/')) return access.solar === true;
  if (path.startsWith('/api/media/')) return access.media === true;
  return path.startsWith('/api/local/') || path.startsWith('/api/access/');
}
export function mountConnections(parent: HTMLElement) {
  if (!localEdition) return;
  const link = document.createElement('a'); link.href = '/connections'; link.textContent = '本地连接';
  link.style.cssText = 'color:inherit;text-decoration:none;font:inherit;padding:8px;border:1px solid currentColor';
  link.setAttribute('aria-label', '管理本地文件夹与服务授权'); parent.append(link);
  const check = async () => {
    if (document.hidden) return;
    try {
      const response = await fetch('/api/access/state', {headers:{'X-Rhine-Local':'1'},cache:'no-store',signal:AbortSignal.timeout(4000)});
      if (!response.ok) return;
      const next = await response.json();
      if (next.revision !== access.revision) location.replace('/?mac=1');
    } catch { /* Disconnected server cannot serve any more file content. */ }
  };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rhine-permissions') : null;
  channel?.addEventListener('message', () => void check());
  document.addEventListener('visibilitychange', () => void check());
  window.setInterval(() => void check(), 5000);
}
