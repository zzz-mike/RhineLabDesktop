import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(process.env.RHINE_REVIEW_OUTPUT || 'verification/array-simplification');await mkdir(out,{recursive:true});
let sensor=null;
const probe=spawn(resolve('../.runtime/thermal/sensors'),[],{stdio:['ignore','pipe','ignore']});
createInterface({input:probe.stdout}).on('line',line=>{try{sensor=JSON.parse(line);}catch{}});
const server=await createServer({server:{host:'127.0.0.1',port:5185,strictPort:true},plugins:[{name:'review',configureServer(v){v.middlewares.use('/__review',async(req,res)=>{
res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
if(req.method==='GET'){res.end(JSON.stringify(sensor));return;}
if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5185'){res.statusCode=403;res.end('{}');return;}
try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8e6)throw Error('size');}const {name,png,...data}=JSON.parse(raw);if(!/^[a-z-]+$/.test(name))throw Error('name');if(png)await writeFile(resolve(out,name+'.png'),Buffer.from(png.split(',')[1],'base64'));await writeFile(resolve(out,name+'.json'),JSON.stringify({...data,sensor},null,2));res.end('{"ok":true}');}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}
});}}]});await server.listen();console.log('http://127.0.0.1:5185/array-review.html?mac=1');
async function stop(){probe.kill();await server.close();process.exit();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
