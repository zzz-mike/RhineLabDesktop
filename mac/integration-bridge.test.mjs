import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rename,unlink,symlink,stat,rm,realpath,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {DesktopFiles} from './desktop-files.mjs';
import {createIntegrationBridge,secretaryTarget,checkLocalRequest,fetchSecretary,createSecretaryReviewClient,validateReviewBody,SECRETARY_TIMEOUT_MS} from './integration-bridge.mjs';
import {createMediaReader} from './media-state.mjs';

async function fixture(t){const dir=await realpath(await mkdtemp(join(tmpdir(),'rhine-bridge-test-')));t.after(()=>rm(dir,{recursive:true,force:true}));const root=join(dir,'Desktop');await mkdir(root);const summaryPath=join(dir,'summary.json');const launches=[];const files=new DesktopFiles({root,summaryPath,exec:async(...args)=>{launches.push(args);}});return{dir,root,summaryPath,files,launches};}
async function serve(t,files,options={}){let handle;const server=http.createServer((req,res)=>handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;handle=createIntegrationBridge({files,port,...options});t.after(()=>new Promise(resolve=>server.close(resolve)));return{base:`http://127.0.0.1:${port}`,port};}
const get=(base,path,extra={})=>fetch(base+path,{headers:{'X-Rhine-Local':'1',...extra}});

test('maps first-level folders and loose files, nested browsing and stable rename IDs',async t=>{
 const{root,files}=await fixture(t);await mkdir(join(root,'项目'));await mkdir(join(root,'项目','嵌套'));await writeFile(join(root,'项目','说明.txt'),'actual');await writeFile(join(root,'loose.md'),'# real');
 let catalog=await files.columns();assert.equal(catalog.columns.length,2);assert.equal(catalog.columns[0].title,'项目');assert.equal(catalog.columns[0].entries.length,2);const loose=catalog.columns.at(-1).entries[0];
 await rename(join(root,'loose.md'),join(root,'renamed.md'));catalog=await files.columns();assert.equal(catalog.columns.at(-1).entries[0].id,loose.id);assert.equal(await files.pathForId(loose.id),'renamed.md');
 await writeFile(join(root,'new.txt'),'new');assert.equal((await files.columns()).columns.at(-1).total,2);await unlink(join(root,'renamed.md'));assert.equal((await files.columns()).columns.at(-1).total,1);await assert.rejects(files.pathForId(loose.id),/file_not_available/);
 assert.equal((await files.list('项目/嵌套')).entries.length,0);assert.deepEqual((await files.breadcrumbs('项目/嵌套')).map(x=>x.name),['桌面','项目','嵌套']);
});
test('rejects traversal, absolute paths and symbolic-link escapes',async t=>{
 const{root,dir,files}=await fixture(t);await writeFile(join(dir,'outside.txt'),'private');await symlink(join(dir,'outside.txt'),join(root,'escape.txt'));await symlink(dir,join(root,'escape-dir'));
 for(const path of ['../outside.txt','/etc/passwd','a/../../x','a\\b','a\0x'])await assert.rejects(files.locate(path));
 await assert.rejects(files.locate('escape.txt'),/outside_desktop/);await assert.rejects(files.locate('escape-dir/outside.txt'),/outside_desktop/);const listing=await files.list();assert.equal(listing.blocked,2);
 assert.equal((await files.columns()).status,'partial');
 await mkdir(join(root,'project'));await symlink(join(dir,'outside.txt'),join(root,'project','blocked.txt'));const catalog=await files.columns();assert.equal(catalog.status,'partial');assert.equal(catalog.columns.find(column=>column.title==='project').entries[0].kind,'unavailable');
});
test('HTML and SVG only yield source text, binary format is not executable response',async t=>{
 const{root,files}=await fixture(t);for(const name of ['bad.html','bad.svg']){await writeFile(join(root,name),'<script>fetch("/api/local/v1/capabilities")</script>');const preview=await files.preview(name);assert.equal(preview.kind,'text');assert.equal(preview.active_content,false);await assert.rejects(files.binary(name,preview.file.version),/not_a_safe_binary_preview/);}
 await writeFile(join(root,'book.xlsx'),'not a real workbook');assert.equal((await files.preview('book.xlsx')).kind,'unsupported');
 await writeFile(join(root,'big.txt'),Buffer.alloc(1024*1024+1));assert.equal((await files.preview('big.txt')).kind,'unsupported');
});
test('summary reuse requires exact path and nanosecond fingerprint; partial is honest',async t=>{
 const{root,files,summaryPath}=await fixture(t);const path=join(root,'note.md');await writeFile(path,'real version');const info=await stat(path,{bigint:true});await writeFile(summaryPath,JSON.stringify({version:3,last_sync_at:'2026-09-24T00:00:00+08:00',files:{[path]:{path,fingerprint:`v3:${info.size}:${info.mtimeNs}`,stage:'content_read_partial',summary:'partial content',extractor:'first_pages'}}}));
 let preview=await files.preview('note.md');assert.equal(preview.file.summary.status,'partial');assert.equal(preview.file.summary.is_ai,false);assert.equal(preview.text,'real version');await writeFile(path,'different version');preview=await files.preview('note.md');assert.equal(preview.file.summary.status,'stale');assert.equal(preview.file.summary.text,null);
});
test('document actions require explicit click, known unchanged ID and safe document extension',async t=>{
 const{root,files,launches}=await fixture(t);await writeFile(join(root,'document.docx'),'doc');await writeFile(join(root,'script.command'),'evil');const list=await files.list();const doc=list.entries.find(x=>x.name==='document.docx');const script=list.entries.find(x=>x.name==='script.command');
 await assert.rejects(files.performFileAction(doc.id,'open'),/explicit_user_action/);await files.performFileAction(doc.id,'open',{confirmedByUser:true});assert.deepEqual(launches[0][1],['--',join(root,'document.docx')]);await assert.rejects(files.performFileAction(script.id,'open',{confirmedByUser:true}),/only_document_open/);
 await writeFile(join(root,'document.docx'),'changed');await assert.rejects(files.performFileAction(doc.id,'reveal',{confirmedByUser:true}),/file_changed/);assert.equal(launches.length,1);
});
test('secretary route allowlist rejects bootstrap, arbitrary URLs, query smuggling and huge limits',()=>{
 for(const topic of ['todo','triage'])assert.equal(secretaryTarget(new URL(`http://local/api/secretary/widgets/v1/${topic}?limit=4&offset=4`)),`/api/widgets/v1/${topic}?limit=4&offset=4`);
 assert.equal(secretaryTarget(new URL('http://local/api/secretary/widgets/v1/solar.generation?project_id=solar%3Atest&limit=20')),'/api/widgets/v1/solar.generation?project_id=solar%3Atest&limit=20');
 for(const path of ['/api/secretary/bootstrap','/api/secretary/widgets/v1/nope','/api/secretary/widgets/v1/catalog?url=http://evil','/api/secretary/widgets/v1/today?limit=20&limit=1','/api/secretary/widgets/v1/today?limit=201','/api/secretary/widgets/v1/today?token=secret'])assert.throws(()=>secretaryTarget(new URL('http://local'+path)));
});
test('local guard rejects DNS rebinding, foreign Origin, cross-site fetch and missing header',()=>{
 const valid={headers:{host:'127.0.0.1:5180','x-rhine-local':'1'},socket:{remoteAddress:'127.0.0.1'}};checkLocalRequest(valid);
 for(const patch of [{host:'evil.example:5180'},{origin:'http://evil.example'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'x-rhine-local':''}])assert.throws(()=>checkLocalRequest({...valid,headers:{...valid.headers,...patch}}));
 assert.throws(()=>checkLocalRequest(valid,{requireOrigin:true}));
 assert.throws(()=>checkLocalRequest({...valid,rawHeaders:['Host','127.0.0.1:5180','Host','evil.example']}));
});
test('HTTP bridge returns actual text and token-scoped safe PDF, invalidates changed file',async t=>{
 const{root,files}=await fixture(t);await writeFile(join(root,'note.md'),'hello actual');await writeFile(join(root,'doc.pdf'),'%PDF-1.4\n%%EOF');const{base}=await serve(t,files);const catalog=await(await get(base,'/api/desktop/v1/catalog')).json();const items=catalog.columns.at(-1).entries;const doc=items.find(x=>x.name==='doc.pdf');const text=items.find(x=>x.name==='note.md');
 const preview=await(await get(base,`/api/desktop/v1/preview?id=${encodeURIComponent(text.id)}`)).json();assert.equal(preview.text,'hello actual');const pdf=await(await get(base,`/api/desktop/v1/preview?id=${encodeURIComponent(doc.id)}`)).json();assert.ok(pdf.content_url);const content=await fetch(base+pdf.content_url);assert.equal(content.status,200);assert.equal(content.headers.get('content-security-policy'),"sandbox; default-src 'none'; frame-ancestors 'self'");assert.equal(await content.text(),'%PDF-1.4\n%%EOF');
 await writeFile(join(root,'doc.pdf'),'changed');assert.equal((await fetch(base+pdf.content_url)).status,409);assert.equal((await fetch(base+'/api/desktop/v1/content?token=guess')).status,403);assert.equal((await fetch(base+'/api/desktop/v1/catalog')).status,403);
});
test('HTTP action refuses missing token and cross-origin even with token, never exposes it in widget data',async t=>{
 const{root,files,launches}=await fixture(t);await writeFile(join(root,'note.txt'),'hello');const{base}=await serve(t,files,{enableFileActions:true,secretary:async path=>({status:200,data:{schema_version:'1.0',path}})});const catalog=await(await get(base,'/api/desktop/v1/catalog')).json();const id=catalog.columns.at(-1).entries[0].id;const caps=await(await get(base,'/api/local/v1/capabilities')).json();const post=(origin,token)=>fetch(base+'/api/desktop/v1/action',{method:'POST',headers:{'X-Rhine-Local':'1','X-Rhine-Action-Token':token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({id,action:'reveal'})});
 assert.equal((await post(base,'wrong')).status,403);assert.equal((await post('http://evil.example',caps.action_token)).status,403);assert.equal((await post(base,caps.action_token)).status,200);assert.equal(launches.length,1);
 const widget=await(await get(base,'/api/secretary/widgets/v1/today')).json();assert.equal(widget.path,'/api/widgets/v1/today');assert.equal(widget.action_token,undefined);assert.equal((await get(base,'/api/secretary/bootstrap')).status,404);
});
test('media unsupported does not claim playback stopped or fabricate timestamps',async()=>{
 const state=await createMediaReader({system:'darwin',exists:async()=>false})();assert.equal(state.status,'unsupported');assert.equal(state.playing,null);assert.equal(state.updated_at,null);assert.equal(state.capabilities.read,false);assert.match(state.message,/无法判断/);
});
test('binary magic rejects mislabeled active content and size limits remain enforced',async t=>{
 const{root,files}=await fixture(t);await writeFile(join(root,'fake.png'),'<html><script>evil()</script></html>');const fake=await files.preview('fake.png');await assert.rejects(files.binary('fake.png',fake.file.version),/file_signature_mismatch/);
 await writeFile(join(root,'oversized.pdf'),Buffer.alloc(20*1024*1024+1));const large=await files.preview('oversized.pdf');assert.equal(large.kind,'unsupported');await assert.rejects(files.binary('oversized.pdf',large.file.version),/preview_too_large/);
});
test('folder listing explicitly marks truncation and hidden exclusions',async t=>{
 const{root,files}=await fixture(t);files.maxEntries=1;await writeFile(join(root,'a.txt'),'a');await writeFile(join(root,'b.txt'),'b');await writeFile(join(root,'.hidden'),'private config');const list=await files.list();assert.equal(list.total,2);assert.equal(list.entries.length,1);assert.equal(list.truncated,true);assert.equal(list.hidden_files,'excluded');assert.equal((await files.columns()).status,'partial');
});
test('HTTP rejects action methods, oversized body and unknown payload keys',async t=>{
 const{files}=await fixture(t);const{base}=await serve(t,files,{enableFileActions:true});const caps=await(await get(base,'/api/local/v1/capabilities')).json();const headers={'X-Rhine-Local':'1','X-Rhine-Action-Token':caps.action_token,Origin:base,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/desktop/v1/action',{method:'POST',headers,body:JSON.stringify({id:'fake',action:'execute',command:'evil'})})).status,400);
 assert.equal((await fetch(base+'/api/desktop/v1/action',{method:'POST',headers,body:'x'.repeat(5000)})).status,413);
 assert.equal((await fetch(base+'/api/desktop/v1/catalog',{method:'POST',headers,body:'{}'})).status,405);
});
test('secretary upstream deadline is 10s below client 12s and timeout aborts the fixed upstream',async()=>{
 assert.equal(SECRETARY_TIMEOUT_MS,10000);
 const original=http.request;let destroyed=false,ended=false,target;
 http.request=options=>{target=options;const request=new EventEmitter();request.end=()=>{ended=true;};request.destroy=()=>{destroyed=true;};return request;};
 try{
  await assert.rejects(fetchSecretary('/api/widgets/v1/today?limit=5',{timeout:20}),error=>error.status===504 && error.code==='secretary_timeout');
  assert.equal(ended,true);assert.equal(destroyed,true);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,8866);assert.equal(target.method,'GET');
 }finally{http.request=original;}
});
test('hardlink aliases have unique card IDs and each action targets its own listed path',async t=>{
 const{root,files,launches}=await fixture(t);await writeFile(join(root,'alias-a.txt'),'shared data');
 const original=(await files.list()).entries[0];assert.equal(original.identity_kind,'inode');
 await link(join(root,'alias-a.txt'),join(root,'alias-b.txt'));
 await assert.rejects(files.pathForId(original.id),/file_changed_refresh_first/);
 const listing=await files.list();const a=listing.entries.find(file=>file.name==='alias-a.txt'),b=listing.entries.find(file=>file.name==='alias-b.txt');
 assert.equal(a.identity_kind,'hardlink_alias');assert.equal(b.identity_kind,'hardlink_alias');assert.notEqual(a.id,b.id);
 assert.equal(await files.pathForId(a.id),'alias-a.txt');assert.equal(await files.pathForId(b.id),'alias-b.txt');
 await files.performFileAction(a.id,'reveal',{confirmedByUser:true});await files.performFileAction(b.id,'reveal',{confirmedByUser:true});
 assert.deepEqual(launches.map(call=>call[1]),[['-R','--',join(root,'alias-a.txt')],['-R','--',join(root,'alias-b.txt')]]);
 await rename(join(root,'alias-a.txt'),join(root,'renamed-alias.txt'));const renamed=await files.list();
 assert.equal(renamed.entries.find(file=>file.name==='alias-b.txt').id,b.id);
 const moved=renamed.entries.find(file=>file.name==='renamed-alias.txt');assert.notEqual(moved.id,a.id);await assert.rejects(files.pathForId(a.id),/file_not_available/);
 await unlink(join(root,'alias-b.txt'));await assert.rejects(files.pathForId(moved.id),/file_changed_refresh_first/);
 const sole=(await files.list()).entries[0];assert.equal(sole.identity_kind,'inode');assert.equal(await files.pathForId(sole.id),'renamed-alias.txt');
});

const reviewIntent={request_id:'9f0e6140-8855-4ba5-9a56-75a2d6e18dd9',item_id:'original-secretary-item',expected_revision:'review-r1',action:'status',status:'completed'};
const reviewPath='/api/secretary/widgets/v1/review';
const reviewHeaders=(base,token,extra={})=>({'X-Rhine-Local':'1','X-Rhine-Action-Token':token,Origin:base,'Content-Type':'application/json',...extra});

test('revision, item and pagination use strict distinct query contracts',()=>{
 for(const path of ['revision','item?item_id=source%3Aoriginal','today?offset=1000000&limit=100&snapshot_revision=opaque%3Ax'])assert.equal(secretaryTarget(new URL('http://local/api/secretary/widgets/v1/'+path)),'/api/widgets/v1/'+path);
 for(const path of ['revision?limit=1','revision?item_id=x','catalog?offset=0','item','item?item_id=','item?item_id=x&limit=1','item?item_id=x&item_id=y','item?item_id=%00','today?offset=-1','today?offset=1.2','today?offset=1000001','today?offset=00','today?offset=1&offset=2','today?snapshot_revision=','today?snapshot_revision='+ 'x'.repeat(129),'today?snapshot_revision=%0A','review-session','review'])assert.throws(()=>secretaryTarget(new URL('http://local/api/secretary/widgets/v1/'+path)),path);
 for(const path of ['http://evil.example/api/widgets/v1/today','//evil.example/api/widgets/v1/today','/api/widgets/v1/review-session','/api/widgets/v1/review'])assert.throws(()=>fetchSecretary(path));
});

test('review body admits only exact actions and fields, preserves empty project intent',()=>{
 assert.deepEqual(validateReviewBody(reviewIntent),reviewIntent);
 for(const status of ['active','completed','cancelled','observing'])assert.equal(validateReviewBody({...reviewIntent,status}).status,status);
 const {status,...base}=reviewIntent;
 assert.equal(validateReviewBody({...base,action:'project',project:''}).project,'');
 assert.equal(validateReviewBody({...base,action:'project',project:' 项目 '}).project,' 项目 ');
 for(const field of ['status','project'])assert.equal(validateReviewBody({...base,action:'undo',field}).field,field);
 for(const value of [null,[],{...reviewIntent,request_id:'not-uuid'},{...reviewIntent,item_id:''},{...reviewIntent,item_id:'x'.repeat(241)},{...reviewIntent,item_id:'x\ny'},{...reviewIntent,expected_revision:'x'.repeat(129)},{...reviewIntent,status:'done'},{...reviewIntent,command:'evil'},{...reviewIntent,action:'project',project:'x'},{...base,action:'project',project:'x'.repeat(101)},{...base,action:'undo',field:'all'},{...base,action:'toString',toString:'evil'}])assert.throws(()=>validateReviewBody(value));
});

test('HTTP review uses independent nonce, strict origin, and never proxies session',async t=>{
 const {files}=await fixture(t);const writes=[],reads=[];
 const {base}=await serve(t,files,{enableFileActions:true,secretary:async path=>{reads.push(path);return {status:200,data:{schema_version:'1.0',revision:'r1'}};},secretaryReview:async body=>{writes.push(body);return {status:200,data:{schema_version:'1.0',ok:true,duplicate:false,item:{id:body.item_id},revision:'r2'}};}});
 const caps=await(await get(base,'/api/local/v1/capabilities')).json();assert.equal(caps.secretary_review,true);assert.match(caps.secretary_review_token,/^[0-9a-f]{64}$/);assert.notEqual(caps.secretary_review_token,caps.action_token);
 const post=(token,extra={},path=reviewPath,body=reviewIntent)=>fetch(base+path,{method:'POST',headers:reviewHeaders(base,token,extra),body:JSON.stringify(body)});
 for(const token of ['',caps.action_token,'incorrect'])assert.equal((await post(token)).status,403);
 for(const extra of [{Origin:'http://evil.example'},{Origin:'null'},{Origin:''},{'Sec-Fetch-Site':'cross-site'},{'X-Rhine-Local':'0'}])assert.equal((await post(caps.secretary_review_token,extra)).status,403);
 assert.equal((await post(caps.secretary_review_token,{},reviewPath+'?url=http://evil')).status,400);
 assert.equal((await post(caps.secretary_review_token,{},'/api/secretary/widgets/v1/review-session')).status,405);
 assert.equal(writes.length,0);
 const saved=await post(caps.secretary_review_token);assert.equal(saved.status,200);assert.equal((await saved.json()).ok,true);assert.deepEqual(writes,[reviewIntent]);
 for(const path of ['/api/secretary/widgets/v1/review-session','/api/secretary/bootstrap',reviewPath])assert.equal((await get(base,path)).status,404);
 assert.equal((await get(base,'/api/secretary/widgets/v1/revision')).status,200);assert.deepEqual(reads,['/api/widgets/v1/revision']);
});

test('HTTP review enabled without file actions and rejects malformed/oversized/chunked bodies',async t=>{
 const {files}=await fixture(t);let writes=0;const {base}=await serve(t,files,{secretaryReview:async()=>{writes++;return {status:200,data:{schema_version:'1.0',ok:true}};}});
 const caps=await(await get(base,'/api/local/v1/capabilities')).json();assert.equal(caps.file_actions,false);assert.equal(caps.action_token,null);assert.equal(caps.secretary_review,true);
 const headers=reviewHeaders(base,caps.secretary_review_token);
 for(const [body,expected] of [['{',400],['x'.repeat(4097),413],[JSON.stringify({...reviewIntent,extra:'no'}),400]])assert.equal((await fetch(base+reviewPath,{method:'POST',headers,body})).status,expected);
 assert.equal((await fetch(base+reviewPath,{method:'POST',headers:{...headers,'Content-Type':'application/json-evil'},body:JSON.stringify(reviewIntent)})).status,415);
 const chunked=await new Promise((resolve,reject)=>{const req=http.request(base+reviewPath,{method:'POST',headers:{...headers,'Transfer-Encoding':'chunked'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify(reviewIntent));});assert.equal(chunked,400);
 assert.equal(writes,0);
 assert.equal((await fetch(base+reviewPath,{method:'POST',headers,body:JSON.stringify(reviewIntent)})).status,200);assert.equal(writes,1);
});

test('write guard rejects duplicate framing/site headers and non-loopback peers',()=>{
 const valid={headers:{host:'127.0.0.1:5180','x-rhine-local':'1',origin:'http://127.0.0.1:5180'},socket:{remoteAddress:'127.0.0.1'}};
 for(const name of ['Sec-Fetch-Site','Transfer-Encoding','Content-Length','Content-Type','X-Rhine-Action-Token','X-Rhine-Local','Origin'])assert.throws(()=>checkLocalRequest({...valid,rawHeaders:[name,'a',name,'b']},{requireOrigin:true}),/duplicate_security_header/);
 assert.throws(()=>checkLocalRequest({...valid,socket:{remoteAddress:'192.168.1.5'}}),/local_only/);
});

test('review session refresh retries once with exactly the same intent and caches private token',async()=>{
 const calls=[];let sessions=0,posts=0;
 const review=createSecretaryReviewClient({transport:async(method,path,options)=>{
   calls.push({method,path,...options});
   if(method==='GET')return {status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private-'+(++sessions)}};
   posts++;return posts===1?{status:403,data:{code:'invalid_review_token'}}:{status:200,data:{schema_version:'1.0',ok:true,duplicate:posts>2}};
 }});
 assert.equal((await review(reviewIntent)).data.ok,true);assert.equal(sessions,2);assert.equal(posts,2);assert.equal(calls[1].token,'private-1');assert.equal(calls[3].token,'private-2');assert.deepEqual(calls[1].body,calls[3].body);assert.equal(calls[3].body.request_id,reviewIntent.request_id);
 assert.equal((await review(reviewIntent)).data.duplicate,true);assert.equal(sessions,2);assert.equal(posts,3);
 assert.deepEqual(calls.filter(call=>call.method==='GET').map(call=>call.path),['/api/widgets/v1/review-session','/api/widgets/v1/review-session']);
});

test('review retries no more than once and invalid sessions fail closed',async()=>{
 let posts=0;const denied=createSecretaryReviewClient({transport:async method=>method==='GET'?{status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private'}}:(posts++,{status:403,data:{code:'invalid_review_token',error:'/private/path secret'}})});
 assert.deepEqual(await denied(reviewIntent),{status:403,data:{error:'invalid_review_token',code:'invalid_review_token'}});assert.equal(posts,2);
 for(const data of [{schema_version:'1.0',scope:'all',review_token:'private'},{schema_version:'1.0',scope:'widgets:review',review_token:''},{scope:'widgets:review',review_token:'private'}])await assert.rejects(createSecretaryReviewClient({transport:async()=>({status:200,data})})(reviewIntent),/invalid_review_session/);
});

test('HTTP read/write retain safe conflicts and status while discarding unsafe upstream errors',async t=>{
 const {files}=await fixture(t);let result={status:409,data:{code:'revision_conflict',error:'secret path /private/token',current_item:{id:'original-secretary-item',review_revision:'new'},stack:'private'}};
 const {base}=await serve(t,files,{secretary:async()=>result,secretaryReview:async()=>result});const caps=await(await get(base,'/api/local/v1/capabilities')).json();
 const post=()=>fetch(base+reviewPath,{method:'POST',headers:reviewHeaders(base,caps.secretary_review_token),body:JSON.stringify(reviewIntent)});
 let response=await post();assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'revision_conflict',code:'revision_conflict',current_item:result.data.current_item});
 for(const [status,code] of [[409,'request_id_conflict'],[409,'snapshot_changed'],[404,'item_not_found'],[503,'source_changing'],[500,'source_unavailable'],[500,'review_failed'],[400,'invalid_request'],[400,'invalid_body']]){result={status,data:{code,error:'private token',review_token:'secret'}};response=await get(base,'/api/secretary/widgets/v1/today');assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code,code});}
 result={status:503,data:{error:'private token /Users/name',code:'bad/secret'}};response=await post();assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'secretary_request_failed',code:'secretary_request_failed'});
});

function mockSecretaryHTTP(t,replies) {
 const original=http.request,calls=[];
 http.request=(options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>{};
  req.end=body=>{calls.push({...options,body});queueMicrotask(()=>{const reply=replies.shift();if(!reply){req.emit('error',new Error('unexpected'));return;}const res=new EventEmitter();res.statusCode=reply.status;res.headers={'content-type':reply.contentType||'application/json'};res.resume=()=>{};res.destroy=()=>{};callback(res);res.emit('data',Buffer.from(typeof reply.data==='string'?reply.data:JSON.stringify(reply.data)));res.emit('end');});};
  return req;
 };
 t.after(()=>{http.request=original;});return calls;
}

test('production transport uses only fixed loopback and private scoped headers for session and review',async t=>{
 const calls=mockSecretaryHTTP(t,[{status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private-session-token'}},{status:403,data:{code:'invalid_review_token'}},{status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'refreshed-private-token'}},{status:200,data:{schema_version:'1.0',ok:true,duplicate:true}}]);
 const result=await createSecretaryReviewClient()(reviewIntent);assert.equal(result.data.duplicate,true);
 assert.equal(calls.length,4);for(const call of calls){assert.equal(call.hostname,'127.0.0.1');assert.equal(call.port,8866);assert.equal(call.headers.Origin,undefined);assert.equal(call.headers['X-Rhine-Action-Token'],undefined);}
 for(const i of [0,2]){assert.equal(calls[i].path,'/api/widgets/v1/review-session');assert.equal(calls[i].method,'GET');assert.equal(calls[i].headers['X-Rhine-Bridge'],'1');assert.equal(calls[i].headers['X-Widget-Review-Token'],undefined);}
 for(const i of [1,3]){assert.equal(calls[i].path,'/api/widgets/v1/review');assert.equal(calls[i].method,'POST');assert.equal(calls[i].headers['Content-Length'],Buffer.byteLength(calls[i].body));assert.equal(calls[i].headers['X-Rhine-Bridge'],undefined);assert.deepEqual(JSON.parse(calls[i].body),reviewIntent);}
 assert.equal(calls[1].headers['X-Widget-Review-Token'],'private-session-token');assert.equal(calls[3].headers['X-Widget-Review-Token'],'refreshed-private-token');assert.equal(calls[1].body,calls[3].body);assert.equal(JSON.stringify(result).includes('private'),false);
});

test('production read transport retains snapshot 409 without leaking error text',async t=>{
 mockSecretaryHTTP(t,[{status:409,data:{code:'snapshot_changed',error:'private',stack:'secret'}}]);
 assert.deepEqual(await fetchSecretary('/api/widgets/v1/today?offset=20&snapshot_revision=old'),{status:409,data:{error:'snapshot_changed',code:'snapshot_changed'}});
});

test('production transport refuses redirects and invalid JSON instead of following or exposing details',async t=>{
 mockSecretaryHTTP(t,[{status:302,data:{}},{status:200,data:'not JSON /private/path'},{status:200,contentType:'text/html',data:'private'}]);
 await assert.rejects(fetchSecretary('/api/widgets/v1/revision'),/upstream_redirect_denied/);
 await assert.rejects(fetchSecretary('/api/widgets/v1/revision'),/upstream_invalid_json/);
 await assert.rejects(fetchSecretary('/api/widgets/v1/revision'),/upstream_not_json/);
});

test('review session plus retry share one deadline instead of multiplying the client timeout',async t=>{
 const original=Date.now;let now=1000;Date.now=()=>now;t.after(()=>{Date.now=original;});
 const budgets=[];let posts=0;
 const review=createSecretaryReviewClient({timeout:100,transport:async(method,path,options)=>{
  budgets.push(options.timeout);now+=30;
  if(method==='GET')return {status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private'}};
  posts++;return {status:403,data:{code:'invalid_review_token'}};
 }});
 assert.equal((await review(reviewIntent)).status,403);assert.deepEqual(budgets,[100,70,40,10]);assert.equal(posts,2);
 const late=createSecretaryReviewClient({timeout:20,transport:async()=>{now+=21;return {status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private'}};}});
 await assert.rejects(late(reviewIntent),error=>error.status===504 && error.code==='secretary_timeout');
});

test('upstream session errors retain safe status and invalid sessions never write',async()=>{
 let calls=0;const review=createSecretaryReviewClient({transport:async()=>{calls++;return {status:503,data:{code:'secretary_unavailable',error:'secret'}};}});
 await assert.rejects(review(reviewIntent),error=>error.status===503 && error.code==='secretary_unavailable');assert.equal(calls,1);
});

test('review requires explicit Content-Length before reading bytes or contacting upstream',async()=>{
 let writes=0;const handle=createIntegrationBridge({secretaryReview:async()=>{writes++;}});
 const call=async req=>{let status,data;await handle(req,{writeHead:value=>{status=value;},end:value=>{data=JSON.parse(value);}});return {status,data};};
 const headers={host:'127.0.0.1:5180','x-rhine-local':'1'},socket={remoteAddress:'127.0.0.1'};
 const caps=await call({method:'GET',url:'/api/local/v1/capabilities',headers,socket});
 const result=await call({method:'POST',url:reviewPath,socket,headers:{...headers,origin:'http://127.0.0.1:5180','content-type':'application/json','x-rhine-action-token':caps.data.secretary_review_token}});
 assert.equal(result.status,411);assert.equal(result.data.code,'length_required');assert.equal(writes,0);
});
