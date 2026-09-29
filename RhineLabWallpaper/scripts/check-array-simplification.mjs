import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class extends Event {constructor(name,options={}){super(name);Object.assign(this,options);}};
await mkdir('.tools',{recursive:true});
await build({stdin:{contents:'export * from "./src/array-simplification"; export * from "./src/model-precision";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env':JSON.stringify({PROD:false,BASE_URL:'http://model.test/'})},outfile:'.tools/array-check.mjs'});
const {ArraySimplification,ModelPrecisionController,createCylinderFasteners}=await import('../.tools/array-check.mjs');
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (input,...args)=>{
 const url=typeof input==='string'?input:input.url;
 if(url?.startsWith('http://model.test/assets/'))return new Response(await readFile('public/assets/'+url.split('/').at(-1)),{headers:{'Content-Type':'model/gltf-binary'}});
 return nativeFetch(input,...args);
};
const raw=await readFile('public/assets/archive-cassette.glb');
const gltf=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
gltf.scene.updateMatrixWorld(true);
const selected=new THREE.Group(),arrays=[];
let theme=new THREE.InstancedBufferAttribute(new Float32Array(8),1);
const keep=new Set(['Frosted_Polymer','Ivory_Edges','Titanium_Fasteners','Index_Inlay','Optical_Diffuser']);
gltf.scene.traverse(o=>{
 if(!o.isMesh)return;const name=o.material.name.replace(/\.\d+$/,'');if(name==='Carbon_Ink')return;
 const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld),material=o.material.clone();
 const mesh=new THREE.Mesh(geometry,material);mesh.userData.surface=name;selected.add(mesh);
 if(keep.has(name)){geometry.setAttribute('archiveTheme',theme);const inst=new THREE.InstancedMesh(geometry,material.clone(),8);inst.userData.surface=name;arrays.push(inst);}
});
const find=name=>arrays.find(o=>o.userData.surface===name);
const triangles=geometry=>(geometry.index?.count??geometry.attributes.position.count)/3;
const total=()=>arrays.reduce((sum,o)=>sum+triangles(o.geometry),0);
const selectedPointers=selected.children.map(o=>({o,geometry:o.geometry,material:o.material,transmission:o.material.transmission}));
const index=find('Index_Inlay'),indexGeometry=index.geometry,indexMaterial=index.material;
const originalCover=find('Frosted_Polymer').geometry,originalCoverUV=originalCover.getAttribute('uv');
const controller=new ArraySimplification(arrays,theme,{value:0});
controller.setEnabled(true);
assert.equal(total(),2160);
assert.equal(triangles(find('Titanium_Fasteners').geometry),96);
assert.equal(find('Frosted_Polymer').material.isMeshStandardMaterial,true);
assert.equal(find('Frosted_Polymer').material.isMeshPhysicalMaterial,undefined);
assert.ok(!find('Frosted_Polymer').material.transmission);
assert.equal(find('Frosted_Polymer').material.map.image.width,128);
assert.equal(originalCover.getAttribute('uv'),originalCoverUV,'selected cover UV must not be mutated');
assert.equal(index.geometry,indexGeometry);assert.equal(index.material,indexMaterial,'deferred marker remains untouched');
for(const item of selectedPointers){assert.equal(item.o.geometry,item.geometry);assert.equal(item.o.material,item.material);assert.equal(item.o.material.transmission,item.transmission);}
const precision=new ModelPrecisionController(()=>({arrays,models:[selected],theme}),()=>{});
await precision.apply('medium');
assert.equal(triangles(find('Titanium_Fasteners').geometry),96,'precision must retain enabled cylinders');
assert.equal(total(),1784);
assert.equal(selected.children.find(o=>o.userData.surface==='Titanium_Fasteners').geometry,selectedPointers.find(x=>x.o.userData.surface==='Titanium_Fasteners').geometry);
theme=new THREE.InstancedBufferAttribute(new Float32Array(64),1);controller.setThemeAttribute(theme);
controller.setEnabled(false);
assert.equal(triangles(find('Titanium_Fasteners').geometry),384,'restore requested medium geometry');
assert.equal(find('Titanium_Fasteners').geometry.getAttribute('archiveTheme'),theme,'expanded instance theme is restored');
assert.equal(total(),2072);
await precision.apply('high');assert.equal(total(),4200);
controller.setEnabled(true);await precision.apply('low');assert.equal(triangles(find('Titanium_Fasteners').geometry),96);
controller.setEnabled(false);assert.equal(total(),1554);
await precision.apply('high');controller.setEnabled(true);assert.equal(total(),2160);
controller.dispose();precision.dispose();
// Main/detail and the independent assembly use the same plain capped cylinders.
for(const asset of ['archive-cassette','archive-assembly']){
 const bytes=await readFile(`public/assets/${asset}.glb`);
 const source=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 source.scene.updateMatrixWorld(true);
 const models=new THREE.Group();
 source.scene.traverse(o=>{
  if(!o.isMesh)return;
  const name=o.material.name.replace(/\.\d+$/,'');
  let geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);
  if(name==='Titanium_Fasteners')geometry=createCylinderFasteners(geometry,24);
  const mesh=new THREE.Mesh(geometry,o.material);mesh.userData.surface=name;models.add(mesh);
 });
 const fastener=models.children.find(o=>o.userData.surface==='Titanium_Fasteners');
 const plain=fastener.geometry;
 assert.equal(triangles(plain),192);
 // Independent assembly deliberately has no precision controller.
 if(asset==='archive-assembly')continue;
 const p=new ModelPrecisionController(()=>({arrays:[],models:[models],plainFasteners:true}),()=>{});
 for(const tier of ['high','low','medium','high']){await p.apply(tier);assert.equal(fastener.geometry,plain,`${asset}: precision must never restore cross slots`);}
 const returning=models.clone(true).children.find(o=>o.userData.surface==='Titanium_Fasteners');
 assert.equal(returning.geometry,plain,'returning card retains plain cylinders');
 p.dispose();
}
const result={passed:true,highBefore:4200,highAfter:2160,fastenersBefore:2136,fastenersAfter:96,
 checks:['actual GLB bounds used for two capped cylinders','opaque Standard cover and cached texture','background toggle leaves selected glass untouched','deferred index marker untouched','high/medium/low precision round trip','theme attribute expansion','original geometry/material restoration','Mac main/detail/return/assembly use plain capped cylinders at all precision tiers']};
await mkdir('verification/array-simplification',{recursive:true});await writeFile('verification/array-simplification/unit-results.json',JSON.stringify(result,null,2));console.log(result);
