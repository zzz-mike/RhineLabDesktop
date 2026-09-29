import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const server=await createServer({server:{host:'127.0.0.1',port:5182,strictPort:true},plugins:[{
 name:'mac-effects-local-evidence',configureServer(server){
  server.middlewares.use('/__mac_effects_results',async(req,res)=>{
   if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5182'){res.statusCode=403;res.end();return;}
   try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>250000)throw Error('too large');}
    const data=JSON.parse(body);await mkdir('verification/mac-effects',{recursive:true});
    await writeFile('verification/mac-effects/browser-results.json',JSON.stringify({savedAt:new Date().toISOString(),...data},null,2));
    res.end('saved');
   }catch{res.statusCode=400;res.end('invalid results');}
  });
 }
}]});
await server.listen();server.printUrls();
