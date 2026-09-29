import * as THREE from 'three';
import type {ArchiveCell} from './archive-loop';
const cellKey = (cell:ArchiveCell) => `${cell.lane}:${cell.row}`;
import {InstanceUpdates} from './instance-updates';

/** Precomputed soft contact shading, not another live shadow-map or AO pass.
 * A neighbouring file masks ambient light below its top edge. Its real height
 * drives the texture each frame, including selected and returning files.
 */
export class ContactShadows {
  readonly group = new THREE.Group();
  private geometry = new THREE.PlaneGeometry(5, 3.7).translate(0, 1.85, .208);
  private material: THREE.MeshBasicMaterial;
  private mesh?: THREE.InstancedMesh;
  private matrices?: InstanceUpdates;
  private heights?: InstanceUpdates;
  private matrix = new THREE.Matrix4();
  private top = new THREE.Vector3();
  constructor() {
    const pixels = new Uint8Array(128 * 4);
    for (let i = 0; i < 128; i++) {
      const alpha = Math.round(255 * (1 - THREE.MathUtils.smoothstep(i / 127, 0, 1)));
      pixels.set([alpha, alpha, alpha, 255], i * 4);
    }
    const texture = new THREE.DataTexture(pixels, 1, 128);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;texture.needsUpdate = true;
    this.material = new THREE.MeshBasicMaterial({color:'#514536',alphaMap:texture,transparent:true,opacity:.3,depthWrite:false,side:THREE.FrontSide,fog:true});
    this.material.onBeforeCompile = shader => {
      shader.vertexShader='attribute float contactTop; varying float vContactTop; varying float vContactY; varying vec2 vContactUV;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
        vContactTop=contactTop;vContactUV=uv;
        vContactY=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).y;`);
      shader.fragmentShader='varying float vContactTop; varying float vContactY; varying vec2 vContactUV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphamap_fragment>',`
        diffuseColor.a *= texture2D(alphaMap,vec2(.5,clamp((vContactY-vContactTop+.15)/.75,0.0,1.0))).g;
        diffuseColor.a *= smoothstep(0.0,.018,min(vContactUV.x,1.0-vContactUV.x));
      `);
    };
    this.material.customProgramCacheKey=()=> 'mac-contact-texture-v1';
    this.group.name='mac-contact-shadows';
  }
  sync(source:THREE.InstancedMesh,cells:ArchiveCell[],models:{group:THREE.Group;cell:ArchiveCell}[],baseTop:(cell:ArchiveCell)=>number) {
    const count=source.count+models.length;
    const countChanged=this.mesh?.count!==count;
    if(!this.mesh||this.mesh.instanceMatrix.count<count){
      if(this.mesh){this.group.remove(this.mesh);this.mesh.dispose();}
      this.mesh=new THREE.InstancedMesh(this.geometry,this.material,Math.max(64,count*2));
      this.mesh.frustumCulled=false;this.mesh.layers.set(1);this.mesh.renderOrder=2;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const heights=new THREE.InstancedBufferAttribute(new Float32Array(this.mesh.instanceMatrix.count),1).setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('contactTop',heights);
      this.matrices=new InstanceUpdates(this.mesh.instanceMatrix);this.heights=new InstanceUpdates(heights);
      this.group.add(this.mesh);
    }
    this.mesh.count=count;
    const tops=new Map<string,number>();
    // Populate all current casters before receivers; reselecting the same file
    // cannot leave a stale texture behind at its former array slot.
    for(let i=0;i<source.count;i++){
      source.getMatrixAt(i,this.matrix);this.matrices!.set(i*16,this.matrix.elements);
      tops.set(cellKey(cells[i]),this.top.set(0,3.7,.208).applyMatrix4(this.matrix).y);
    }
    for(let i=0;i<models.length;i++){
      const {group,cell}=models[i];this.matrix.compose(group.position,group.quaternion,group.scale);
      this.matrices!.set((source.count+i)*16,this.matrix.elements);
      tops.set(cellKey(cell),this.top.set(0,3.7,.208).applyMatrix4(this.matrix).y);
    }
    for(let i=0;i<count;i++){
      const cell=i<source.count?cells[i]:models[i-source.count].cell;
      const neighbor={lane:cell.lane,row:cell.row+1};
      this.heights!.scalar(i,tops.get(cellKey(neighbor))??baseTop(neighbor));
    }
    const matricesChanged=this.matrices!.commit(),heightsChanged=this.heights!.commit();
    // Scene world matrices are updated once after this sync.
    return countChanged||matricesChanged||heightsChanged;
  }
}
