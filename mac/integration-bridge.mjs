import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {DesktopFiles,FileBridgeError} from './desktop-files.mjs';
import {readMediaState,mediaAvailable} from './media-state.mjs';
import {createSolarReader} from './solar-bridge.mjs';

const WIDGETS = new Set(['catalog','revision','item','items','item-detail','project-detail','priorities','todo','triage','projects','today','schedule','solar.generation','solar.trend','solar.devices','solar.alerts','solar.revenue']);
export const SECRETARY_TIMEOUT_MS = 10000;
const BASE_HEADERS = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
const reject = (status,code) => { throw new FileBridgeError(status,code); };
const json = (res,status,data) => {res.writeHead(status,{...BASE_HEADERS,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};

export function checkLocalRequest(req,{port=5180,requireHeader=true,requireOrigin=false}={}) {
  const rawNames = (req.rawHeaders || []).filter((_,index)=>index%2===0).map(name=>name.toLowerCase());
  for (const name of ['host','origin','sec-fetch-site','x-rhine-local','x-rhine-action-token','content-length','content-type','transfer-encoding']) if(rawNames.filter(value=>value===name).length>1)reject(400,'duplicate_security_header');
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) reject(403,'invalid_local_host');
  const peer = req.socket?.remoteAddress;
  if (peer && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)) reject(403,'local_only');
  const origin = req.headers.origin;
  if ((origin && origin !== `http://${host}`) || (requireOrigin && !origin)) reject(403,'same_origin_required');
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin','none'].includes(site)) reject(403,'cross_site_denied');
  if (requireHeader && req.headers['x-rhine-local'] !== '1') reject(403,'local_ui_header_required');
}

export function secretaryTarget(url) {
  const match = url.pathname.match(/^\/api\/secretary\/widgets\/v1\/([a-z.-]+)$/);
  if (!match || !WIDGETS.has(match[1])) reject(404,'secretary_route_not_allowed');
  if (url.hash) reject(400,'invalid_widget_query');
  const route=match[1];
  const pageKeys=['limit','offset','snapshot_revision'];
  const allowed=route==='item'?['item_id']:route==='items'?['query','status','project_id',...pageKeys]:route==='item-detail'?['item_id','section',...pageKeys]:route==='project-detail'?['project_id','section',...pageKeys]:['project_id',...pageKeys];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) reject(400,'invalid_widget_query');
  }
  const project = url.searchParams.get('project_id'); const limit = url.searchParams.get('limit');
  if (project !== null && (project.length > 240 || /[\x00-\x1f\x7f]/.test(project))) reject(400,'invalid_project_id');
  const maxLimit=route==='items'?50:route.endsWith('-detail')?30:100;
  if (limit !== null && (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit)>maxLimit)) reject(400,'invalid_limit');
  const offset=url.searchParams.get('offset'),revision=url.searchParams.get('snapshot_revision');
  if(offset!==null && (!/^(0|[1-9][0-9]{0,6})$/.test(offset) || Number(offset)>1000000))reject(400,'invalid_offset');
  if(revision!==null && !boundedText(revision,128))reject(400,'invalid_snapshot_revision');
  if(['item','item-detail'].includes(route) && !boundedText(url.searchParams.get('item_id'),240))reject(400,'invalid_item_id');
  if(route==='project-detail' && !boundedText(project,240))reject(400,'invalid_project_id');
  if(route==='items') {
    const query=url.searchParams.get('query'),status=url.searchParams.get('status');
    if(query!==null && !boundedText(query,120,{empty:true}))reject(400,'invalid_widget_query');
    if(status!==null && !['all','active','waiting','observing','completed','cancelled'].includes(status))reject(400,'invalid_status');
  }
  const section=url.searchParams.get('section');
  if(section!==null && !(route==='item-detail'?['overview','evidence','history']:['overview','progress','items','conversation','files','finance']).includes(section))reject(400,'invalid_widget_query');
  if (['catalog','revision'].includes(route) && [...url.searchParams].length) reject(400,`${route}_has_no_query`);
  return `/api/widgets/v1/${match[1]}${url.search}`;
}

const boundedText=(value,max,{empty=false}={})=>typeof value==='string' && (empty || value.length>0) && [...value].length<=max && !/[\x00-\x1f\x7f]/.test(value);
const UPSTREAM_ERROR_CODES=new Set(['snapshot_changed','revision_conflict','request_id_conflict','item_not_found','invalid_review','invalid_request_id','invalid_item_id','invalid_revision','invalid_status','invalid_project','invalid_field','invalid_action','invalid_json','invalid_widget_query','invalid_project_id','invalid_limit','invalid_offset','invalid_snapshot_revision','review_token_required','invalid_review_token','review_session_denied','project_not_found','undo_unavailable','nothing_to_undo','body_too_large','body_timeout','json_required','length_required','same_origin_required','local_only','duplicate_security_header','unsupported_transfer_encoding','secretary_unavailable','invalid_request','source_changing','source_unavailable','review_failed','invalid_origin','invalid_query','invalid_body','invalid_content_type']);
UPSTREAM_ERROR_CODES.add('note_redacted');
function safeUpstreamResult(status,data) {
  if(status===200)return {status,data};
  const code=UPSTREAM_ERROR_CODES.has(data?.code)?data.code:'secretary_request_failed';
  const safe={error:code,code};
  if(status===409 && code==='revision_conflict' && data.current_item && typeof data.current_item==='object' && !Array.isArray(data.current_item))safe.current_item=data.current_item;
  if(status===409 && ['revision_conflict','note_redacted'].includes(code) && data.current_project && typeof data.current_project==='object' && !Array.isArray(data.current_project)) {
    const p=data.current_project;
    safe.current_project={project_id:p.project_id,project_name:p.project_name,review_revision:p.review_revision,pinned:p.pinned,note_redacted:p.note_redacted===true,
      note:Object.fromEntries(['stage','blocker','next_step','owner'].map(key=>[key,typeof p.note?.[key]==='string'?p.note[key]:'']))};
  }
  return {status:status>=400 && status<=599?status:502,data:safe};
}

/** Fixed loopback upstream. No proxy environment, redirects, credential forwarding, or arbitrary URL. */
export function fetchSecretary(path,{timeout=SECRETARY_TIMEOUT_MS,maxBytes=2*1024*1024}={}) {
  // Revalidate even direct callers, not only the route adapter.
  if(typeof path!=='string' || !path.startsWith('/api/widgets/v1/'))reject(404,'secretary_route_not_allowed');
  const target = secretaryTarget(new URL(path.replace(/^\/api\/widgets\//,'/api/secretary/widgets/'),'http://127.0.0.1:5180'));
  return requestSecretary('GET',target,{timeout,maxBytes});
}

function requestSecretary(method,path,{timeout=SECRETARY_TIMEOUT_MS,maxBytes=2*1024*1024,body,token}={}) {
  const session=method==='GET' && path==='/api/widgets/v1/review-session';
  const projectReview=method==='POST' && path==='/api/widgets/v1/project-review';
  const review=projectReview || (method==='POST' && path==='/api/widgets/v1/review');
  if(!session && !review) {
    if(method!=='GET' || typeof path!=='string' || !path.startsWith('/api/widgets/v1/'))reject(404,'secretary_route_not_allowed');
    secretaryTarget(new URL(path.replace(/^\/api\/widgets\//,'/api/secretary/widgets/'),'http://127.0.0.1:5180'));
  }
  const encoded=review?JSON.stringify(projectReview?validateProjectReviewBody(body):validateReviewBody(body)):undefined;
  if(encoded && Buffer.byteLength(encoded)>(projectReview?16384:4096))reject(413,'body_too_large');
  if(review && !boundedText(token,512))reject(502,'invalid_review_session');
  const headers={Accept:'application/json',...(session?{'X-Rhine-Bridge':'1'}:{}),...(review?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded),'X-Widget-Review-Token':token}:{})};
  return new Promise((resolve,rejectPromise) => {
    let settled = false;
    const finish = (error,result) => {if(settled)return;settled=true;clearTimeout(timer);error?rejectPromise(error):resolve(result);};
    const request = http.request({hostname:'127.0.0.1',port:8866,path,method,headers},response => {
      if (response.statusCode >=300 && response.statusCode<400) {response.resume();finish(new FileBridgeError(502,'upstream_redirect_denied'));return;}
      if (!String(response.headers['content-type'] || '').startsWith('application/json')) {response.resume();finish(new FileBridgeError(502,'upstream_not_json'));return;}
      let bytes=0;const chunks=[];
      response.on('data',chunk => {bytes+=chunk.length;if(bytes>maxBytes){response.destroy();finish(new FileBridgeError(502,'upstream_too_large'));}else chunks.push(chunk);});
      response.on('end',() => {try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('schema');if(response.statusCode===200 && data.schema_version!=='1.0')throw new Error('schema');finish(null,safeUpstreamResult(response.statusCode,data));}catch{finish(new FileBridgeError(502,'upstream_invalid_json'));}});
      response.on('error',() => finish(new FileBridgeError(502,'secretary_unavailable')));
      response.on('aborted',() => finish(new FileBridgeError(502,'secretary_unavailable')));
    });
    const timer=setTimeout(()=>{request.destroy();finish(new FileBridgeError(504,'secretary_timeout'));},timeout);
    request.on('error',()=>finish(new FileBridgeError(502,'secretary_unavailable')));request.end(encoded);
  });
}

export function validateReviewBody(body) {
  if(!body || typeof body!=='object' || Array.isArray(body))reject(400,'invalid_review');
  const extra={status:'status',project:'project',undo:'field'}[body.action];
  const keys=['request_id','item_id','expected_revision','action',extra];
  if(!extra || Object.keys(body).length!==5 || Object.keys(body).some(key=>!keys.includes(key)))reject(400,'invalid_review');
  if(typeof body.request_id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))reject(400,'invalid_request_id');
  if(!boundedText(body.item_id,240))reject(400,'invalid_item_id');
  if(!boundedText(body.expected_revision,128))reject(400,'invalid_revision');
  if(body.action==='status' && !['active','completed','cancelled','observing'].includes(body.status))reject(400,'invalid_status');
  if(body.action==='project' && !boundedText(body.project,100,{empty:true}))reject(400,'invalid_project');
  if(body.action==='undo' && !['status','project'].includes(body.field))reject(400,'invalid_field');
  return body;
}

/** Session credentials stay in this server-side closure, separate from browser nonces. */
export function createSecretaryReviewClient({transport=requestSecretary,timeout=SECRETARY_TIMEOUT_MS,project=false}={}) {
  let cachedToken=null,pendingSession=null;
  const remaining=deadline=>{const left=deadline-Date.now();if(left<=0)reject(504,'secretary_timeout');return left;};
  const getToken=async deadline=>{
    if(cachedToken)return cachedToken;
    if(!pendingSession)pendingSession=(async()=>{
      const result=await transport('GET','/api/widgets/v1/review-session',{timeout:remaining(deadline)});
      if(result.status!==200){const safe=safeUpstreamResult(result.status,result.data);reject(safe.status,safe.data.code);}
      if(result.data?.schema_version!=='1.0' || result.data?.scope!=='widgets:review' || !boundedText(result.data?.review_token,512))reject(502,'invalid_review_session');
      cachedToken=result.data.review_token;return cachedToken;
    })().finally(()=>{pendingSession=null;});
    return pendingSession;
  };
  return async body=>{
    // Snapshot the validated intent before the first await; retries use the same payload.
    const validated=project?validateProjectReviewBody(body):validateReviewBody(body);
    const intent=Object.freeze({...validated,...(validated.note?{note:Object.freeze({...validated.note})}:{})});
    const endpoint=project?'/api/widgets/v1/project-review':'/api/widgets/v1/review';
    const deadline=Date.now()+timeout;
    const token=await getToken(deadline);
    let result=await transport('POST',endpoint,{body:intent,token,timeout:remaining(deadline)});
    if(result.status===403){
      if(cachedToken===token)cachedToken=null;
      result=await transport('POST',endpoint,{body:intent,token:await getToken(deadline),timeout:remaining(deadline)});
    }
    return safeUpstreamResult(result.status,result.data);
  };
}

export function validateProjectReviewBody(body) {
  if(!body || typeof body!=='object' || Array.isArray(body))reject(400,'invalid_review');
  const extra={note:'note',pin:'pinned'}[body.action];
  const keys=['request_id','project_id','expected_revision','action',extra];
  if(!extra || Object.keys(body).length!==5 || Object.keys(body).some(key=>!keys.includes(key)))reject(400,'invalid_review');
  if(typeof body.request_id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))reject(400,'invalid_request_id');
  if(!boundedText(body.project_id,240))reject(400,'invalid_project_id');
  if(!boundedText(body.expected_revision,128))reject(400,'invalid_revision');
  if(body.action==='pin' && typeof body.pinned!=='boolean')reject(400,'invalid_action');
  if(body.action==='note') {
    const fields=['stage','blocker','next_step','owner'];
    if(!body.note || typeof body.note!=='object' || Array.isArray(body.note) || Object.keys(body.note).length!==4 || Object.keys(body.note).some(key=>!fields.includes(key)))reject(400,'invalid_field');
    // Multiline business notes are text, never path/command parameters.
    for(const value of Object.values(body.note))if(typeof value!=='string' || [...value].length>2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))reject(400,'invalid_field');
  }
  return body;
}

/** Share only pending reads across tabs; never keep an old business response. */
export function coalesceReads(read,{maxPending=64}={}) {
  const pending=new Map();
  let epoch=0;
  const shared=async key=>{
    const flightKey=JSON.stringify([epoch,key]);
    if(pending.has(flightKey))return pending.get(flightKey);
    if(pending.size>=maxPending)reject(503,'request_queue_full');
    const flight=Promise.resolve().then(()=>read(key));
    pending.set(flightKey,flight);
    try{return await flight;}finally{if(pending.get(flightKey)===flight)pending.delete(flightKey);}
  };
  // Keep old flights counted until they finish, but never attach a new
  // post-action reader to a pre-action snapshot. No business state is cached.
  shared.invalidate=()=>{++epoch;};
  return shared;
}

async function readBody(req,{strict=false,maxBytes=4096}={}) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type'] || ''))) reject(415,'json_required');
  if(strict && req.headers['transfer-encoding']!==undefined)reject(400,'unsupported_transfer_encoding');
  if(strict && req.headers['content-length']===undefined)reject(411,'length_required');
  const declared=req.headers['content-length'];if(declared!==undefined && (!/^\d+$/.test(declared) || Number(declared)>maxBytes))reject(413,'body_too_large');
  return await new Promise((resolve,rejectPromise)=>{
    let length=0;const chunks=[];let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);req.off('data',onData);req.off('end',onEnd);req.off('aborted',onAbort);req.off('error',onAbort);error?rejectPromise(error):resolve(value);};
    const onData=chunk=>{length+=chunk.length;if(length>maxBytes){req.resume();finish(new FileBridgeError(413,'body_too_large'));}else chunks.push(chunk);};
    const onEnd=()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(new FileBridgeError(400,'invalid_json'));}};
    const onAbort=()=>finish(new FileBridgeError(400,'request_aborted'));
    const timer=setTimeout(()=>{req.resume();finish(new FileBridgeError(408,'body_timeout'));},5000);
    req.on('data',onData);req.on('end',onEnd);req.on('aborted',onAbort);req.on('error',onAbort);
  });
}
const oneId = url => {if([...url.searchParams.keys()].some(k=>k!=='id') || url.searchParams.getAll('id').length!==1)reject(400,'id_required');return url.searchParams.get('id');};

/** Install by awaiting handler(req,res) before the existing static routes; true means handled. */
export function createIntegrationBridge({files=new DesktopFiles(),port=5180,secretary=fetchSecretary,secretaryReview=createSecretaryReviewClient(),secretaryProjectReview=createSecretaryReviewClient({project:true}),solar=createSolarReader(),media=readMediaState,enableFileActions=false,permissions={desktop:true,secretary:true,solar:true,media:true}}={}) {
  const actionToken=randomBytes(32).toString('hex'); const reviewToken=randomBytes(32).toString('hex'); const previews=new Map();
  const readSecretary=coalesceReads(secretary);
  return async function handle(req,res) {
    if (!/^\/api\/(secretary|solar|desktop|media|local)\//.test(req.url || '')) return false;
    try {
      if ((req.url || '').length>8192) reject(414,'url_too_long');
      const url=new URL(req.url,`http://127.0.0.1:${port}`);
      const binary=url.pathname==='/api/desktop/v1/content';
      checkLocalRequest(req,{port,requireHeader:!binary,requireOrigin:req.method==='POST'});
      if(req.method==='POST' && ['/api/secretary/widgets/v1/review','/api/secretary/widgets/v1/project-review'].includes(url.pathname)) {
        if(url.search)reject(400,'no_query_allowed');
        const supplied=Buffer.from(String(req.headers['x-rhine-action-token'] || ''));
        const expected=Buffer.from(reviewToken);
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))reject(403,'invalid_action_token');
        const project=url.pathname.endsWith('/project-review');
        const raw=await readBody(req,{strict:true,maxBytes:project?16384:4096});
        const body=project?validateProjectReviewBody(raw):validateReviewBody(raw);
        let result;
        try {
          result=await (project?secretaryProjectReview:secretaryReview)(body);
        } finally {
          // A timeout can follow a successful commit; conflicts also mean the
          // source changed. Subsequent reads must use a fresh source request.
          readSecretary.invalidate();
        }
        const safe=safeUpstreamResult(result.status,result.data);
        json(res,safe.status,safe.data);return true;
      }
      if(req.method==='POST' && url.pathname==='/api/desktop/v1/action') {
        if(!enableFileActions)reject(403,'file_actions_disabled');
        const supplied=Buffer.from(String(req.headers['x-rhine-action-token'] || ''));
        const expected=Buffer.from(actionToken);
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))reject(403,'invalid_action_token');
        const body=await readBody(req);
        if(!body || typeof body!=='object' || Object.keys(body).some(k=>!['id','action'].includes(k)) || typeof body.id!=='string')reject(400,'invalid_action');
        json(res,200,await files.performFileAction(body.id,body.action,{confirmedByUser:true}));return true;
      }
      if(req.method!=='GET')reject(405,'get_only');
      if(url.pathname.startsWith('/api/secretary/')) {const target=secretaryTarget(url);const result=await readSecretary(target);const safe=safeUpstreamResult(result.status,result.data);json(res,safe.status,safe.data);return true;}
      if(url.pathname.startsWith('/api/solar/')) {const result=await solar(url);json(res,result.status,result.data);return true;}
      if(url.pathname==='/api/local/v1/capabilities') {
        if(url.search)reject(400,'no_query_allowed');
        json(res,200,{schema_version:'1.0',desktop_read:permissions.desktop,file_actions:permissions.desktop&&enableFileActions,action_token:permissions.desktop&&enableFileActions?actionToken:null,secretary_review:permissions.secretary,secretary_details:permissions.secretary,secretary_project_review:permissions.secretary,secretary_review_token:permissions.secretary?reviewToken:null,solar_read:permissions.solar,media_read:permissions.media?await mediaAvailable():false});return true;
      }
      if(url.pathname==='/api/media/v1/state') {if(url.search)reject(400,'no_query_allowed');json(res,200,await media());return true;}
      if(url.pathname==='/api/desktop/v1/catalog') {if(url.search)reject(400,'no_query_allowed');json(res,200,await files.columns());return true;}
      if(url.pathname==='/api/desktop/v1/folder') {const path=await files.pathForId(oneId(url));const listing=await files.list(path);json(res,200,{...listing,breadcrumbs:await files.breadcrumbs(path)});return true;}
      if(url.pathname==='/api/desktop/v1/preview') {
        const result=await files.preview(await files.pathForId(oneId(url)));
        if(['image','pdf'].includes(result.kind)) {
          const now=Date.now();for(const[key,item]of previews){if(item.expires<now)previews.delete(key);}
          if(previews.size>=512)previews.delete(previews.keys().next().value);
          const token=randomBytes(24).toString('hex');previews.set(token,{path:result.file.path,version:result.file.version,expires:now+300000});
          result.content_url=`/api/desktop/v1/content?token=${token}`;
        }
        json(res,200,result);return true;
      }
      if(binary) {
        if([...url.searchParams.keys()].some(k=>k!=='token') || url.searchParams.getAll('token').length!==1)reject(400,'preview_token_required');
        const token=url.searchParams.get('token');const item=previews.get(token);
        if(!item || item.expires<Date.now()){previews.delete(token);reject(403,'preview_expired');}
        const content=await files.binary(item.path,item.version);
        res.writeHead(200,{...BASE_HEADERS,'Content-Type':content.mime,'Content-Length':content.buffer.length,'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'"});res.end(content.buffer);return true;
      }
      reject(404,'local_route_not_found');
    } catch(error) {
      const code=error instanceof FileBridgeError?error.code:'local_bridge_unavailable';
      json(res,error instanceof FileBridgeError?error.status:500,{error:code,code});return true;
    }
  };
}
