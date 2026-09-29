import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/secretary-client.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const row = { id:'item-1',project_id:null,title:'真实记录',summary:'摘要',status:'active',source_url:null,source_refs:[],review_revision:'r1',manual_status:null,manual_project:null,manual_project_is_set:false,human_reviewed:false,classification_authority:'source',project_source:'source',can_undo:{status:false,project:false} };
const widget = { schema_version:'1.0',widget_id:'today',title:'今日',status:'ok',generated_at:'2026-09-25T08:00:00+08:00',data_updated_at:null,timezone:'Asia/Shanghai',message:'',items:[row],metrics:[],points:[],total:3,truncated:true,source:{id:'secretary',label:'秘书'},snapshot_revision:'s1',pagination:{offset:0,limit:1,total:3,next_offset:1,has_more:true} };
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`PASS ${name}`); };
const reply = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
let calls=[]; let handler=()=>reply({});
globalThis.fetch=async(path,opts)=>{calls.push({path,opts}); if(opts.signal?.aborted)throw new DOMException('aborted','AbortError'); return handler(path,opts);};
await check('parse new pagination and full review fields; legacy response remains compatible',()=>{
 const parsed=api.parseWidget(widget,'today'); assert.deepEqual(parsed.items[0],row);assert.deepEqual(parsed.pagination,widget.pagination);
 const old={...widget};delete old.pagination;delete old.snapshot_revision;assert.equal(api.parseWidget(old,'today').pagination,undefined);
 assert.throws(()=>api.parseWidget({...widget,pagination:{...widget.pagination,next_offset:0}},'today'));
 assert.throws(()=>api.parseWidget({...widget,items:[{...row,can_undo:{status:'no',project:false}}]},'today'));
});
await check('safe page query and preserved snapshot conflict',async()=>{
 handler=()=>reply(widget);await api.getWidget('today',{limit:1,offset:0,snapshot_revision:'s1',project_id:'项目 A'});
 const url=new URL(calls.at(-1).path,'http://local');assert.equal(url.searchParams.get('project_id'),'项目 A');assert.equal(url.searchParams.get('snapshot_revision'),'s1');assert.equal(calls.at(-1).opts.headers['X-Rhine-Local'],'1');
 handler=()=>reply({error:'已变更',code:'snapshot_changed'},409);
 await assert.rejects(api.getWidget('today'),e=>e instanceof api.WidgetAPIError&&e.code==='snapshot_changed'&&e.status===409);
 await assert.rejects(api.getWidget('today',{offset:1000001}));
});
await check('revision and completed item endpoints',async()=>{
 handler=(path)=>reply(path.includes('/revision')?{schema_version:'1.0',revision:'global2',poll_seconds:2}:{schema_version:'1.0',item:{...row,status:'completed'},revision:'global2'});
 assert.equal((await api.getRevision()).revision,'global2');assert.equal((await api.getReviewItem('item-1')).item.status,'completed');
});
const request={request_id:'intent-uuid',item_id:'item-1',expected_revision:'r1',action:'status',status:'completed'};
const success={schema_version:'1.0',ok:true,duplicate:false,item:{...row,review_revision:'r2',status:'completed',can_undo:{status:true,project:false}},revision:'global2'};
await check('fixed write endpoint, cached capability, unchanged id/body across retry',async()=>{
 calls=[];handler=(path)=>reply(path.includes('capabilities')?{secretary_review:true,secretary_review_token:'test-token'}:success);
 assert.equal((await api.submitReview(request)).item.review_revision,'r2');await api.submitReview(request);
 assert.equal(calls.filter(c=>c.path.includes('capabilities')).length,1);
 const posts=calls.filter(c=>c.opts.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].opts.body,posts[1].opts.body);assert.deepEqual(JSON.parse(posts[0].opts.body),request);assert.equal(posts[0].opts.headers['X-Rhine-Action-Token'],'test-token');assert.equal(posts[0].opts.redirect,'error');
});
await check('explicit cancellation of project and undo are different writes',async()=>{
 await api.submitReview({...request,action:'project',project:''});assert.equal(JSON.parse(calls.at(-1).opts.body).project,'');
 await api.submitReview({...request,action:'undo',field:'project'});assert.equal(JSON.parse(calls.at(-1).opts.body).field,'project');
 await assert.rejects(api.submitReview({...request,action:'status',status:'madeup'}));
});
await check('conflict preserves current server item, no hidden retry',async()=>{
 calls=[];handler=()=>reply({error:'记录已被修改',code:'revision_conflict',current_item:{...row,review_revision:'r3'}},409);
 await assert.rejects(api.submitReview(request),e=>e.code==='revision_conflict'&&e.currentItem.review_revision==='r3');assert.equal(calls.length,1);
});
await check('failed network remains uncertain and next retry keeps caller intent',async()=>{
 handler=()=>{throw new TypeError('network')};await assert.rejects(api.submitReview(request));
 handler=()=>reply({...success,duplicate:true});assert.equal((await api.submitReview(request)).duplicate,true);assert.deepEqual(JSON.parse(calls.at(-1).opts.body),request);
});
await check('403 invalidates capability only for a later explicit retry',async()=>{
 handler=()=>reply({error:'token expired',code:'action_token_invalid'},403);await assert.rejects(api.submitReview(request),e=>e.status===403);
 calls=[];handler=(path)=>reply(path.includes('capabilities')?{secretary_review:true,secretary_review_token:'new-token'}:success);await api.submitReview(request);
 assert.equal(calls.filter(c=>c.path.includes('capabilities')).length,1);assert.equal(calls.at(-1).opts.headers['X-Rhine-Action-Token'],'new-token');
});
await check('abort prevents business write',async()=>{
 const controller=new AbortController();controller.abort();calls=[];await assert.rejects(api.submitReview(request,{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(calls.length,0);
});
console.log(`${count} isolated client checks passed. No real service requests or business writes.`);
