export interface WebsitePage { id: string; name: string; url: string; mode: 'embedded' | 'external'; }
export const corePages = ['workbench', 'archive', 'information'] as const;
export function safeWebsiteUrl(value: unknown, ownOrigin: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === ownOrigin) return null;
    const own = new URL(ownOrigin);
    const local = ['127.0.0.1', 'localhost', '[::1]'];
    if (local.includes(url.hostname) && url.port === own.port) return null;
    // Local capability endpoints are not website pages, even on another hostname.
    if (/^\/api\/(desktop|local|media|secretary)\//.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function restoreWebsites(value: unknown, origin: string): WebsitePage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 24).flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, name, mode } = entry;
    const url = safeWebsiteUrl(entry.url, origin);
    if (typeof id !== 'string' || !/^site:[a-zA-Z0-9-]{1,100}$/.test(id) || seen.has(id) || !url || typeof name !== 'string' || !name.trim()) return [];
    seen.add(id); return [{ id, name: name.trim().slice(0, 60), url, mode: mode === 'external' ? 'external' as const : 'embedded' as const }];
  });
}
/** A single dominant horizontal gesture advances at most once, including momentum. */
export class PageGesture {
  private total = 0; private last = 0; private locked = false;
  push(dx: number, dy: number, time: number, allowed: boolean, deltaMode = 0): number {
    if (time - this.last > 240) { this.total = 0; this.locked = false; }
    this.last = time;
    if (!allowed || deltaMode !== 0 || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) <= Math.abs(dy) * 1.7) { this.total = 0; return 0; }
    if (this.locked) return 0;
    this.total += dx;
    if (Math.abs(this.total) < 65) return 0;
    this.locked = true; return this.total > 0 ? 1 : -1;
  }
}
