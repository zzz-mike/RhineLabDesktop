import {escapeHtml} from './html';
import {durationText} from './workbench-state';
export type MacMedia = {
  status:'ok'|'idle'|'error'|'unsupported';title:string|null;artist:string|null;album:string|null;source:string|null;
  playing:boolean|null;position_seconds:number|null;duration_seconds:number|null;playback_rate:number|null;
  artwork_url:string|null;observed_at:string;message:string;
};
export async function fetchMacMedia():Promise<MacMedia>{
  const response=await fetch('/api/media/v1/state',{headers:{'X-Rhine-Local':'1'},cache:'no-store',signal:AbortSignal.timeout(4500)});
  if(!response.ok)throw Error('media unavailable');
  const value=await response.json();
  if(!value||!['ok','idle','error','unsupported'].includes(value.status))throw Error('invalid media state');
  return value;
}
const apps:Record<string,string>={'com.bilibili.bilibiliPC':'哔哩哔哩','com.apple.Music':'音乐','com.spotify.client':'Spotify','com.google.Chrome':'Google Chrome','com.apple.Safari':'Safari','com.apple.QuickTimePlayerX':'QuickTime Player'};
export function macMediaMarkup(media:MacMedia|null,now=Date.now()){
  if(!media)return '<p class="wb-empty">正在连接 macOS 播放信息…</p>';
  if(media.status!=='ok'){
    const label={idle:'系统未提供当前媒体',error:'播放信息暂时不可用',unsupported:'媒体读取工具不可用'}[media.status];
    return `<p class="wb-empty">${label}</p><p class="wb-muted">${escapeHtml(media.message)}</p>`;
  }
  const source=media.source?(apps[media.source]??media.source):'macOS';
  const state=media.playing===true?'正在播放':media.playing===false?'已暂停或停止':'播放状态未提供';
  const cover=media.artwork_url;
  const image=typeof cover==='string'&&cover.length<=2_000_100&&/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(cover)?`<img src="${escapeHtml(cover)}" alt="媒体封面"/>`:'<div class="wb-cover" aria-hidden="true">♫</div>';
  let position=media.position_seconds;const duration=media.duration_seconds;
  if(typeof position==='number'&&Number.isFinite(position)){
    const age=Math.max(0,now-Date.parse(media.observed_at))/1000;
    if(media.playing===true&&Number.isFinite(age)&&age<=15)position+=age*(media.playback_rate??1);
    position=Math.max(0,position);if(typeof duration==='number'&&duration>0)position=Math.min(position,duration);
  }
  const timeline=typeof duration==='number'&&Number.isFinite(duration)&&duration>0&&typeof position==='number'&&Number.isFinite(position)?`<div class="wb-rule"><i style="width:${Math.max(0,Math.min(100,position/duration*100))}%"></i></div><p class="wb-muted"><span data-wb-roll>${durationText(position*1000)}</span> / <span data-wb-roll>${durationText(duration*1000)}</span></p>`:'';
  return `<div class="wb-media">${image}<div><small>${state} · ${escapeHtml(source)}</small><h3 data-wb-roll>${escapeHtml(media.title||'播放器未提供标题')}</h3><p data-wb-roll>${escapeHtml(media.artist||media.album||'')}</p></div></div>${timeline}<p class="wb-muted">已连接 macOS · 随系统媒体更新</p>`;
}
