import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createIntegrationBridge, coalesceReads} from './integration-bridge.mjs';

test('invalidating flights keeps old work inside the concurrency bound', async () => {
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const shared = coalesceReads(async () => { const value = ++count; await gate; return value; }, {maxPending:1});
  const first = shared('same');
  const joined = shared('same');
  shared.invalidate();
  await assert.rejects(shared('same'), error => error.code === 'request_queue_full');
  release();
  assert.deepEqual(await Promise.all([first, joined]), [1,1]);
  assert.equal(await shared('same'), 2);
});

// No real source requests or database mutations: both transports are injected.
for (const outcome of ['confirmed', 'conflict', 'unknown']) {
  test(`post-review reads cannot reuse a pre-write flight (${outcome})`, async t => {
    let version = 1, reads = 0, releaseOld, started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    const firstGate = new Promise(resolve => { releaseOld = resolve; });
    let handler;
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port, base = `http://127.0.0.1:${port}`;
    t.after(async () => { releaseOld(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
    handler = createIntegrationBridge({port,
      secretary: async () => {
        const snapshot = version;
        if (++reads === 1) { started(); await firstGate; }
        return {status:200, data:{schema_version:'1.0', version:snapshot}};
      },
      secretaryReview: async () => {
        version = 2;
        if (outcome === 'unknown') throw Error('response lost after source commit');
        return outcome === 'conflict'
          ? {status:409, data:{code:'revision_conflict'}}
          : {status:200, data:{schema_version:'1.0', ok:true}};
      },
    });
    const get = path => fetch(base + path, {headers:{'X-Rhine-Local':'1'}}).then(r => r.json());
    const old = get('/api/secretary/widgets/v1/priorities');
    await firstStarted;
    const caps = await get('/api/local/v1/capabilities');
    const response = await fetch(base + '/api/secretary/widgets/v1/review', {
      method:'POST', headers:{'X-Rhine-Local':'1', 'X-Rhine-Action-Token':caps.secretary_review_token,
        Origin:base, 'Content-Type':'application/json'},
      body:JSON.stringify({request_id:crypto.randomUUID(), item_id:'fixture-only', expected_revision:'r1', action:'status', status:'completed'}),
    });
    await response.json();
    const fresh = get('/api/secretary/widgets/v1/priorities');
    // A new read should finish even while the old read remains blocked.
    const early = await Promise.race([fresh, new Promise(resolve => setTimeout(() => resolve(null), 150))]);
    releaseOld();
    assert.equal((await old).version, 1, 'existing readers retain their actual snapshot');
    assert.equal((await fresh).version, 2, 'fresh request observes the source after the action');
    assert.equal(early?.version, 2, 'fresh request does not wait for the old in-flight GET');
    assert.equal(reads, 2);
  });
}
