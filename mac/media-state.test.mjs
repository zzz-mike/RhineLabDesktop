import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeMedia,createMediaReader} from './media-state.mjs';
test('paused source is real metadata, not idle; no extrapolation when paused',()=>{
 const s=normalizeMedia({title:'video',playing:false,elapsedTime:6,duration:25,timestamp:'2026-09-24T00:00:00Z'},Date.parse('2026-09-25T00:00:00Z'));
 assert.equal(s.status,'ok');assert.equal(s.position_seconds,6);assert.equal(s.playing,false);assert.equal(s.artwork_url,null);
});
test('playing advances from timestamp, clamps at duration, prefers supplied current time',()=>{
 const raw={title:'song',playing:true,elapsedTime:2,playbackRate:2,duration:25,timestamp:'2026-09-25T00:00:00Z'};
 assert.equal(normalizeMedia(raw,Date.parse('2026-09-25T00:00:03Z')).position_seconds,8);
 assert.equal(normalizeMedia({...raw,elapsedTimeNow:5}).position_seconds,5);
 assert.equal(normalizeMedia(raw,Date.parse('2026-09-26T00:00:03Z')).position_seconds,25);
});
test('idle differs from unknown, unsupported and failure; malformed data rejected',async()=>{
 assert.equal(normalizeMedia(null).status,'idle');assert.equal(normalizeMedia({title:'unknown'}).playing,null);
 assert.throws(()=>normalizeMedia('bad'));assert.throws(()=>normalizeMedia([]));
 const unavailable=await createMediaReader({exists:async()=>false})();assert.equal(unavailable.status,'unsupported');assert.equal(unavailable.playing,null);
 const failure=await createMediaReader({exists:async()=>true,run:async()=>{throw Error('timeout')}})();assert.equal(failure.status,'error');assert.equal(failure.title,null);
});
test('artwork is raster data only; SVG, URLs and oversized data excluded',()=>{
 assert.equal(normalizeMedia({artworkData:Buffer.from('<svg></svg>').toString('base64')}).artwork_url,null);
 assert.equal(normalizeMedia({artworkData:'https://tracker.invalid/image'}).artwork_url,null);
 assert.equal(normalizeMedia({artworkData:'a'.repeat(2_000_001)}).artwork_url,null);
 const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');assert.match(normalizeMedia({artworkData:png}).artwork_url,/^data:image\/png;/);
});
test('cache and concurrent requests spawn one fixed read-only command; stale values replaced on failure',async()=>{
 let count=0,time=0,fail=false;const reader=createMediaReader({exists:async()=>true,now:()=>time,run:async(binary,args,options)=>{count++;assert.match(binary,/media-control$/);assert.deepEqual(args,['get','--now']);assert.equal(options.timeout,3500);if(fail)throw Error();return{stdout:'{"title":"track","playing":true}'};}});
 const values=await Promise.all([reader(),reader(),reader()]);assert.equal(count,1);assert.equal(values[0].title,'track');await reader();assert.equal(count,1);time=5000;fail=true;assert.equal((await reader()).status,'error');assert.equal(count,2);
});
