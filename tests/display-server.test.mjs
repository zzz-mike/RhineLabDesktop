import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createDisplayServer} from '../runtime/static-server.mjs';
async function setup(t) {
  const base=await mkdtemp(join(tmpdir(),'rhine-display-')),root=join(base,'web');await mkdir(root);
  await writeFile(join(root,'index.html'),'<html><head></head><body>DISPLAY_FIXTURE</body></html>');await writeFile(join(root,'asset.txt'),'abcdef');await writeFile(join(base,'private.txt'),'OUTSIDE_PRIVATE');
  const server=createDisplayServer({root});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(base,{recursive:true,force:true});});
  return {base,root,port:server.address().port,url:`http://127.0.0.1:${server.address().port}`};
}
test('display serves built UI and refuses every local integration, including query overrides',async t=>{
  const {url}=await setup(t);
  for(const query of ['','?mac=1','?display=1']) {const r=await fetch(url+'/'+query);assert.equal(r.status,200);assert.match(await r.text(),/DISPLAY_FIXTURE/);}
  for(const route of ['desktop/v1/catalog','desktop/v1/preview?id=1','secretary/widgets/v1/today','solar/v1/catalog','media/v1/state','access/state','local/v1/capabilities'])assert.equal((await fetch(url+'/api/'+route)).status,404);
  assert.equal((await (await fetch(url+'/__rhine_health')).json()).local_files,false);
});
test('display only serves the chosen asset root on POSIX and Windows paths',async t=>{
  const {url}=await setup(t);
  for(const path of ['/%2e%2e/private.txt','/..%5cprivate.txt','/%2e%2e%2fprivate.txt','/C:%5cWindows%5cwin.ini','/%00secret','/.env']){const r=await fetch(url+path);assert.equal(r.status,404);assert.doesNotMatch(await r.text(),/OUTSIDE_PRIVATE/);}
});
test('display rejects filesystem symlinks escaping its asset root',async t=>{
  const {url,root,base}=await setup(t);
  try{await symlink(join(base,'private.txt'),join(root,'linked.txt'));}catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows account cannot create symbolic links');return;}throw e;}
  assert.equal((await fetch(url+'/linked.txt')).status,404);
});
test('display denies foreign origins, cross-site fetches, unexpected host and writes',async t=>{
  const {url,port}=await setup(t);
  assert.equal((await fetch(url+'/',{headers:{Origin:'https://example.org'}})).status,403);
  assert.equal((await fetch(url+'/',{method:'POST',body:'x'})).status,405);
  const code=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/',headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);});assert.equal(code,403);
});
test('display supports HEAD and bounded range requests without leaking extra bytes',async t=>{
  const {url}=await setup(t);
  const head=await fetch(url+'/asset.txt',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const range=await fetch(url+'/asset.txt',{headers:{Range:'bytes=1-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'bcd');
  assert.equal((await fetch(url+'/asset.txt',{headers:{Range:'bytes=90-99'}})).status,416);
});
