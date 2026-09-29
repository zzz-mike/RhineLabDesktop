import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,appendFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('../mac/gpu-cost-audit',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true});
let sensor=null;
const probe=spawn(resolve('../.runtime/thermal/sensors'),[],{stdio:['ignore','pipe','pipe']});
createInterface({input:probe.stdout}).on('line',line=>{try{sensor=JSON.parse(line);void appendFile(resolve(out,'temperatures.jsonl'),JSON.stringify(sensor)+'\n');}catch{}});
const server=await createServer({server:{host:'127.0.0.1',port:5184,strictPort:true},plugins:[{name:'local-cost-audit',configureServer(vite){
 vite.middlewares.use('/__cost',async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.url==='/state'&&req.method==='GET'){res.end(JSON.stringify({sensor,cutoffC:72,out}));return;}
  if(req.url==='/results'&&req.method==='POST'&&req.headers.origin==='http://127.0.0.1:5184'){
   try{let raw='';for await(const b of req){raw+=b;if(raw.length>4e6)throw Error('size');}const data=JSON.parse(raw);await writeFile(resolve(out,'results.json'),JSON.stringify(data,null,2));res.end('{"ok":true}');}catch{res.statusCode=400;res.end('{}');}return;
  }res.statusCode=404;res.end('{}');
 });
}}]});
await server.listen();console.log(JSON.stringify({out,url:'http://127.0.0.1:5184/mac-cost-review.html?mac=1',pid:process.pid}));
async function stop(){probe.kill('SIGTERM');await server.close();process.exit();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
