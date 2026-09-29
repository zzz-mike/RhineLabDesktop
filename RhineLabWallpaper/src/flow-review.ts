// Reproducible paused-scene checks. Not imported by the production entry.
import {ArchiveScene} from './scene';
import {qualityPresets} from './render-quality';
import {performanceMarkup} from './mac-performance';
import {mountMarkerControl} from './index-marker';
import './index-marker.css';
import {fileAtCell} from './archive-loop';
document.querySelector('#settings')!.innerHTML=performanceMarkup();mountMarkerControl();
const status=document.querySelector('#status')!;
function change(selector:string,value:string|boolean){const el=document.querySelector<HTMLInputElement>(selector)!;if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
async function cool(limit:number){const s=await(await fetch('/__review')).json();if(!s||Date.now()-s.timeMs>3500||s.cpuMaxC>=limit)throw Error('温度保护，保持停止');}
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 let a:ArchiveScene|undefined;const errors:string[]=[];let time=100;
 try{
 await cool(65);status.textContent='检查中';change('[data-mac-display="mode"]','auto');change('[data-mac-plugin="lowLoad"]',false);change('[data-mac-shadow-mode]','off');
 a=new ArchiveScene(document.querySelector<HTMLElement>('#view')!);const s=a as any;
 a.renderer.debug.onShaderError=(g,p,v,f)=>errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].join('\n'));
 a.setQuality({...qualityPresets.original,pixelRatio:1,depthOfField:0,aoSamples:0,antialias:'smaa'});await a.load();a.setMode('archive');a.select(0);a.revealImmediately();
 const step=(count:number)=>{const render=s.composer.render, direct=a!.renderer.render;s.composer.render=()=>{};a!.renderer.render=()=>{};for(let i=0;i<count;i++){time+=1/60;a!.update(time);}s.composer.render=render;a!.renderer.render=direct;};change('[data-mac-shadow-mode]','texture');a.resize();step(300);
 const cover=(group:any)=>group.children.find((o:any)=>o.userData.surface==='Frosted_Polymer');
 const pictures:Record<string,Uint8ClampedArray>={};
 const snap=async(name:string)=>{
  await cool(73);a!.renderer.info.reset();if(s.superPerformance)a!.renderer.render(s.scene,s.camera);else s.composer.render();
  const canvas=document.createElement('canvas');canvas.width=a!.renderer.domElement.width;canvas.height=a!.renderer.domElement.height;
  const c=canvas.getContext('2d')!;c.drawImage(a!.renderer.domElement,0,0);pictures[name]=c.getImageData(0,0,canvas.width,canvas.height).data;
  const array=s.instances.find((o:any)=>o.userData.surface==='Index_Inlay');
  const indices=s.drawnCells.map((cell:any,i:number)=>({file:fileAtCell(cell),actual:array.geometry.attributes.archiveRecord.array[i]}));
  if(indices.some((x:any)=>x.file!==x.actual))throw Error('Array number mismatch');
  const covers=[s.model,...s.outgoing.map((o:any)=>o.group)].map((g:any)=>({position:g.position.toArray(),quality:cover(g).userData.appearance.value,transmission:cover(g).material.transmission,color:cover(g).material.color.toArray(),marker:g.children.find((o:any)=>o.userData.surface==='Index_Inlay')?.userData.indexRecord}));
  const payload={name,png:canvas.toDataURL('image/png'),stats:a!.getStats(),draw:{...a!.renderer.info.render},covers,indices:indices.slice(0,12),errors};
  await fetch('/__review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(errors.length)throw Error(errors.join('\n'));
 };
 for(const mode of ['off','original','texture']){change('[data-mac-shadow-mode]',mode);a.resize();s.scene.updateMatrixWorld();a.renderer.shadowMap.needsUpdate=true;await snap('shadow-'+mode);if(mode==='original'){s.ao.enabled=false;await snap('original-no-ao');}}
 const diff=(left:string,right:string)=>{const x=pictures[left],y=pictures[right];let n=0,sum=0;for(let i=0;i<x.length;i+=4){const d=Math.max(Math.abs(x[i]-y[i]),Math.abs(x[i+1]-y[i+1]),Math.abs(x[i+2]-y[i+2]));if(d>3)n++;sum+=d;}return {pixels:n,mean:sum/(x.length/4)};};
 await fetch('/__review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'shadow-differences',identicalSceneTransforms:true,originalWithAO:diff('shadow-off','shadow-original'),originalWithoutAO:diff('shadow-off','original-no-ao'),textureWithoutAO:diff('shadow-off','shadow-texture')})});
 change('[data-mac-shadow-mode]','off');a.resize();change('#index-marker-choice','number');a.resize();
 for(const [name,index] of [['pick-first',1],['pick-second',2],['pick-back',0]] as const){a.select(index);step(10);await snap(name);}
 step(70);await snap('returning');step(200);await snap('settled');
 for(const mode of ['hidden','original','number']){change('#index-marker-choice',mode);a.resize();await snap('array-'+mode);}
 a.setMode('detail');step(300);
 for(const mode of ['hidden','original','number']){change('#index-marker-choice',mode);a.resize();await snap('detail-'+mode);}
 a.setTheme(true,true);step(2);await snap('detail-dark-number');
 const viewer=await a.createAssemblyModel();const mark=viewer.model.children.find(o=>o.userData.surface==='Index_Inlay');if(mark?.userData.indexRecord!==0)throw Error('Viewer number mismatch');viewer.dispose();
 a.setTheme(false,true);a.setMode('archive');a.setSuperPerformance(true);step(300);await snap('super-number');a.setSuperPerformance(false);
 change('#index-marker-choice','original');a.resize();
 status.textContent='通过：快速换选、归位、编号映射和三种方块样式；截图与阴影差异记录已保存。三维已释放。';
 }catch(e){status.textContent=String(e);}finally{a?.dispose();}
};
