import {ArchiveScene} from './scene';
import {performanceMarkup} from './mac-performance';
import {qualityPresets} from './render-quality';
document.querySelector('#controls')!.innerHTML=performanceMarkup();
const status=document.querySelector('#status')!;
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 let a:ArchiveScene|undefined;
 try{
 const sensor=await(await fetch('/__review')).json();if(!sensor||Date.now()-sensor.timeMs>3500||sensor.cpuMaxC>=65)throw Error('温度保护：暂不开始');
 a=new ArchiveScene(document.querySelector<HTMLElement>('#view')!);const s=a as any;
 const errors:string[]=[];a.renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p)||'shader');
 a.setQuality({...qualityPresets.original,pixelRatio:1});await a.load();a.setMode('archive');a.revealImmediately();
 const render=s.composer.render;s.composer.render=()=>{};for(let i=0;i<300;i++)a.update(100+i/60);s.composer.render=render;
 for(const mode of ['off','original','texture','off']){
  const select=document.querySelector<HTMLSelectElement>('[data-mac-shadow-mode]')!;select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));a.resize();
  a.update(106);a.renderer.info.reset();s.composer.render();
  const state={mode,original:a.renderer.shadowMap.enabled,light:s.light.castShadow,texture:s.projectedShadows.group.visible,ao:s.ao.enabled,errors,metrics:JSON.parse(a.renderer.domElement.parentElement!.dataset.renderQuality!)};
  if(state.original!==(mode==='original')||state.light!==state.original||state.texture!==(mode==='texture')||state.ao!==(mode!=='off')||errors.length)throw Error(JSON.stringify(state));
  await fetch('/__review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:mode,...state,png:a.renderer.domElement.toDataURL('image/png')})});
 }
 status.textContent='通过：全部关闭→原版→贴图版→全部关闭；无残留投影，AO 随关闭恢复。三维已释放。';
 }catch(e){status.textContent=String(e);}finally{a?.dispose();}
};
