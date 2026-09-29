import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ViewerFrameCache } from '../src/viewer-frame-cache.ts';
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45,1,0.1,100);
camera.position.z=5;
const material = new THREE.MeshPhysicalMaterial({ transmission:.8 });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);
const cache = new ViewerFrameCache();
assert.equal(cache.shouldRender(scene,camera,[0],0),true);
assert.equal(cache.shouldRender(scene,camera,[0],.03),false);
mesh.position.y=.001;assert.equal(cache.shouldRender(scene,camera,[0],.06),true,'small floating movement must render');
camera.position.x=.1;assert.equal(cache.shouldRender(scene,camera,[0],.09),true);
material.opacity=.9;assert.equal(cache.shouldRender(scene,camera,[0],.12),true);
assert.equal(cache.shouldRender(scene,camera,[1],.15),true,'theme/clarity input');
assert.equal(cache.shouldRender(scene,camera,[1],.18),false);
cache.invalidate();assert.equal(cache.shouldRender(scene,camera,[1],.21),true,'resize/context restore');
assert.equal(cache.shouldRender(scene,camera,[1],1.22),true,'fallback refresh');
const texture = new THREE.Texture();material.map=texture;
assert.equal(cache.shouldRender(scene,camera,[1],1.25),true);
texture.needsUpdate=true;assert.equal(cache.shouldRender(scene,camera,[1],1.28),true,'late texture upload');
let draws=0; const stable = new ViewerFrameCache();
for(let i=0;i<300;i++) draws+=Number(stable.shouldRender(scene,camera,[1],i/30));
assert.equal(draws,10,'stationary 10s at 30 updates/s draws ten fallback frames');
let animated=0;
for(let i=0;i<300;i++){mesh.position.y=Math.sin(i/30)*.1;animated+=Number(stable.shouldRender(scene,camera,[1],10+i/30));}
assert.equal(animated,300,'continuous breathing must never freeze');
console.log('PASS: camera, breathing, material, texture, resize and fallback; stationary 10/300 draws, animated 300/300. Synthetic CPU-side checks, not measured GPU savings.');
const { macPixelBudget } = await import('../src/mac-pixel-budget.ts');
const { renderDimensions, qualityPresets } = await import('../src/render-quality.ts');
for (const [w,h,dpr] of [[1920,1080,2],[1390,800,2],[390,844,3],[3440,1440,2]]) {
 const source = structuredClone(qualityPresets.original), frozen = JSON.stringify(source);
 const original = renderDimensions(source,w,h,1,dpr,16384);
 const limits = macPixelBudget(source,true,8294400);
 const low = renderDimensions(limits.quality,w,h,1,dpr,16384,limits.budget);
 assert.ok(low.width*low.height<=921600);
 assert.ok(low.width*low.height <= original.width*original.height * .5);
 assert.equal(JSON.stringify(source),frozen,'user quality untouched');
 for (const key of ['aoSamples','aoResolution','depthOfField','transmission','shadows']) assert.equal(limits.quality[key],source[key]);
 assert.deepEqual(macPixelBudget(source,false,8294400),{quality:source,budget:8294400});
}
console.log('PASS: low-load 3D pixel limits, unchanged effects, original quality restored. Pixel reduction is not a temperature measurement.');
const { normalizeMacDisplay } = await import('../src/mac-pixel-budget.ts');
assert.deepEqual(normalizeMacDisplay({scale:NaN}),{scale:null,antialias:true});
assert.equal(normalizeMacDisplay({scale:900}).scale,150);
assert.equal(normalizeMacDisplay({scale:4}).scale,50);
assert.equal(normalizeMacDisplay({scale:103}).scale,105);
for(const upstream of [921600,8294400]) {
 const q=structuredClone(qualityPresets.original);
 const sizes=[50,75,100,125,150].map(scale=>{
  const b=macPixelBudget(q,true,upstream,{scale,antialias:true},2.5);
  assert.equal(b.budget,8294400,'manual bypasses both low-load and super-performance pixel caps');
  assert.equal(b.quality.antialias,'smaa');
  assert.equal(b.quality.pixelRatio,2.5,'Chrome 125% zoom density retained');
  for(const k of ['aoSamples','depthOfField','transmission','shadows'])assert.equal(b.quality[k],q[k]);
  return renderDimensions(b.quality,1280,720,1,2.5,16384,b.budget);
 });
 assert.equal(sizes[0].width,1600);assert.equal(sizes[2].width,3200);
 assert.ok(sizes.every((s,i)=>i===0||s.width>=sizes[i-1].width));
 assert.ok(sizes.at(-1).limited,'large manual request still respects safe allocation budget');
 assert.equal(macPixelBudget(q,true,upstream,{scale:null,antialias:true},2.5).budget,921600,'automatic restores prior power-saving cap');
 assert.equal(macPixelBudget(q,true,upstream,{scale:100,antialias:false},2).quality.antialias,'off');
}
console.log('PASS: manual resolution, fractional device density, AA, cap precedence and auto-mode restoration.');
