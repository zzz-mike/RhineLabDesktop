import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/widget-grid.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const g=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
let checks=0;const check=(v)=>{assert.ok(v);checks++};
const initial=g.pinGrid([{id:'a',columns:6,rows:4,minRows:3},{id:'b',columns:6,rows:4,minRows:3}]);
check(initial[0].x===0&&initial[1].x===6&&initial[1].y===0);
const moved=g.moveFixedGrid(initial,'a',1,7);check(moved[0].x===1&&moved[0].y===7);assert.deepEqual(moved[1],initial[1]);checks++;
check(g.moveFixedGrid(initial,'a',6,0)===null);
const smaller=g.resizeCornerGrid(initial,'a','se',-2,-1);check(smaller[0].columns===4&&smaller[0].rows===3);assert.deepEqual(smaller[1],initial[1]);checks++;
const hole=g.pinGrid(smaller.filter(i=>i.id!=='a'));check(hole[0].x===6&&hole[0].y===0);
const added=g.pinGrid([...hole,{id:'c',columns:4,rows:3,minRows:3}]);check(added[1].x===0&&added[1].y===4);
const floating=[{id:'a',x:3,y:4,columns:5,rows:4,minRows:3}];
const nw=g.resizeCornerGrid(floating,'a','nw',-2,-2);check(nw[0].x===1&&nw[0].y===2&&nw[0].columns===7&&nw[0].rows===6);
const seams=g.gridBoundaries(g.packGrid(initial,12));const shared=g.resizeGrid(initial,12,seams,1,0);check(shared&&shared[0].columns===7&&shared[1].x===7&&shared[1].columns===5);
for(const corner of ['nw','se'])for(let x=-9;x<10;x++)for(let y=-9;y<10;y++) {const r=g.resizeCornerGrid(initial,'a',corner,x,y);check(g.validFixedGrid(r));assert.deepEqual(r[1],initial[1]);}
assert.deepEqual(g.pinGrid(JSON.parse(JSON.stringify(moved))),moved);checks++;
console.log(JSON.stringify({fixedLayoutChecks:checks,passed:true}));
