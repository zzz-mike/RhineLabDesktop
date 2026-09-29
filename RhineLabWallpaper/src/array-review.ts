// Isolated single-frame QA; never imported by the production application.
import {ArchiveScene} from './scene';
import {qualityPresets} from './render-quality';
import {performanceMarkup} from './mac-performance';
document.querySelector('#plugins')!.innerHTML=performanceMarkup();
const status=document.querySelector('#status')!;
const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));
function plugin(key:string,on:boolean){const i=document.querySelector<HTMLInputElement>(`[data-mac-plugin="${key}"]`)!;i.checked=on;i.dispatchEvent(new Event('change',{bubbles:true}));}
async function cool(limit:number){const s=await(await fetch('/__review')).json();if(!s||Date.now()-s.timeMs>3500||s.cpuMaxC>=limit)throw Error('温度保护，保持停止');}
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
let a:ArchiveScene|undefined;
try{
await cool(60);status.textContent='加载并检查';
for(const i of document.querySelectorAll<HTMLInputElement>('[data-mac-plugin]'))plugin(i.dataset.macPlugin!,i.dataset.macPlugin!=='lowLoad');
a=new ArchiveScene(document.querySelector<HTMLElement>('#view')!);const s=a as any;
a.renderer.debug.onShaderError=(g,p,v,f)=>errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].join('\n'));
a.setQuality({...qualityPresets.original,pixelRatio:1});await a.load();a.setMode('archive');a.revealImmediately();
const settle=()=>{const render=s.composer.render;s.composer.render=()=>{};for(let i=0;i<300;i++)a!.update(100+i/60);s.composer.render=render;};settle();
for(const [name,on,mode] of [['before',false,'archive'],['after',true,'archive'],['detail',true,'detail'],['return',true,'archive'],['dark',true,'archive'],['super',true,'archive'],['restored',true,'archive']] as const){
await cool(70);plugin('simpleArray',on);a.resize();a.setMode(mode);a.setTheme(name==='dark',true);a.setSuperPerformance(name==='super');settle();a.renderer.info.reset();s.composer.render();
const png=a.renderer.domElement.toDataURL('image/png');
const data={name,png,stats:a.getStats(),draw:{...a.renderer.info.render},errors,background:s.instances.map((m:any)=>({surface:m.userData.surface,material:m.material.type,transmission:m.material.transmission??0,triangles:(m.geometry.index?.count??m.geometry.attributes.position.count)/3}))};
await fetch('/__review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
status.textContent=errors.length?JSON.stringify(errors):'原版、简化版、详情、返回检查完成，截图已保存；三维已释放。';
}catch(e){status.textContent=String(e);}finally{a?.dispose();}
};
