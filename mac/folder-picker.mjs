import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function chooseFolder({signal}={}) {
  if(process.platform!=='darwin')throw Error('mac_only');
  return new Promise((resolve,reject)=>{
    execFile(fileURLToPath(new URL('./bin/choose-folder',import.meta.url)),[],{timeout:120000,maxBuffer:16384,signal},(error,stdout)=>{
      if(error){if(error.code===2)resolve(null);else reject(Error('folder_picker_unavailable'));return;}
      resolve((stdout.endsWith('\n')?stdout.slice(0,-1):stdout)||null);
    });
  });
}
