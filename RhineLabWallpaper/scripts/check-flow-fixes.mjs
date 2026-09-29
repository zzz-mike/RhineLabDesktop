import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as THREE from 'three';
await build({stdin:{contents:'export * from "./src/appearance";export * from "./src/contact-shadows";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.tools/flow-check.mjs'});
const {CardAppearance,ContactShadows}=await import('../.tools/flow-check.mjs');
const appearance=new CardAppearance();
const high=new THREE.MeshPhysicalMaterial({color:'#fffdfa',transmission:.9,roughness:.21,thickness:.12,envMapIntensity:.6,attenuationDistance:2});
const low=new THREE.MeshPhysicalMaterial({color:'#fff7ed',transmission:.78,roughness:.28,envMapIntensity:.6});
const matte=new THREE.MeshStandardMaterial({color:'#fff7ed',roughness:.58,envMapIntensity:.35});
appearance.register('Frosted_Polymer',high,low);appearance.setMatteCover(matte);
const g=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),high);mesh.userData.surface='Frosted_Polymer';g.add(mesh);appearance.prepare(g);
let last=0;
for(let i=0;i<=100;i++){
 appearance.apply(g,i/100);appearance.setClarity(g,0);
 assert.ok(Math.abs(mesh.material.transmission-last)<=.009001,'no transmission jump');last=mesh.material.transmission;
 if(i===0){assert.equal(mesh.material.transmission,.000001);assert.equal(mesh.material.thickness,0);assert.equal(mesh.material.roughness,matte.roughness);assert.equal(mesh.material.envMapIntensity,matte.envMapIntensity);assert.ok(mesh.material.color.equals(matte.color));}
}
assert.equal(mesh.material.transmission,high.transmission);
appearance.setClarity(g,1);assert.equal(mesh.material.transmission,.985);
const returning=g.clone(true);appearance.prepare(returning);appearance.apply(returning,0);appearance.setClarity(returning,0);
assert.equal(returning.children[0].material.transmission,.000001);assert.equal(mesh.material.transmission,.985,'return state independent');
const viewer=g.clone(true);viewer.userData.fullOptics=true;appearance.prepare(viewer);appearance.apply(viewer,1);assert.equal(viewer.children[0].material.transmission,.9);
appearance.setMatteCover(undefined);appearance.apply(g,0);appearance.setClarity(g,0);assert.equal(mesh.material.transmission,.78,'disabled simplification restores original palette');
const contact=new ContactShadows(),source=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);
source.count=1;source.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,-4.6,0));
const moving=new THREE.Group();moving.position.set(0,-4.2,.62);
const cells=[{lane:0,row:0}],models=[{group:moving,cell:{lane:0,row:1}}];
contact.sync(source,cells,models,()=>-1);
const output=contact.group.children[0];assert.equal(output.count,2);let top=output.geometry.attributes.contactTop.array[0];assert.ok(Math.abs(top-(-.5))<.00001);
moving.position.y+=.01;contact.sync(source,cells,models,()=>-1);assert.ok(Math.abs(output.geometry.attributes.contactTop.array[0]-top-.01)<.00001,'shadow tracks movement immediately');
// Reinsert the moving file into the array: receiver shading must be identical.
source.count=2;source.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,moving.position.y,.62));
const before=output.geometry.attributes.contactTop.array[0];contact.sync(source,[...cells,models[0].cell],[],()=>-1);assert.ok(Math.abs(output.geometry.attributes.contactTop.array[0]-before)<.000001,'model-to-array handoff does not change contact shading');assert.equal(output.count,2);
console.log('PASS: matte/original endpoints, continuous lift response, independent returning state, viewer optics, live neighbor shadows and seamless reinsertion');
