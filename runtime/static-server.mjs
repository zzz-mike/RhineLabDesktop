import http from 'node:http';
import {readFile, stat, realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve, relative, isAbsolute, extname, sep} from 'node:path';

export const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
export function localRequest(req, port, {write=false, header=false}={}) {
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) return false;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  if(req.headers.origin && req.headers.origin!==`http://${host}`) return false;
  if(write && req.headers.origin!==`http://${host}`) return false;
  if(req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))return false;
  if(header && req.headers['x-rhine-local']!=='1')return false;
  for(const key of ['host','origin','content-length','transfer-encoding','x-rhine-local','x-rhine-consent']) {
    if(req.rawHeaders.filter((v,i)=>i%2===0 && v.toLowerCase()===key).length>1)return false;
  }
  return true;
}
export function json(res,status,value) {res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
export function isInside(root,path) {const rel=relative(root,path);return rel!=='' && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel);}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.woff2':'font/woff2','.woff':'font/woff','.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.pdf':'application/pdf','.ogg':'audio/ogg','.ico':'image/x-icon'};
export async function serveAssets(req,res,{root,inject=''}) {
  if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'method_not_allowed'});return;}
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.includes('\\') || pathname.includes('\0'))throw Error('invalid path');
    const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!isInside(resolve(root),file))throw Error('outside root');
    const resolvedRoot=await realpath(root), resolved=await realpath(file);
    if(!isInside(resolvedRoot,resolved))throw Error('outside root');
    const info=await stat(resolved);if(!info.isFile())throw Error('not file');
    const base={...headers,'Content-Type':types[extname(resolved)]||'application/octet-stream'};
    if(file===resolve(root,'index.html')) {
      const html=(await readFile(resolved,'utf8')).replace('</head>',inject+'</head>');
      res.writeHead(200,base);res.end(req.method==='HEAD'?undefined:html);return;
    }
    let start=0,end=info.size-1,status=200;
    if(req.headers.range) {
      const match=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);
      if(!match){res.writeHead(416,base);res.end();return;}
      start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);
      if(start>end || start>=info.size){res.writeHead(416,{...base,'Content-Range':`bytes */${info.size}`});res.end();return;}
      status=206;base['Content-Range']=`bytes ${start}-${end}/${info.size}`;
    }
    res.writeHead(status,{...base,'Content-Length':Math.max(0,end-start+1),'Accept-Ranges':'bytes'});
    if(req.method==='HEAD' || info.size===0){res.end();return;}
    const stream=createReadStream(resolved,{start,end});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
  } catch {if(!res.headersSent)json(res,404,{error:'not_found'});else res.destroy();}
}
export function createDisplayServer({root}={}) {
  const server=http.createServer(async(req,res)=>{
    const port=server.address().port;
    if(!localRequest(req,port)){json(res,403,{error:'local_only'});return;}
    if(new URL(req.url,'http://localhost').pathname.startsWith('/api/')){json(res,404,{error:'display_has_no_local_integrations'});return;}
    if(req.url==='/__rhine_health'){json(res,200,{edition:'display',version:'0.2.0',local_files:false});return;}
    await serveAssets(req,res,{root,inject:'<script>window.wallpaperPropertyListener?.applyUserProperties({desktopmode:{value:"workbench"},language:{value:"zh-CN"},audioreactive:{value:false},reactivemute:{value:false}});</script>'});
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;return server;
}
