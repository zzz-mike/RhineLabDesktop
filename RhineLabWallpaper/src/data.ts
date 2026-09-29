import content from "../content/archives.json" with { type: "json" };
import english from "../content/archives.en.json" with { type: "json" };
import { language, localeEvent } from "./i18n";
import type { DesktopCatalog, DesktopFile } from './desktop-files';

import { desktopConnected } from './release-access';
export const desktopArchiveMode = desktopConnected;

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  file?: DesktopFile;
  placeholder?: boolean;
}

// Preserve record object identities and array indices used by the live scene.
// Navigation always uses the canonical source; translated labels are display data.
const demonstrationRecords: ArchiveRecord[] = content.records.map((record, index) =>
  Object.defineProperties({}, Object.fromEntries(Object.keys(record).map(key => [key, {
    enumerable: true,
    get: () => (language() === "en-US" ? english.records[index] : record)[key as keyof typeof record],
  }]))) as ArchiveRecord,
);
const unavailable = (message: string): ArchiveRecord => ({ id: 'desktop:unavailable', title: '桌面文件', en: 'LOCAL DESKTOP', department: '本机桌面', category: '桌面状态', date: '未读取', lead: '本机只读', clearance: '未连接', abstract: message, findings: [], source: '', placeholder: true });
export const records: ArchiveRecord[] = desktopArchiveMode ? [unavailable('正在读取本机桌面；不会以演示档案替代真实文件。')] : demonstrationRecords;
const categorySets = [["全部档案", ...content.categories], ["All archives", ...english.categories]];
export const categories = desktopArchiveMode ? ['全部档案', '桌面状态'] : [...categorySets[0]];
export const archiveColumns = desktopArchiveMode ? ['桌面状态'] : [...content.columns];
let desktopLanes: number[][] = [[0]];
// The original 32-slot encoding only had room for 20 children after row 12.
// Real folders may be longer; keep their canonical slot addresses reversible.
let desktopSlotStride = 32;
export const categoryIndex = (value: string) => desktopArchiveMode ? categories.indexOf(value) : Math.max(...categorySets.map(set => set.indexOf(value)));
window.addEventListener(localeEvent, () => {
  if (desktopArchiveMode) return;
  categories.splice(0, categories.length, ...categorySets[language() === "en-US" ? 1 : 0]);
  archiveColumns.splice(0, archiveColumns.length, ...(language() === "en-US" ? english.columns : content.columns));
});

export function columnFiles(lane: number) {
  if (desktopArchiveMode) return desktopLanes[lane] ?? [0];
  return content.records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === content.columns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  if (desktopArchiveMode) {
    const lane = Math.max(0, desktopLanes.findIndex(files => files.includes(index)));
    const row = 12 + columnFiles(lane).indexOf(index);
    return { lane, row, slot: lane * desktopSlotStride + row };
  }
  const lane = content.columns.indexOf(content.records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}

/** Called only after main has safely released the previous 3D array. */
export function applyDesktopCatalog(catalog: DesktopCatalog): void {
  if (!desktopArchiveMode) return;
  const next: ArchiveRecord[] = [], lanes: number[][] = [], names: string[] = [];
  for (const column of catalog.columns) {
    const entries = column.entries.length ? column.entries : [column.directory];
    if (!entries[0]) continue;
    const indices: number[] = []; names.push(column.title);
    for (const file of entries) {
      const emptyDirectory = column.entries.length === 0;
      indices.push(next.length);
      next.push({ id: file.id, title: file.name, en: file.kind === 'directory' ? 'LOCAL FOLDER' : 'LOCAL FILE',
        department: column.title, category: column.title, date: file.modified_at || '修改时间未知', lead: '本机只读',
        clearance: emptyDirectory ? (column.status === 'unavailable' ? '目录不可读取' : column.truncated ? '目录未完整读取' : '无可显示子项') : file.kind === 'unavailable' ? '不可读取' : file.kind === 'directory' ? '文件夹' : '真实文件',
        abstract: emptyDirectory ? '这是对应目录本身；当前没有可显示的直接子项，并非额外虚构文件。' : file.summary?.text || '打开档案可预览真实内容；摘要尚未抽取。',
        findings: [column.truncated ? '该列有截断，不能视为完整目录。' : '一级文件夹对应列，直接子项对应档案；更深目录在预览内浏览。'],
        source: '', file });
    }
    lanes.push(indices);
  }
  if (!next.length) { setDesktopUnavailable(catalog.message || '桌面目录未返回可显示内容。'); return; }
  records.splice(0, records.length, ...next); archiveColumns.splice(0, archiveColumns.length, ...names);
  categories.splice(0, categories.length, '全部档案', ...names); desktopLanes = lanes;
  desktopSlotStride = Math.max(32, ...lanes.map(files => 12 + files.length));
}
export function setDesktopUnavailable(message: string): void {
  if (!desktopArchiveMode) return;
  records.splice(0, records.length, unavailable(message));
  archiveColumns.splice(0, archiveColumns.length, '桌面状态'); categories.splice(0, categories.length, '全部档案', '桌面状态'); desktopLanes = [[0]]; desktopSlotStride = 32;
}
export const archiveDisplayNumber = (index: number) => desktopArchiveMode ? String(index + 1).padStart(3, '0') : records[index].id.replace(/^X-/, '');
export function fileAtSlot(slot: number) {
  if (desktopArchiveMode) {
    const files = columnFiles(Math.floor(slot / desktopSlotStride));
    return files[Math.max(0, Math.min(files.length - 1, (slot % desktopSlotStride) - 12))];
  }
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
