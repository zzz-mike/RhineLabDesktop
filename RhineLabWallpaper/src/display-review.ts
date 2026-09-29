// Diagnostic entry, excluded from production; no continuous render loop.
import {ArchiveScene} from './scene';
import {qualityPresets} from './render-quality';
import {performanceMarkup} from './mac-performance';
document.querySelector('#plugins')!.innerHTML=performanceMarkup();
const status=document.querySelector('#status')!;
function change(selector:string,value:string|boolean){const el=document.querySelector<HTMLInputElement>(selector)!;if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
async function cool(limit:number){const s=await(await fetch('/__review')).json();if(!s||Date.now()-s.timeMs>3500||s.cpuMaxC>=limit)throw Error('温度保护，保持停止');}
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 let a:ArchiveScene|undefined;const results:any[]=[];const errors:string[]=[];
 try{
  await cool(65);status.textContent='检查中';
  change('[data-mac-display="mode"]','auto');change('[data-mac-plugin="lowLoad"]',true);
  a=new ArchiveScene(document.querySelector<HTMLElement>('#view')!);const s=a as any;
  a.renderer.debug.onShaderError=(g,p,v,f)=>errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].join('\n'));
  a.setQuality({...qualityPresets.original,pixelRatio:1});await a.load();a.setMode('detail');a.revealImmediately();
  const render=s.composer.render;s.composer.render=()=>{};for(let i=0;i<300;i++)a.update(100+i/60);s.composer.render=render;
  const surface=(root:any)=>{let triangles=0;root.traverse((o:any)=>{if(o.userData.surface==='Titanium_Fasteners')triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});return triangles;};
  const source=await a.createAssemblyModel();
  const assemblyTriangles=surface(source.model);
  for(const name of ['auto','manual-low','manual-high','manual-super','auto-restored']){
   await cool(72);
   change('[data-mac-display="mode"]',name.startsWith('auto')?'auto':'manual');
   if(!name.startsWith('auto'))change('[data-mac-display="scale"]',name==='manual-low'?'50':'100');
   a.setSuperPerformance(name==='manual-super');a.setQuality({...qualityPresets.original,pixelRatio:1});a.resize();
   s.composer.render();
   const item={name,display:JSON.parse(a.renderer.domElement.parentElement!.dataset.renderQuality!),smaa:s.smaa.enabled,selectedFastenerTriangles:surface(s.model),assemblyFastenerTriangles:assemblyTriangles,errors:[...errors]};results.push(item);
   await fetch('/__review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,png:a.renderer.domElement.toDataURL('image/png')})});
  }
  source.dispose();
  if(results.some(r=>r.selectedFastenerTriangles!==192||r.assemblyFastenerTriangles!==192))throw Error('Cylinder replacement failed');
  if(results[1].display.width>=results[2].display.width||results[2].display.width!==results[3].display.width)throw Error('Manual resolution overridden');
  if(!results[2].smaa||results[0].smaa||results[4].smaa)throw Error('AA change failed');
  if(results[0].display.width!==results[4].display.width)throw Error('Automatic restoration failed');
  if(errors.length)throw Error(errors.join('\n'));
  status.textContent='通过：主场景与查看器均为圆柱；手动分辨率、SMAA、超级性能兼容、自动模式恢复。三维已释放。';
 }catch(e){status.textContent=String(e);}finally{a?.dispose();}
};
