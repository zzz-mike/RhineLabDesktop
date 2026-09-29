/** Read-only local bridge. File identities are supplied by the host, never paths from a website. */
export interface DesktopFile {
  id: string; path: string; name: string;
  kind: 'directory' | 'file' | 'unavailable' | 'unsupported';
  size: number | null; modified_at: string | null; version: string; extension?: string;
  summary?: { status: string; text?: string; method?: string; is_ai?: boolean;
    index_synced_at?: string; source_modified_at?: string; fingerprint?: string; message?: string };
}
export interface DesktopColumn { id: string; title: string; directory: DesktopFile; entries: DesktopFile[]; total: number | null; truncated?: boolean; status?: string; }
export interface DesktopCatalog { schema_version: string; status: string; root_label: string; generated_at: string; columns: DesktopColumn[]; message?: string; exclusions?: unknown; hidden_files?: string; truncated?: boolean; }
export interface DesktopFolder { directory: DesktopFile; entries: DesktopFile[]; total: number; truncated: boolean; breadcrumbs?: DesktopFile[]; }
export interface DesktopPreview { kind: 'directory' | 'text' | 'image' | 'pdf' | 'unsupported'; file: DesktopFile; text?: string; listing?: DesktopFolder; content_url?: string; message?: string; }

export async function localJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-Rhine-Local': '1', ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 404 ? '文件已移动、删除或未在可访问目录中。' : `本机接口读取失败（${response.status}）。`);
  return response.json() as Promise<T>;
}
export async function getDesktopCatalog(): Promise<DesktopCatalog> {
  const catalog = await localJSON<DesktopCatalog>('/api/desktop/v1/catalog');
  if (catalog.schema_version !== '1.0' || !Array.isArray(catalog.columns)) throw new Error('桌面目录格式不兼容。');
  return catalog;
}
export function catalogSignature(catalog: DesktopCatalog): string {
  // Do not rebuild a 3D scene merely because the scan timestamp changed.
  return JSON.stringify([catalog.status, catalog.columns, catalog.exclusions], (key, value) => key === 'index_synced_at' ? undefined : value);
}
export function safePreviewContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && url.pathname === '/api/desktop/v1/content' && url.searchParams.has('token') ? url.href : null;
  } catch { return null; }
}
export async function desktopFileAction(id: string, action: 'open' | 'reveal'): Promise<void> {
  const capabilities = await localJSON<{ action_token?: string }>('/api/local/v1/capabilities');
  if (!capabilities.action_token) throw new Error('本机打开能力尚未就绪。');
  await localJSON('/api/desktop/v1/action', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Rhine-Action-Token': capabilities.action_token,
  }, body: JSON.stringify({ id, action }) });
}
