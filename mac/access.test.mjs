import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,parse} from 'node:path';
import {createLocalServer} from './server.mjs';
import {DesktopFiles} from './desktop-files.mjs';
import {AccessState} from './access.mjs';
async function setup(t,extra={}) {
  const base=await mkdtemp(join(tmpdir(),'rhine-consent-')),root=join(base,'web'),folder=join(base,'selected');await mkdir(root);await mkdir(folder);
  await writeFile(join(root,'index.html'),'<head></head><body>TEST</body>');await writeFile(join(folder,'fixture.txt'),'SELECTED_TEXT');
  let reads=0;
  const {server,access}=createLocalServer({root,picker:async()=>folder,filesFactory:path=>{reads++;return new DesktopFiles({root:path,summaryPath:null});},...extra});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(base,{recursive:true,force:true});});
  const get=(path,options={})=>fetch(url+path,{...options,headers:{'X-Rhine-Local':'1',...options.headers}});
  const post=(route,data={},headers={})=>get('/api/access/'+route,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Rhine-Consent':access.token,...headers},body:JSON.stringify(data)});
  return {folder,access,url,get,post,reads:()=>reads};
}
test('new local server never creates a file reader or enables services before consent',async t=>{
  const f=await setup(t);
  for(const path of ['/','/__rhine_health','/connections','/api/access/state','/api/local/v1/capabilities'])assert.equal((await f.get(path)).status,200);
  for(const path of ['/api/desktop/v1/catalog','/api/secretary/widgets/v1/today','/api/solar/v1/catalog','/api/media/v1/state'])assert.equal((await f.get(path)).status,403);
  assert.equal(f.reads(),0);
  const c=await(await f.get('/api/local/v1/capabilities')).json();assert.equal(c.desktop_read,false);assert.equal(c.secretary_review,false);assert.equal(c.solar_read,false);assert.equal(c.media_read,false);assert.equal(c.action_token,null);
});
test('consent writes need same-origin, explicit session token, local header and valid payload',async t=>{
  const f=await setup(t);
  assert.equal((await f.post('select',{}, {'X-Rhine-Consent':'invalid'})).status,403);
  assert.equal((await f.post('select',{}, {Origin:'https://example.org'})).status,403);
  assert.equal((await f.post('select',{}, {'X-Rhine-Local':'0'})).status,403);
  assert.equal((await f.post('select',{path:homedir()})).status,400);
  assert.equal(f.access.root,null);assert.equal(f.reads(),0);
});
test('folder picker grants only the selected folder; preview allowed, actions and other services still off',async t=>{
  const f=await setup(t);assert.equal((await f.post('select')).status,200);
  const s=f.access.snapshot();assert.equal(s.root,await realpath(f.folder));assert.equal(s.desktop,true);assert.equal(s.file_actions,false);assert.equal(s.secretary,false);
  const catalog=await f.get('/api/desktop/v1/catalog');assert.equal(catalog.status,200);
  const data=await catalog.json();const file=data.columns.flatMap(c=>c.entries).find(e=>e.name==='fixture.txt');assert.ok(file);
  const preview=await(await f.get('/api/desktop/v1/preview?id='+encodeURIComponent(file.id))).json();assert.equal(preview.text,'SELECTED_TEXT');
  const action=await f.get('/api/desktop/v1/action',{method:'POST',headers:{Origin:f.url,'Content-Type':'application/json'},body:JSON.stringify({id:file.id,action:'open'})});assert.equal(action.status,403);
});
test('revoke drops current folder, all permissions and old file identities; reselect does not revive tokens',async t=>{
  const f=await setup(t);await f.post('select');const before=f.access.revision;
  const opts={file_actions:true,secretary:true,solar:true,media:true};assert.equal((await f.post('options',opts)).status,200);
  const caps=await(await f.get('/api/local/v1/capabilities')).json();assert.ok(caps.action_token);
  assert.equal((await f.post('revoke')).status,200);assert.notEqual(f.access.revision,before);assert.equal(f.access.root,null);
  for(const key of Object.keys(opts))assert.equal(f.access.flags[key],false);
  assert.equal((await f.get('/api/desktop/v1/catalog')).status,403);
  await f.post('select');await f.post('options',{...opts,secretary:false,solar:false,media:false});
  const fresh=await(await f.get('/api/local/v1/capabilities')).json();assert.notEqual(caps.action_token,fresh.action_token);
});
test('options cannot enable file actions without a selected folder or smuggle arbitrary permissions',async t=>{
  const f=await setup(t);
  assert.equal((await f.post('options',{file_actions:true,secretary:false,solar:false,media:false})).status,400);
  assert.equal((await f.post('options',{file_actions:false,secretary:false,solar:false,media:false,root:'/'})).status,400);
  assert.equal((await f.post('options',{file_actions:false,secretary:'yes',solar:false,media:false})).status,400);
  assert.equal(f.access.root,null);
});
test('cancelled picker leaves permissions unchanged and revocation wins over an outstanding picker',async t=>{
  const f=await setup(t);const old=f.access.snapshot();f.access.picker=async()=>null;await f.access.select();assert.deepEqual(f.access.snapshot(),old);
  let finish;f.access.picker=()=>new Promise(r=>finish=r);const selection=f.access.select();f.access.revoke();finish(f.folder);await assert.rejects(selection,/selection_cancelled/);assert.equal(f.access.root,null);
});
test('picker cannot grant filesystem root or entire home',async()=>{
  for(const folder of [parse(homedir()).root,homedir()]){const state=new AccessState({picker:async()=>folder});await assert.rejects(state.select(),/choose_specific_folder/);assert.equal(state.root,null);}
});
test('server restart has no remembered grants and fresh session token',()=>{
  const a=new AccessState(),b=new AccessState();a.root='/a';a.flags.secretary=true;assert.equal(b.root,null);assert.equal(b.flags.secretary,false);assert.notEqual(a.token,b.token);
});
test('revocation terminates outstanding sensitive responses',async t=>{
  let began;const started=new Promise(r=>began=r);
  const f=await setup(t,{bridgeFactory:()=>async(_req,res)=>{began();await new Promise(r=>setTimeout(r,120));if(!res.destroyed){res.writeHead(200);res.end('STALE_PRIVATE');}return true;}});
  await f.post('select');const reading=f.get('/api/desktop/v1/catalog').then(r=>r.text()).catch(()=>'ABORTED');await started;await f.post('revoke');assert.equal(await reading,'ABORTED');
});
