import * as THREE from 'three';
import { records, archiveDisplayNumber } from './data';

export type MarkerMode = 'hidden' | 'original' | 'number';
const active = new URLSearchParams(location.search).get('mac') === '1';
export const normalizeMarkerMode = (v: unknown): MarkerMode => v === 'hidden' || v === 'number' ? v : 'original';
let mode: MarkerMode = 'original';
try { mode = normalizeMarkerMode(localStorage.getItem('rhine-index-marker')); } catch {}
const modeUniform = { value: Number(mode === 'number') };
export const markerMode = () => active ? mode : 'original';
const isMarker = (o: THREE.Mesh) => (o.userData.surface ?? (o.material as THREE.Material).name.replace(/\.\d+$/, '')) === 'Index_Inlay';
export function applyMarkerVisibility(root: THREE.Object3D) {
  if (active) root.traverse(o => { if (o instanceof THREE.Mesh && isMarker(o)) o.visible = mode !== 'hidden'; });
}
export function mountMarkerControl() {
  if (!active || document.querySelector('#index-marker-test')) return;
  const panel = document.createElement('aside');panel.id='index-marker-test';panel.setAttribute('aria-label','小方块效果对比');
  panel.innerHTML = `<label>小方块对比 <select aria-label="小方块效果" id="index-marker-choice"><option value="hidden">1 · 同色隐藏</option><option value="original">2 · 保留原样</option><option value="number">3 · 显示序号</option></select></label>`;
  document.body.append(panel);
  const select = panel.querySelector('select')!;select.value=mode;
  select.addEventListener('change',()=>{
    mode=normalizeMarkerMode(select.value);modeUniform.value=Number(mode==='number');
    try {localStorage.setItem('rhine-index-marker',mode);} catch {}
    window.dispatchEvent(new Event('rhine-mac-performance-change'));
  });
}

/** A shared numeric atlas in the existing inlay draw; never one canvas per file. */
export class IndexMarker {
  private atlas: THREE.CanvasTexture;
  private uniforms = new WeakMap<THREE.Mesh,{value:number}>();
  private columns=Math.max(8,Math.ceil(Math.sqrt(records.length)));
  private rows=Math.max(1,Math.ceil(records.length/this.columns));
  constructor() {
    const canvas=document.createElement('canvas');canvas.width=this.columns*128;canvas.height=this.rows*128;
    const c=canvas.getContext('2d')!;c.fillStyle='#000';c.fillRect(0,0,canvas.width,canvas.height);
    c.fillStyle='#fff';c.font='bold 58px monospace';c.textAlign='center';c.textBaseline='middle';
    records.forEach((_,i)=>c.fillText(archiveDisplayNumber(i),(i%this.columns)*128+64,Math.floor(i/this.columns)*128+64,112));
    this.atlas=new THREE.CanvasTexture(canvas);this.atlas.name='archive-index-numbers';
    this.atlas.minFilter=THREE.LinearMipmapLinearFilter;this.atlas.magFilter=THREE.LinearFilter;
  }
  attach(mesh: THREE.Mesh, instanced=false) {
    mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;
    const bounds={value:new THREE.Vector4(box.min.x,box.min.y,box.max.x-box.min.x,box.max.y-box.min.y)};
    const record={value:Number(mesh.userData.indexRecord??0)};this.uniforms.set(mesh,record);
    const mat=mesh.material as THREE.Material,before=mat.onBeforeCompile,key=mat.customProgramCacheKey();
    const atlas=this.atlas,columns=this.columns,rows=this.rows;
    mat.onBeforeCompile=(shader,renderer)=>{
      before.call(mat,shader,renderer);
      Object.assign(shader.uniforms,{indexMarkerMode:modeUniform,indexMarkerRecord:record,indexMarkerBounds:bounds,indexMarkerAtlas:{value:atlas}});
      shader.vertexShader=`uniform vec4 indexMarkerBounds; varying vec2 indexMarkerUV; varying float indexMarkerRecordV; ${instanced?'attribute float archiveRecord;':'uniform float indexMarkerRecord;'}\n`+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nindexMarkerUV=(position.xy-indexMarkerBounds.xy)/indexMarkerBounds.zw; indexMarkerRecordV=${instanced?'archiveRecord':'indexMarkerRecord'};`);
      shader.fragmentShader='uniform float indexMarkerMode; uniform sampler2D indexMarkerAtlas; varying vec2 indexMarkerUV; varying float indexMarkerRecordV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
        if(indexMarkerMode > 0.5){
          float n=floor(indexMarkerRecordV+0.5);
          vec2 tile=vec2(mod(n,${columns}.0),${rows-1}.0-floor(n/${columns}.0));
          vec2 uv=(tile+clamp(indexMarkerUV,vec2(0.001),vec2(0.999)))/vec2(${columns}.0,${rows}.0);
          float ink=texture2D(indexMarkerAtlas,uv).r;
          float luma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
          diffuseColor.rgb=mix(diffuseColor.rgb,luma<.12?vec3(.92):vec3(.018),ink);
        }
        #include <roughnessmap_fragment>`);
    };
    mat.customProgramCacheKey=()=>`${key}-index-marker-${instanced}`;
    mat.needsUpdate=true;mesh.visible=markerMode()!=='hidden';
  }
  setRecord(group: THREE.Group,index:number) {
    group.traverse(o=>{if(o instanceof THREE.Mesh && isMarker(o)){
      o.userData.indexRecord=index;const uniform=this.uniforms.get(o);if(uniform)uniform.value=index;
    }});
  }
  dispose(){this.atlas.dispose();}
}
