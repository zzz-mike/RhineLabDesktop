import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {secretaryTarget,validateProjectReviewBody,coalesceReads,createSecretaryReviewClient,createIntegrationBridge} from './integration-bridge.mjs';

const uuid='1c59486a-625a-4c29-bb94-bd44f0d00f70';
const note={stage:'安装中',blocker:'',next_step:'核对材料\n安排验收',owner:'待确认'};
const intent={request_id:uuid,project_id:'secretary:project:test',expected_revision:'r1',action:'note',note};
const target=s=>secretaryTarget(new URL('http://local/api/secretary/widgets/v1/'+s));

test('V3 detail and search routes have distinct bounded query contracts',()=>{
 for(const s of ['items?status=completed&query=施工&limit=50','item-detail?item_id=x&section=evidence&limit=30','project-detail?project_id=p&section=finance&offset=100&snapshot_revision=rv'])assert.equal(target(s),'/api/widgets/v1/'+new URL('http://local/'+s).href.split('http://local/')[1]);
 for(const s of ['items?limit=51','items?status=deleted','items?query='+ 'a'.repeat(121),'items?query=a&query=b','item-detail','item-detail?item_id=x&section=finance','item-detail?item_id=x&limit=31','project-detail?section=files','project-detail?project_id=p&section=evidence','project-detail?project_id=p&url=http://evil','project-review','item?item_id=x&section=overview'])assert.throws(()=>target(s),s);
});
test('project mutation admits only note and pin with exact shape and safe text',()=>{
 assert.deepEqual(validateProjectReviewBody(intent),intent);
 const pin={request_id:uuid,project_id:'p',expected_revision:'r',action:'pin',pinned:false};
 assert.equal(validateProjectReviewBody(pin).pinned,false);
 for(const body of [{...intent,action:'finance'},{...intent,extra:true},{...intent,note:{...note,path:'/etc/passwd'}},{...intent,note:{...note,stage:'a'.repeat(2001)}},{...intent,note:{...note,owner:'a\0b'}},{...pin,pinned:1},{...intent,request_id:'wrong'},{...intent,expected_revision:''},{...intent,project_id:'p\nx'}])assert.throws(()=>validateProjectReviewBody(body));
});
test('pending read coalescing shares concurrent work only, then observes new data',async()=>{
 let calls=0,release;
 const read=coalesceReads(async key=>{calls++;await new Promise(r=>release=r);return {key,calls};});
 const a=read('same'),b=read('same');await Promise.resolve();assert.equal(calls,1);release();
 assert.deepEqual(await a,await b);
 const c=read('same');await Promise.resolve();assert.equal(calls,2);release();await c;
});
test('failed read flights are not cached and pending cardinality is bounded',async()=>{
 let calls=0;
 const failed=coalesceReads(async()=>{calls++;throw Error('unavailable');});
 await assert.rejects(failed('x'));await assert.rejects(failed('x'));assert.equal(calls,2);
 let release;const bounded=coalesceReads(()=>new Promise(r=>release=r),{maxPending:1});
 const a=bounded('a');await Promise.resolve();await assert.rejects(bounded('b'),e=>e.status===503);release({});await a;
});
test('project retry snapshots nested note and does not use general action token',async()=>{
 const calls=[];let begin;
 const read=createSecretaryReviewClient({project:true,transport:async(method,path,options)=>{
   calls.push({method,path,body:options.body,token:options.token});
   if(method==='GET'){await new Promise(r=>begin=r);return{status:200,data:{schema_version:'1.0',scope:'widgets:review',review_token:'private'}};}
   return {status:200,data:{schema_version:'1.0',ok:true}};
 }});
 const body={...intent,note:{...note}};const pending=read(body);body.note.stage='different';begin();await pending;
 assert.equal(calls[1].path,'/api/widgets/v1/project-review');assert.equal(calls[1].body.note.stage,'安装中');assert.equal(calls[1].token,'private');
});

test('HTTP project action is separate, protected, 16KiB bounded and preserves safe conflicts',async t=>{
 let handle,calls=0;
 const server=http.createServer((req,res)=>handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port,base=`http://127.0.0.1:${port}`;
 handle=createIntegrationBridge({port,solar:async()=>({status:200,data:{schema_version:'1.0',resource:'catalog'}}),secretaryProjectReview:async body=>{
   calls++;return{status:409,data:{code:'revision_conflict',error:'/private/token',current_project:{project_id:body.project_id,project_name:'项目',review_revision:'new',pinned:false,note,secret:'hidden'}}};
 }});
 const get=path=>fetch(base+path,{headers:{'X-Rhine-Local':'1'}});
 const caps=await(await get('/api/local/v1/capabilities')).json();
 assert.equal(caps.secretary_details,true);assert.equal(caps.secretary_project_review,true);assert.equal(caps.solar_read,true);
 const post=(body,extra={})=>fetch(base+'/api/secretary/widgets/v1/project-review',{method:'POST',headers:{Origin:base,'X-Rhine-Local':'1','X-Rhine-Action-Token':caps.secretary_review_token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 assert.equal((await post(intent,{'X-Rhine-Action-Token':'wrong'})).status,403);
 assert.equal((await post(intent,{Origin:'http://evil.invalid'})).status,403);assert.equal(calls,0);
 const conflict=await post(intent);assert.equal(conflict.status,409);const d=await conflict.json();assert.equal(d.current_project.review_revision,'new');assert.equal(d.current_project.secret,undefined);assert.equal(d.error,'revision_conflict');
 assert.equal((await post({...intent,note:{stage:'中'.repeat(2000),blocker:'中'.repeat(2000),next_step:'中'.repeat(2000),owner:'中'.repeat(2000)}})).status,413);
 assert.equal((await get('/api/solar/v1/catalog')).status,200);
 assert.equal((await fetch(base+'/api/solar/v1/catalog')).status,403);
 assert.equal((await fetch(base+'/api/solar/v1/catalog',{method:'POST',headers:{Origin:base,'X-Rhine-Local':'1'}})).status,405);
});
