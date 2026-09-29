export function accessPage(token) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>莱茵生命 · 本地连接</title>
<style>body{margin:0;background:#efede7;color:#252923;font:16px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:40px 24px}h1{font-size:30px}h2{font-size:20px}section{border-top:1px solid #9d9d93;padding:20px 0}button,a{font:inherit}button{border:1px solid #6e7366;background:transparent;color:inherit;padding:10px 16px;cursor:pointer;margin:6px 12px 6px 0}button.primary{background:#30372e;color:white}button:disabled{opacity:.5;cursor:wait}label{display:block;margin:16px 0}input{margin-right:12px}small{display:block;color:#626759;margin-left:28px}#folder{overflow-wrap:anywhere;padding:12px;background:#e3e1d8}#message{min-height:28px;white-space:pre-wrap;color:#81410f}a{color:#364d2e}.eyebrow{letter-spacing:.16em;color:#64695e}.foot{font-size:14px;color:#626759}</style>
<main><p class="eyebrow">RHINE LAB / LOCAL CONNECTIONS</p><h1>由你选择接入什么</h1><p>所有连接默认关闭。本页的选择只在本次服务运行期间有效，关闭服务后需重新授权。</p>
<section><h2>文件夹</h2><p>选择后读取该目录的文件名与子目录，预览时读取文件内容。不会自动上传，也不会删除、移动或修改原文件。</p><p id="folder">未接入文件夹</p><button id="choose" class="primary">选择并授权文件夹…</button><p class="foot">系统选择窗口中点“允许读取此文件夹”才生效；取消不改变现有授权。可先选择一个测试目录。无需开放完全磁盘访问。</p><label><input type="checkbox" id="file_actions">允许点击打开文件／在访达中定位<small>默认只读预览；启用后仍须在档案内点击具体文件操作。</small></label></section>
<section><h2>可选服务，分别开启</h2><label><input type="checkbox" id="secretary">连接本机 AI 秘书<small>读取兼容服务中的事项、摘要和项目；在界面中确认的分类操作会提交给该服务。不会自动启动 AI 或上传文件给模型。</small></label><label><input type="checkbox" id="solar">连接本机光伏监测<small>只读展示已有本地监测服务的数据；没有后端时显示不可用。</small></label><label><input type="checkbox" id="media">读取本机播放信息<small>读取歌曲标题、播放状态等；依赖另外配置的媒体工具。</small></label><button id="save">保存服务与操作权限</button></section>
<p id="message" role="status" aria-live="polite"></p><button id="revoke">断开全部并清除本次访问缓存</button><p><a href="/?mac=1">返回莱茵生命 →</a></p><p class="foot">这控制本软件的访问范围，不等于 macOS 沙盒。macOS 的系统授权可在“系统设置 → 隐私与安全 → 文件与文件夹”中另外管理。首次系统提示的名称取决于你的启动方式。</p></main>
<script>
const token=${JSON.stringify(token)};
const fields=['file_actions','secretary','solar','media'];const message=document.querySelector('#message');let state;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('rhine-permissions'):null;
function draw(value){state=value;document.querySelector('#folder').textContent=value.root||'未接入文件夹';for(const field of fields)document.getElementById(field).checked=!!value[field];document.querySelector('#file_actions').disabled=!value.desktop;}
async function request(path,body){const r=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{'X-Rhine-Local':'1','X-Rhine-Consent':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'request_failed');return value;}
const errors={folder_picker_unavailable:'文件夹选择器未能启动。请确认使用 Mac 接入包，并检查系统是否阻止其运行。',choose_specific_folder:'请选择具体文件夹，不要选择整个用户目录或磁盘根目录。',selection_cancelled:'选择已取消，连接保持关闭。',selection_in_progress:'请先完成或取消已打开的文件夹选择窗口。',select_folder_first:'请先授权一个文件夹。'};
async function change(path,body){message.textContent='正在处理…';for(const id of ['choose','save'])document.getElementById(id).disabled=true;try{const next=await request(path,body);draw(next);channel?.postMessage({revision:next.revision});message.textContent='已更新。本地档案页面将重新加载，应用新的访问范围。';}catch(e){message.textContent=errors[e.message]||'操作未完成，请刷新本页后重试。';}finally{for(const id of ['choose','save'])document.getElementById(id).disabled=false;}}
document.querySelector('#choose').onclick=()=>change('/api/access/select',{});
document.querySelector('#save').onclick=()=>change('/api/access/options',Object.fromEntries(fields.map(k=>[k,document.getElementById(k).checked])));
document.querySelector('#revoke').onclick=()=>change('/api/access/revoke',{});
request('/api/access/state').then(draw).catch(()=>message.textContent='无法读取连接状态。请重新打开本页。');
</script></html>`;
}
