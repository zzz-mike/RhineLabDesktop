import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {createIntegrationBridge,checkLocalRequest} from './integration-bridge.mjs';
const root=fileURLToPath(new URL('../RhineLabWallpaper/release/wallpaper/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.woff2':'font/woff2','.woff':'font/woff','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.txt':'text/plain; charset=utf-8','.pdf':'application/pdf'};
const macEntry='<script>if(new URLSearchParams(location.search).get("mac")==="1"){window.wallpaperPropertyListener.applyUserProperties({desktopmode:{value:"workbench"},language:{value:localStorage.getItem("rhine-mac-language")||"zh-CN"},audioreactive:{value:false},reactivemute:{value:false}});}</script>';
const integrationBridge=createIntegrationBridge({port:5180,enableFileActions:true});
const server=http.createServer({requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:5000},async(req,res)=>{
 try{
  try{checkLocalRequest(req,{port:5180,requireHeader:false});}catch{res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Local same-origin access only');return;}
  if(await integrationBridge(req,res))return;
  const url=new URL(req.url,'http://127.0.0.1:5180');
  if(url.pathname==='/__rhine_health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({app:'rhine-mac-local',commit:'ae2b2434ae18585aaf32458d9e9f9aaaa480ce56',integration_version:'1.0'}));return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end();return;}
  const resolvedRoot=await realpath(root), resolvedPath=await realpath(path);
  if(!resolvedPath.startsWith(resolvedRoot+sep)){res.writeHead(403);res.end();return;}
  const info=await stat(path);if(!info.isFile())throw new Error('not a file');
  const headers={'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
  if(path===resolve(root,'index.html')){const html=(await readFile(path,'utf8')).replace('</head>',macEntry+'</head>');res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:html);return;}
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  let start=0,end=info.size-1,status=200;
  if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;}
  res.writeHead(status,{...headers,'Accept-Ranges':'bytes','Content-Length':end-start+1});
  if(req.method==='HEAD')res.end();else createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(5180,'127.0.0.1',()=>console.log('莱茵终端：http://127.0.0.1:5180/?mac=1（仅本机）'));
