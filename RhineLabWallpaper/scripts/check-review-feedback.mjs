// In-memory APIs only. Exercises real review coordinator, client and scope invalidation.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {InformationWidgets} from './src/information-widgets';export {WidgetWorkbench} from './src/widget-workbench';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'}});
const {InformationWidgets,WidgetWorkbench}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
class El {children=[];listeners={};attributes={};textContent='';open=false;append(...v){for(const x of v){x.parent=this;this.children.push(x)}}replaceChildren(...v){this.children=[];this.append(...v)}setAttribute(k,v){this.attributes[k]=v}addEventListener(k,v){this.listeners[k]=v}remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}showModal(){this.open=true}close(){this.open=false}}
globalThis.document={hidden:false,createElement:()=>new El()};
const base={id:'qa',title:'隔离事项',summary:'测试',project_id:null,status:'active',source_url:null,source_refs:[],review_revision:'r1',manual_status:null,manual_project:null,manual_project_is_set:false,human_reviewed:false,classification_authority:'source',project_source:'source',can_undo:{status:false,project:false}};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
let handler,posts=[];
globalThis.fetch=async(path,opts)=>{if(path.includes('capabilities'))return json({secretary_review:true,secretary_review_token:'fixture'});if(opts?.method==='POST')posts.push(JSON.parse(opts.body));return handler(path,opts)};
const settled=()=>new Promise(r=>setImmediate(r));
const success=(status='active')=>({schema_version:'1.0',ok:true,duplicate:false,item:{...base,status,manual_status:status,review_revision:'r2',can_undo:{status:true,project:false}},revision:'v2'});
const card=(id)=>({placement:{widget_id:id},response:{items:[base]},revision:0,abort:new AbortController(),trendAbort:new AbortController(),pages:{clear(){}}});
const hosts=[];
function host(){const h=Object.create(InformationWidgets.prototype);Object.assign(h,{cards:new Map(['today','priorities','solar.trend'].map(id=>[id,card(id)])),quickBusy:new Set(),pendingReviews:new Map(),latestReviews:new Map(),reviewMessages:new Map(),briefReviewNotices:new Map(),reviewNotices:new Map(),reviewReceipts:new Map(),secretaryNeedsSync:false,reviewEpoch:0,secretarySync:0,active:false,destroyed:false,feedback:new El(),dialog:new El(),live:new El(),catalog:{projects:[]},renderCard(){},workbench:{invalidateSecretary(v){h.wb.push(v)}},wb:[],generation:1,revision:'v1',lastFullRefresh:Date.now(),schedulePoll(){}});hosts.push(h);return h}
let count=0;async function check(name,fn){await fn();count++;console.log('PASS '+name)}
await check('slow write gives immediate feedback, serializes same item and only invalidates secretary',async()=>{const h=host();let resolve;handler=()=>new Promise(r=>resolve=r);const solar=h.cards.get('solar.trend'),old=h.cards.get('today').abort;const pending=h.quickReview(base,'active');await settled();assert(h.quickBusy.has(base.id));assert.match(h.reviewMessages.get(base.id),/正在提交/);assert(old.signal.aborted);assert(!solar.abort.signal.aborted);await h.quickReview(base,'completed');assert.equal(posts.length,1);resolve(json(success()));await pending;assert(!h.quickBusy.size);assert.equal(h.cards.get('today').response.items[0].manual_status,'active');assert.equal(h.cards.get('priorities').response.items[0].review_revision,'r2');assert.equal(solar.response.items[0],base);assert.match(h.reviewMessages.get(base.id),/仍保留.*不代表已启动执行/);assert.equal(h.feedback.children.length,1);assert.deepEqual(h.wb,[false,true]);await h.quickReview(success().item,'active');assert.equal(posts.length,1);});
await check('unknown result stays persistent; explicit retry retains exact UUID and body',async()=>{const h=host();handler=()=>{throw new TypeError('lost response')};await h.quickReview(base,'completed');const intent=h.pendingReviews.get(base.id);assert(intent);assert.match(h.reviewMessages.get(base.id),/未确认/);assert.equal(h.reviewNotices.get(base.id).timer,undefined);handler=()=>json({...success('completed'),duplicate:true});await h.performReview(base,intent);assert.deepEqual(posts.at(-1),posts.at(-2));assert(!h.pendingReviews.size);assert.match(h.reviewMessages.get(base.id),/已标为完成/)});
await check('409 adopts authoritative item without replay or optimistic overwrite',async()=>{const h=host(),before=posts.length;handler=()=>json({code:'revision_conflict',error:'conflict',current_item:success('observing').item},409);await h.quickReview(base,'completed');assert.equal(posts.length,before+1);assert(!h.pendingReviews.size);assert.equal(h.cards.get('today').response.items[0].manual_status,'observing');assert.match(h.reviewMessages.get(base.id),/本次未覆盖/)});
await check('undo uses same coordinator and retry intent',async()=>{const h=host(),item=success('completed').item;h.showUndo(item,'status');const undo=h.feedback.children[0].children.find(e=>e.textContent==='撤销');handler=()=>{throw new TypeError('lost undo')};undo.listeners.click();await settled();const intent=h.pendingReviews.get(base.id);assert.equal(intent.action,'undo');handler=()=>json({...success(),item:base});await h.performReview(item,intent);assert.deepEqual(posts.at(-1),intent);assert.match(h.reviewMessages.get(base.id),/已撤销/)});
await check('local targeted refresh loads zero solar cards and preserves full-refresh timestamp',async()=>{const h=host();h.active=true;let ids=[];h.load=async c=>{ids.push(c.placement.widget_id);return true};const at=h.lastFullRefresh;assert.equal(await h.refreshSecretary('v2'),true);assert.deepEqual(ids,['today','priorities']);assert.equal(h.revision,'v2');assert.equal(h.lastFullRefresh,at);assert(!h.cards.get('solar.trend').abort.signal.aborted)});
await check('external aggregate revision still triggers full refresh; acknowledged local version does not',async()=>{const h=host();h.active=true;let full=0;h.refresh=async()=>full++;handler=()=>json({schema_version:'1.0',revision:'external-solar',poll_seconds:2});await h.poll();assert.equal(full,1);h.revision='external-solar';await h.poll();assert.equal(full,1);h.quickBusy.add('qa');h.revision='other';await h.poll();assert.equal(full,1)});
await check('workbench authoritative record wins over older local classification cache',async()=>{const h=host();h.latestReviews.set(base.id,success('completed').item);h.openReview({...base,manual_status:'active',review_revision:'r-new'});const form=h.dialog.children[2],select=form.children[0].children[0];assert.equal(select.value,'active');select.value='completed';handler=()=>json(success('completed'));form.children[1].listeners.click();await settled();assert.equal(posts.at(-1).expected_revision,'r-new');assert.equal(posts.at(-1).status,'completed')});
await check('secretary detail/search invalidation leaves solar detail read untouched',()=>{const w=Object.create(WidgetWorkbench.prototype);Object.assign(w,{dialog:{open:true},abort:new AbortController(),sequence:0});w.invalidateSecretary(true);assert(!w.abort.signal.aborted);let reload=0;w.reloadSecretary=()=>reload++;w.invalidateSecretary(false);assert(w.abort.signal.aborted);assert.equal(reload,0);w.invalidateSecretary(true);assert.equal(reload,1)});
await check('pre-write slow page cannot overwrite confirmed item even when transport ignores abort',async()=>{const h=host(),c=h.cards.get('today');Object.assign(c,{placement:{id:'today',widget_id:'today',project_id:null,limit:1},pages:undefined,pageSize:1,offset:0,density:'compact',pageNotice:''});h.renderStatus=()=>{};let resolve;handler=(path,opts)=>opts?.method==='POST'?json(success('completed')):new Promise(r=>resolve=r);h.active=true;const old=h.load(c,true);await settled();h.active=false;await h.quickReview(base,'completed');resolve(json({schema_version:'1.0',widget_id:'today',title:'今日',status:'ok',generated_at:'2026-09-26T00:00:00Z',data_updated_at:null,timezone:'Asia/Shanghai',message:'',items:[base],metrics:[],points:[],total:1,truncated:false,source:{id:'secretary',label:'秘书'}}));await old;assert.equal(c.response.items[0].manual_status,'completed');});
async function clockTest(fn){
 const set=globalThis.setTimeout,clear=globalThis.clearTimeout;let now=0,id=0;const jobs=new Map();
 globalThis.setTimeout=(run,ms)=>{const token=++id;jobs.set(token,{run,at:now+ms});return token};
 globalThis.clearTimeout=token=>jobs.delete(token);
 const tick=ms=>{now+=ms;for(const [key,job] of [...jobs])if(job.at<=now){jobs.delete(key);job.run()}};
 try{await fn(tick)}finally{globalThis.setTimeout=set;globalThis.clearTimeout=clear}
}
await check('same status is inline only and expires after two seconds without a POST',()=>clockTest(async tick=>{
 const h=host(),before=posts.length;await h.quickReview(success().item,'active');
 assert.equal(posts.length,before);assert.equal(h.feedback.children.length,0);assert.equal(h.reviewNotices.size,0);
 assert.match(h.reviewMessage(base.id),/已是.*无需重复/);tick(1999);assert(h.reviewMessage(base.id));tick(1);assert.equal(h.reviewMessage(base.id),undefined);
}));
await check('repeated same-state feedback replaces its short timer, never stacks a banner',()=>clockTest(async tick=>{
 const h=host();await h.quickReview(success().item,'active');tick(1500);await h.quickReview(success().item,'active');tick(500);
 assert(h.reviewMessage(base.id));assert.equal(h.briefReviewNotices.size,1);assert.equal(h.feedback.children.length,0);tick(1500);assert.equal(h.reviewMessage(base.id),undefined);
}));
await check('brief same-state message preserves undo receipt and its eight-second expiry',()=>clockTest(async tick=>{
 const h=host(),item=success().item;h.showUndo(item,'status','已设为要做，秘书已确认');const receipt=h.feedback.children[0];
 tick(1000);await h.quickReview(item,'active');assert.equal(h.feedback.children[0],receipt);assert(receipt.children.some(e=>e.textContent==='撤销'));
 tick(2000);assert.equal(h.reviewMessage(base.id),'已设为要做，秘书已确认');tick(4999);assert.equal(h.feedback.children.length,1);tick(1);assert.equal(h.feedback.children.length,0);
}));
await check('new pending or failure cancels brief timer; persistent notices do not expire',()=>clockTest(async tick=>{
 const h=host();await h.quickReview(success().item,'active');h.feedbackFor(base,'正在提交到秘书AI…',true);tick(3000);
 assert.equal(h.briefReviewNotices.size,0);assert.match(h.reviewMessage(base.id),/正在提交/);
 h.feedbackFor(base,'提交结果未确认',true);tick(60000);assert.match(h.reviewMessage(base.id),/未确认/);assert.equal(h.feedback.children.length,1);
}));
const envelope=(id,items=[])=>({schema_version:'1.0',widget_id:id,title:id,status:items.length?'ok':'empty',generated_at:'2026-09-26T09:00:00Z',data_updated_at:null,timezone:'Asia/Shanghai',message:items.length?'':'当前范围没有记录',items,metrics:[],points:[],total:items.length,truncated:false,source:{id:'secretary',label:'秘书'}});
function liveHost(){const h=host();h.active=true;h.renderStatus=()=>{};h.updateNotice=()=>{};h.refreshCatalog=async()=>{};
 for(const [id,c] of h.cards)Object.assign(c,{placement:{id,widget_id:id,project_id:null},pages:undefined,pageSize:4,offset:0,density:'compact',pageNotice:'',root:{dataset:{}}});return h}
await check('save waits for accepted list pages, not merely the POST receipt',async()=>{
 const h=liveHost(),reads=[];handler=(path,opts)=>opts?.method==='POST'?json(success('completed')):new Promise(resolve=>reads.push({path,resolve}));
 let done=false;const action=h.quickReview(base,'completed').then(()=>done=true);await settled();
 assert.equal(reads.length,2);assert.equal(done,false);assert(h.quickBusy.has(base.id));assert.match(h.reviewMessage(base.id),/正在刷新组件列表/);assert.equal(h.revision,'v1');
 for(const r of reads)r.resolve(json(envelope(r.path.includes('/today')?'today':'priorities')));
 await action;assert.equal(h.cards.get('today').response.items.length,0);assert.equal(h.cards.get('priorities').response.total,0);
 assert.match(h.reviewMessage(base.id),/组件列表已更新/);assert.equal(h.secretaryNeedsSync,false);assert.equal(h.reviewReceipts.size,0);
});
await check('failed post-save GET stays dirty and poll retries only reads even when revision is unchanged',async()=>{
 const h=liveHost(),before=posts.length;
 handler=(path,opts)=>opts?.method==='POST'?json(success('completed')):json({error:'source unavailable'},503);
 await h.quickReview(base,'completed');assert.equal(posts.length,before+1);assert(h.secretaryNeedsSync);assert.equal(h.revision,'v1');
 assert.match(h.reviewMessage(base.id),/秘书已确认.*列表尚未更新/);assert(!h.reviewNotices.get(base.id).timer);assert(!h.pendingReviews.size);
 handler=path=>path.includes('/revision')?json({schema_version:'1.0',revision:'v1',poll_seconds:2}):json(envelope(path.includes('/today')?'today':'priorities'));
 await h.poll();assert.equal(posts.length,before+1);assert.equal(h.cards.get('priorities').response.items.length,0);
 assert.equal(h.secretaryNeedsSync,false);assert.match(h.reviewMessage(base.id),/组件列表已更新/);
});
await check('HTTP 200 with disconnected source is not accepted as a refreshed empty list',async()=>{
 const h=liveHost();handler=(path,opts)=>opts?.method==='POST'?json(success('completed')):json({...envelope(path.includes('/today')?'today':'priorities'),status:'disconnected',message:'秘书暂不可用'});
 await h.quickReview(base,'completed');assert(h.secretaryNeedsSync);assert.equal(h.revision,'v1');assert.equal(h.cards.get('priorities').response.items.length,1);assert.match(h.cards.get('priorities').error,/暂不可用/);
});
await check('review refresh bypasses resize debounce instead of silently skipping the list',async()=>{
 const h=liveHost(),c=h.cards.get('priorities');c.resizeTimer=setTimeout(()=>{},10000);
 handler=path=>json(envelope(path.includes('/today')?'today':'priorities'));
 assert.equal(await h.refreshSecretary('v2'),true);assert.equal(c.resizeTimer,undefined);assert.equal(c.response.items.length,0);
});
await check('hiding during resize does not permanently block later background refresh',async()=>{
 const h=liveHost(),c=h.cards.get('priorities');c.resizeTimer=setTimeout(()=>{},10000);
 h.stop();assert.equal(c.resizeTimer,undefined);handler=()=>json(envelope('priorities'));
 assert.equal(await h.load(c,true,'background'),true);assert.equal(c.response.items.length,0);
});
await check('overlapping actions cannot let an older refresh mark a newer write synchronized',async()=>{
 const h=liveHost(),reads=[];
 h.load=()=>new Promise(resolve=>reads.push(resolve));handler=(_,opts)=>json({...success('completed'),item:{...success('completed').item,id:JSON.parse(opts.body).item_id}});
 const a=h.quickReview(base,'completed');await settled();const b=h.quickReview({...base,id:'second'},'completed');await settled();
 assert.equal(reads.length,4);reads[0](true);reads[1](true);await a;assert(h.secretaryNeedsSync);assert.equal(h.revision,'v1');assert.equal(h.reviewReceipts.size,2);
 reads[2](true);reads[3](true);await b;assert.equal(h.secretaryNeedsSync,false);assert.equal(h.reviewReceipts.size,0);
 assert.match(h.reviewMessage('qa'),/组件列表已更新/);assert.match(h.reviewMessage('second'),/组件列表已更新/);
});
await check('hidden-page receipt remains dirty until reactivation performs real reads',async()=>{
 const h=liveHost();document.hidden=true;handler=()=>json(success('completed'));await h.quickReview(base,'completed');
 assert(h.secretaryNeedsSync);assert.match(h.reviewMessage(base.id),/正在刷新/);document.hidden=false;
 handler=path=>path.includes('/revision')?json({schema_version:'1.0',revision:'v2',poll_seconds:2}):json(envelope(path.includes('/today')?'today':'priorities'));
 await h.refreshSecretary();assert.equal(h.secretaryNeedsSync,false);assert.equal(h.cards.get('priorities').response.items.length,0);
});
await check('full-refresh failure does not acknowledge revision or claim synchronized on next poll',async()=>{
 const h=liveHost(),before=h.lastFullRefresh;h.load=async()=>false;
 handler=()=>json({schema_version:'1.0',revision:'v2',poll_seconds:2});await h.refresh();
 assert.equal(h.revision,'v1');assert.equal(h.lastFullRefresh,before);assert.match(h.live.textContent,/未更新/);
 let retries=0;h.refresh=async()=>retries++;await h.poll();assert.equal(retries,1);
});
for(const h of hosts)for(const n of [...h.reviewNotices.values(),...h.briefReviewNotices.values()])clearTimeout(n.timer);
console.log(`${count} review feedback checks passed; no real business requests.`);
