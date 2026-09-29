import {access} from 'node:fs/promises';
import {platform} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
export const mediaBinary=fileURLToPath(new URL('../.runtime/media-control/media-control/0.7.7/bin/media-control',import.meta.url));
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
export async function mediaAvailable(){return platform()==='darwin'&&await exists(mediaBinary);}
const text=v=>typeof v==='string'?v.slice(0,2048):null;
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const caps=read=>({read,play:false,pause:false,next:false,previous:false,seek:false});
function artwork(v){
 const data=v?.artworkData;if(typeof data!=='string'||data.length>2_000_000||!/^[A-Za-z0-9+/=\r\n]+$/.test(data))return null;
 const bytes=Buffer.from(data,'base64');let mime=null;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';
 return mime?`data:${mime};base64,${bytes.toString('base64')}`:null;
}
export function normalizeMedia(raw,now=Date.now()){
 if(raw!==null&&(typeof raw!=='object'||Array.isArray(raw)))throw Error('invalid media response');
 const base={schema_version:'1.0',status:'idle',source:null,title:null,artist:null,album:null,artwork_url:null,playing:null,position_seconds:null,duration_seconds:null,playback_rate:null,updated_at:null,observed_at:new Date(now).toISOString(),capabilities:caps(true),message:'系统当前没有提供媒体信息；这不代表所有应用都没有声音。'};
 if(!raw||!Object.keys(raw).length)return base;
 const duration=number(raw.duration),playing=typeof raw.playing==='boolean'?raw.playing:null;
 const stamp=typeof raw.timestamp==='string'&&Number.isFinite(Date.parse(raw.timestamp))?raw.timestamp:null;
 const rate=number(raw.playbackRate)??(playing===true?1:0);
 let position=number(raw.elapsedTimeNow)??number(raw.elapsedTime);
 if(number(raw.elapsedTimeNow)===null&&position!==null&&playing===true&&stamp)position+=Math.max(0,now-Date.parse(stamp))/1000*rate;
 if(position!==null&&duration!==null&&duration>0)position=Math.min(position,duration);
 return {...base,status:'ok',source:text(raw.bundleIdentifier),title:text(raw.title),artist:text(raw.artist),album:text(raw.album),playing,playback_rate:rate,position_seconds:position,duration_seconds:duration,updated_at:stamp,artwork_url:artwork(raw),message:'来自 macOS 系统媒体信息'};
}
export function createMediaReader({system=platform(),exists:available=exists,run=execute,now=Date.now,ttl=4000}={}){
 let cached=null,checked=0,pending=null;
 return async()=>{
  if(cached&&now()-checked<ttl)return cached;
  if(pending)return pending;
  pending=(async()=>{
   const base=normalizeMedia(null,now());
   if(system!=='darwin'||!await available(mediaBinary))return {...base,status:'unsupported',capabilities:caps(false),message:'本机媒体读取工具未安装或当前系统不受支持，无法判断播放状态。'};
   try{
    const {stdout}=await run(mediaBinary,['get','--now'],{timeout:3500,maxBuffer:4*1024*1024,encoding:'utf8'});
    return normalizeMedia(JSON.parse(stdout),now());
   }catch{return {...base,status:'error',message:'暂时无法读取 macOS 媒体信息；稍后自动重试。'};}
  })();
  try{cached=await pending;checked=now();return cached;}finally{pending=null;}
 };
}
export const readMediaState=createMediaReader();
