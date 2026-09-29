import {open, realpath, readdir, lstat, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve, relative, sep, extname, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const SUMMARY_PATH = resolve(homedir(), 'Library/Application Support/AI秘书长/data/desktop-files/state.json');
const TEXT_EXTENSIONS = new Set(['.txt','.md','.csv','.tsv','.json','.xml','.html','.htm','.svg','.css','.js','.ts','.py','.yaml','.yml','.log','.ini','.toml']);
const BINARY_TYPES = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf'};
const OPEN_EXTENSIONS = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pages','.numbers','.key','.txt','.md','.csv','.tsv','.png','.jpg','.jpeg','.gif','.webp','.heic','.mp3','.m4a','.wav','.mp4','.mov']);
export class FileBridgeError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new FileBridgeError(status, code); };
const fingerprint = info => `v3:${info.size}:${info.mtimeNs}`;
const stableId = info => `desktop:${info.dev}:${info.ino}:${info.birthtimeNs}`;
// A single-link file follows its inode across a rename. Hard links share that
// inode but are distinct directory entries: scope their public IDs to the alias
// path so a later listing cannot redirect card A to alias B in the known map.
const entryId = entry => entry.info.isFile() && entry.info.nlink > 1n
  ? `${stableId(entry.info)}:alias:${createHash('sha256').update(entry.path).digest('hex')}`
  : stableId(entry.info);

/** Read-only Desktop map. No watcher, recursive scan, mutation, or automatic application launch. */
export class DesktopFiles {
  constructor({root = resolve(homedir(), 'Desktop'), summaryPath = SUMMARY_PATH, maxEntries = 2000, maxPreviewBytes = 20 * 1024 * 1024, exec = execFileAsync} = {}) {
    this.root = resolve(root); this.summaryPath = summaryPath; this.maxEntries = maxEntries;
    this.maxPreviewBytes = maxPreviewBytes; this.exec = exec; this.known = new Map();
    this.summaryCache = null; this.summaryStamp = null; this.summaryChecked = 0;
  }
  async locate(path = '') {
    if (typeof path !== 'string' || path.length > 4096 || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.')) fail(400, 'invalid_desktop_path');
    const root = await realpath(this.root);
    const candidate = resolve(root, path);
    const resolved = await realpath(candidate).catch(() => fail(404, 'file_not_available'));
    if (resolved !== root && !resolved.startsWith(root + sep)) fail(403, 'outside_desktop');
    const info = await lstat(candidate, {bigint:true});
    if (info.isSymbolicLink()) fail(403, 'symbolic_link_not_followed');
    return {path: relative(root, candidate).split(sep).join('/'), absolute: candidate, resolved, info};
  }
  async summaries() {
    if (Date.now() - this.summaryChecked < 10000) return this.summaryCache;
    this.summaryChecked = Date.now();
    try {
      const info = await stat(this.summaryPath);
      if (info.size > 32 * 1024 * 1024) throw new Error('oversized');
      const stamp = `${info.size}:${info.mtimeMs}`;
      if (stamp !== this.summaryStamp) {
        const handle = await open(this.summaryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.size > 32 * 1024 * 1024) throw new Error('invalid');
          const data = JSON.parse(await handle.readFile({encoding:'utf8'}));
          this.summaryCache = data.version === 3 && data.files && typeof data.files === 'object' ? data : null;
          this.summaryStamp = stamp;
        } finally { await handle.close(); }
      }
    } catch { this.summaryCache = null; this.summaryStamp = null; }
    return this.summaryCache;
  }
  async summary(entry) {
    if (!entry.info.isFile()) return {status:'not_applicable', text:null, method:'local_extraction', is_ai:false};
    const data = await this.summaries();
    const row = data?.files?.[entry.absolute];
    if (!row || row.path !== entry.absolute) return {status:'not_extracted', text:null, method:'local_extraction', is_ai:false};
    if (row.fingerprint !== fingerprint(entry.info)) return {status:'stale', text:null, message:'文件已变化，旧摘要不适用于当前版本', method:'local_extraction', is_ai:false};
    const stage = typeof row.stage === 'string' ? row.stage : 'unknown';
    const status = stage === 'content_read' ? 'extracted' : stage === 'content_read_partial' ? 'partial' : stage === 'metadata_only' ? 'metadata_only' : 'unavailable';
    return {status, text:typeof row.summary === 'string' ? row.summary.slice(0,5000) : null, stage, method:typeof row.extractor === 'string' ? row.extractor.slice(0,100) : 'local_extraction', is_ai:false, fingerprint:row.fingerprint, source_modified_at:row.modified_at ?? null, index_synced_at:data.last_sync_at ?? null, message:status === 'partial' ? '仅部分内容抽取，不代表全文核读' : '本地规则抽取，不是 AI 总结或业务结论'};
  }
  async describe(entry) {
    const {info, path} = entry;
    const id = entryId(entry);
    const descriptor = {id, identity_kind:info.isFile() && info.nlink > 1n ? 'hardlink_alias' : 'inode', path, name:path ? basename(path) : '桌面', kind:info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unsupported', size:info.isFile() ? Number(info.size) : null, modified_at:new Date(Number(info.mtimeMs)).toISOString(), version:fingerprint(info), extension:extname(path).toLowerCase(), summary:await this.summary(entry)};
    this.known.set(id, {path, version:descriptor.version});
    if (this.known.size > 20000) this.known.delete(this.known.keys().next().value);
    return descriptor;
  }
  async list(path = '', limit = this.maxEntries) {
    const directory = await this.locate(path);
    if (!directory.info.isDirectory()) fail(400, 'not_a_directory');
    const names = (await readdir(directory.resolved)).filter(name => !name.startsWith('.')).sort((a,b) => a.localeCompare(b, 'zh-CN'));
    const entries = []; let blocked = 0;
    for (const name of names.slice(0, Math.min(limit,this.maxEntries))) {
      const child = path ? `${path}/${name}` : name;
      try { entries.push(await this.describe(await this.locate(child))); }
      catch { blocked++; entries.push({id:`unavailable:${createHash('sha256').update(child).digest('hex').slice(0,24)}`, path:child, name, kind:'unavailable', message:'未跟随符号链接，或文件已变化/无权限'}); }
    }
    return {schema_version:'1.0', directory:await this.describe(directory), entries, total:names.length, truncated:names.length > Math.min(limit,this.maxEntries), blocked, hidden_files:'excluded', generated_at:new Date().toISOString()};
  }
  async columns() {
    const top = await this.list(); const columns = []; const loose = []; let budget = 5000;
    for (const entry of top.entries) {
      if (entry.kind !== 'directory') { loose.push(entry); continue; }
      try { const contents = await this.list(entry.path,Math.max(0,budget)); budget -= contents.entries.length; columns.push({id:entry.id, title:entry.name, directory:entry, entries:contents.entries, total:contents.total, truncated:contents.truncated}); }
      catch { columns.push({id:entry.id,title:entry.name,directory:entry,entries:[],total:null,status:'unavailable'}); }
    }
    columns.push({id:'desktop:loose-files',title:'桌面散文件',directory:top.directory,entries:loose,total:loose.length,truncated:false});
    const truncated = top.truncated || columns.some(column => column.truncated);
    const unavailable = columns.some(column => column.status === 'unavailable' || column.entries.some(entry=>entry.kind==='unavailable'));
    return {schema_version:'1.0',status:truncated || unavailable ? 'partial' : 'ok',root_label:'桌面',columns,hidden_files:'excluded',truncated,generated_at:top.generated_at};
  }
  async pathForId(id) {
    const known = this.known.get(id); if (!known) fail(404,'list_file_first');
    const entry = await this.locate(known.path);
    if (entryId(entry) !== id) fail(409,'file_changed_refresh_first');
    return entry.path;
  }
  async breadcrumbs(path) {
    const parts = path ? path.split('/') : []; const result = [];
    for (let index = 0; index <= parts.length; index++) {
      const file = await this.describe(await this.locate(parts.slice(0,index).join('/')));
      result.push({id:file.id,name:file.name});
    }
    return result;
  }
  async readChecked(entry, limit) {
    if (!entry.info.isFile()) fail(400, 'not_a_regular_file');
    const handle = await open(entry.resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat({bigint:true});
      if (!info.isFile() || stableId(info) !== stableId(entry.info) || fingerprint(info) !== fingerprint(entry.info)) fail(409, 'file_changed');
      if (info.size > BigInt(limit)) fail(413, 'preview_too_large');
      const buffer = Buffer.alloc(Number(info.size)); let offset = 0;
      while (offset < buffer.length) { const result = await handle.read(buffer,offset,buffer.length-offset,offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (fingerprint(await handle.stat({bigint:true})) !== fingerprint(info) || offset !== buffer.length) fail(409, 'file_changed');
      return buffer;
    } finally { await handle.close(); }
  }
  async preview(path) {
    const entry = await this.locate(path); const file = await this.describe(entry);
    if (entry.info.isDirectory()) return {kind:'directory',file,listing:await this.list(path)};
    if (!entry.info.isFile()) return {kind:'unsupported',file,message:'不是普通文件，未读取内容'};
    if (TEXT_EXTENSIONS.has(file.extension)) {
      if (entry.info.size > 1024n * 1024n) return {kind:'unsupported',file,message:'文本超过 1 MiB 安全预览上限，请在原应用打开'};
      const raw = await this.readChecked(entry,1024*1024);
      try {
        const text = new TextDecoder('utf-8',{fatal:true}).decode(raw);
        if (text.includes('\0')) throw new Error('binary');
        return {kind:'text',file,text,content_complete:true,active_content:false,message:['.html','.htm','.svg'].includes(file.extension) ? '仅显示源文本，不执行 HTML/SVG 内容' : ''};
      } catch { return {kind:'unsupported',file,message:'不是可安全显示的 UTF-8 文本，请在原应用打开'}; }
    }
    if (BINARY_TYPES[file.extension]) {
      if (entry.info.size > BigInt(this.maxPreviewBytes)) return {kind:'unsupported',file,message:'文件超过 20 MiB 安全预览上限，请在原应用打开'};
      return {kind:file.extension === '.pdf' ? 'pdf' : 'image',file,mime:BINARY_TYPES[file.extension],active_content:false};
    }
    return {kind:'unsupported',file,message:'当前本机桥不支持此格式的内嵌预览；可在原应用打开，摘要不是原文预览'};
  }
  async binary(path, version) {
    const entry = await this.locate(path);
    if (fingerprint(entry.info) !== version) fail(409,'file_changed');
    const mime = BINARY_TYPES[extname(path).toLowerCase()];
    if (!mime) fail(415,'not_a_safe_binary_preview');
    const buffer = await this.readChecked(entry,this.maxPreviewBytes);
    const magic = mime === 'application/pdf' ? buffer.subarray(0,5).toString() === '%PDF-' :
      mime === 'image/png' ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      mime === 'image/jpeg' ? buffer[0]===255 && buffer[1]===216 && buffer[2]===255 :
      mime === 'image/gif' ? ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString()) :
      mime === 'image/webp' ? buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP' : false;
    if (!magic) fail(415,'file_signature_mismatch');
    return {buffer,mime};
  }
  /** Not routed automatically. Caller must authenticate a same-origin POST and a direct user click. */
  async performFileAction(id, action, {confirmedByUser = false} = {}) {
    if (!confirmedByUser || !['open','reveal'].includes(action)) fail(403,'explicit_user_action_required');
    const known = this.known.get(id);
    if (!known) fail(404,'list_file_first');
    const entry = await this.locate(known.path);
    if (entryId(entry) !== id || fingerprint(entry.info) !== known.version) fail(409,'file_changed_refresh_first');
    if (action === 'open' && (!entry.info.isFile() || !OPEN_EXTENSIONS.has(extname(known.path).toLowerCase()))) fail(415,'only_document_open_is_allowed');
    await this.exec('/usr/bin/open',action === 'reveal' ? ['-R','--',entry.resolved] : ['--',entry.resolved],{timeout:5000,maxBuffer:4096});
    return {status:'requested',action,id};
  }
}
