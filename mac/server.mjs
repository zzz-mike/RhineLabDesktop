import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
import {createIntegrationBridge} from './integration-bridge.mjs';
import {DesktopFiles} from './desktop-files.mjs';
import {AccessState} from './access.mjs';
import {accessPage} from './access-page.mjs';
import {localRequest,serveAssets,json,headers} from '../runtime/static-server.mjs';

async function readJSON(req) {
  if(req.headers['content-type']!=='application/json' || req.headers['transfer-encoding'])throw Error('invalid_request');
  if(Number(req.headers['content-length'])>8192)throw Error('request_too_large');
  let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>8192)throw Error('request_too_large');}
  return JSON.parse(body);
}
export function createLocalServer({root=fileURLToPath(new URL('../RhineLabWallpaper/release/wallpaper/',import.meta.url)),picker,filesFactory=path=>new DesktopFiles({root:path,summaryPath:null,rootLabel:basename(path)}),bridgeFactory=createIntegrationBridge}={}) {
  const activeResponses=new Set();let bridge=null;
  const access=new AccessState({picker,onChange:()=>{
    bridge=null;
    for(const res of activeResponses)res.destroy();activeResponses.clear();
  }});
  const server=http.createServer(async(req,res)=>{
    const port=server.address().port;
    if(!localRequest(req,port)){json(res,403,{error:'local_only'});return;}
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    try {
      if(url.pathname.startsWith('/api/access/')) {
        const write=req.method==='POST';
        if(!localRequest(req,port,{write,header:true}) || (write&&!access.authorized(req.headers['x-rhine-consent']))){json(res,403,{error:'consent_required'});return;}
        if(url.search){json(res,400,{error:'invalid_request'});return;}
        if(req.method==='GET' && url.pathname==='/api/access/state'){json(res,200,access.snapshot());return;}
        if(!write){json(res,405,{error:'method_not_allowed'});return;}
        const body=await readJSON(req);
        if(['/api/access/select','/api/access/revoke'].includes(url.pathname) && (!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length))throw Error('invalid_request');
        if(url.pathname==='/api/access/select'){json(res,200,await access.select());return;}
        if(url.pathname==='/api/access/options'){json(res,200,access.update(body));return;}
        if(url.pathname==='/api/access/revoke'){json(res,200,access.revoke());return;}
        json(res,404,{error:'not_found'});return;
      }
      if(url.pathname==='/connections') {
        if(req.method!=='GET'){json(res,405,{error:'method_not_allowed'});return;}
        res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(accessPage(access.token));return;
      }
      if(url.pathname==='/__rhine_health'){json(res,200,{app:'rhine-mac-local',edition:'local',version:'0.2.1',desktop_connected:!!access.root});return;}
      if(url.pathname.startsWith('/api/')) {
        const service=url.pathname.split('/')[2];const enabled=service==='desktop'?!!access.root:access.flags[service];
        if(service!=='local' && !enabled){json(res,403,{error:'connection_disabled',code:'connection_disabled'});return;}
        if(!bridge)bridge=bridgeFactory({files:access.root?filesFactory(access.root):null,port,enableFileActions:access.flags.file_actions,permissions:{desktop:!!access.root,...access.flags}});
        activeResponses.add(res);res.on('close',()=>activeResponses.delete(res));
        if(await bridge(req,res))return;
        json(res,404,{error:'not_found'});return;
      }
      const flags=JSON.stringify(access.snapshot()).replaceAll('<','\\u003c');
      const inject=`<script>window.__RHINE_ACCESS__=${flags};window.wallpaperPropertyListener?.applyUserProperties({desktopmode:{value:"workbench"},language:{value:localStorage.getItem("rhine-mac-language")||"zh-CN"},audioreactive:{value:false},reactivemute:{value:false}});</script>`;
      await serveAssets(req,res,{root,inject});
    } catch(error) {
      if(!res.destroyed&&!res.headersSent){const known=new Set(['folder_picker_unavailable','choose_specific_folder','selection_cancelled','selection_in_progress','select_folder_first','invalid_permissions','invalid_request','request_too_large','not_a_directory']);json(res,400,{error:known.has(error.message)?error.message:'operation_failed'});}
      else if(!res.destroyed)res.destroy();
    }
  });
  server.requestTimeout=130000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.on('close',()=>access.revoke());
  return {server,access};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.platform!=='darwin'){console.error('本地接入版当前仅支持 macOS；Windows 请使用纯展示版。');process.exitCode=1;}
  else {
    const {server}=createLocalServer();
    server.on('error',()=>{console.error('启动失败：请检查 5191 端口是否已占用。');process.exitCode=1;});
    server.listen(5191,'127.0.0.1',()=>console.log('莱茵终端：http://127.0.0.1:5191/?mac=1；授权管理：http://127.0.0.1:5191/connections（默认全部关闭）'));
  }
}
