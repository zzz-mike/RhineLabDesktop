import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,cp,readdir,stat,chmod,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createZip,readZip} from '../RhineLabWallpaper/scripts/zip-utils.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const front=join(root,'RhineLabWallpaper'),out=join(root,'release');await mkdir(out,{recursive:true});
const version='0.2.0';
const localFiles=['server.mjs','access.mjs','access-page.mjs','folder-picker.mjs','desktop-files.mjs','integration-bridge.mjs','solar-bridge.mjs','solar-fleet.mjs','media-state.mjs','choose-folder.m','bin/choose-folder'];
const sums=[];
async function walk(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('No symlinks in distribution');if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}return files.sort();}
for(const edition of ['display','local']) {
  const name=edition==='display'?'RhineLabDisplay':'RhineLabMacLocal';
  const dir=join(out,name);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
  // The build defines the edition independently of URL parameters and localStorage.
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  execFileSync(npm,['run','build:wallpaper'],{cwd:front,stdio:'inherit',env:{...process.env,RHINE_EDITION:edition},shell:process.platform==='win32'});
  await cp(join(front,'release/wallpaper'),join(dir,'web'),{recursive:true});
  await mkdir(join(dir,'runtime'));await copyFile(join(root,'runtime/static-server.mjs'),join(dir,'runtime/static-server.mjs'));
  for(const file of ['LICENSE','ATTRIBUTION.md'])await copyFile(join(root,file),join(dir,file));
  await copyFile(join(root,'docs',edition==='display'?'DISPLAY.md':'MAC-LOCAL.md'),join(dir,'README.md'));
  if(edition==='local')for(const file of localFiles){const target=join(dir,'mac',file);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,'mac',file),target);}
  const wrapper=`import {fileURLToPath} from 'node:url';\nimport {execFile} from 'node:child_process';\n${edition==='display'?"import {createDisplayServer} from './runtime/static-server.mjs';":"import {createLocalServer} from './mac/server.mjs';"}\n${edition==='local'?"if(process.platform!=='darwin'){console.error('This edition requires macOS. Use RhineLabDisplay on Windows.');process.exit(1);}":''}\nconst root=fileURLToPath(new URL('./web/',import.meta.url));\nconst port=Number(process.env.RHINE_PORT||${edition==='display'?5190:5191});\nif(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');\nconst server=${edition==='display'?'createDisplayServer({root})':'createLocalServer({root}).server'};\nserver.on('error',e=>{console.error('Server could not start: '+e.code);process.exitCode=1;});\nserver.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+server.address().port+'/${edition==='display'?'?display=1':'connections'}';console.log(url);if(process.env.RHINE_NO_OPEN!=='1'){if(process.platform==='darwin')execFile('/usr/bin/open',[url],()=>{});else if(process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],()=>{});}});\nfor(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close();});\n`;
  await writeFile(join(dir,'server.mjs'),wrapper);
  const mac='#!/bin/zsh\ncd "${0:A:h}"\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nif ! command -v node >/dev/null 2>&1; then\n echo "Please install Node.js 22.12 or newer from https://nodejs.org/ and try again."\n read "?Press Enter to close."\n exit 1\nfi\nnode server.mjs\n';
  await writeFile(join(dir,'Start-Mac.command'),mac);await chmod(join(dir,'Start-Mac.command'),0o755);
  if(edition==='display')await writeFile(join(dir,'Start-Windows.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n echo Please install Node.js 22.12 or newer from https://nodejs.org/ and try again.\r\n pause\r\n exit /b 1\r\n)\r\nnode server.mjs\r\npause\r\n');
  else await chmod(join(dir,'mac/bin/choose-folder'),0o755);
  const paths=await walk(dir),manifest=paths.map(p=>relative(dir,p).replaceAll('\\','/'));
  if(edition==='display'&&manifest.some(p=>p.startsWith('mac/')))throw Error('Display package contains local bridge');
  if(manifest.some(p=>/(^|\/)(node_modules|\.git|\.runtime|logs|novecento)(\/|$)/.test(p)))throw Error('Forbidden distribution path');
  const entries=[];for(const path of paths)entries.push({name:name+'/'+relative(dir,path).replaceAll('\\','/'),data:await readFile(path)});
  const zip=createZip(entries);const nameZip=`${name}-v${version}.zip`;await writeFile(join(out,nameZip),zip);
  const unpacked=readZip(zip);if(unpacked.length!==paths.length)throw Error('ZIP entry mismatch');
  // ZIP central directory carries POSIX executable bits for Finder launches.
  const endRecord=zip.length-22;
  if(zip.readUInt32LE(endRecord)!==0x06054b50)throw Error('Unexpected ZIP footer');
  let central=zip.readUInt32LE(endRecord+16);
  for(let n=0;n<zip.readUInt16LE(endRecord+10);n++) {
    if(zip.readUInt32LE(central)!==0x02014b50)throw Error('Invalid ZIP directory');
    const length=zip.readUInt16LE(central+28),extra=zip.readUInt16LE(central+30),comment=zip.readUInt16LE(central+32);
    const path=zip.toString('utf8',central+46,central+46+length);
    zip.writeUInt16LE(0x0314,central+4);
    const mode=path.endsWith('.command')||path.endsWith('/bin/choose-folder')?0o100755:0o100644;
    zip.writeUInt32LE((mode*65536)>>>0,central+38);
    central+=46+length+extra+comment;
  }
  await writeFile(join(out,nameZip),zip);readZip(zip);
  const sha=createHash('sha256').update(zip).digest('hex');sums.push(`${sha}  ${nameZip}`);
  console.log(`Verified ${nameZip}: ${paths.length} files, ${(zip.length/1048576).toFixed(1)} MiB`);
}
await writeFile(join(out,`SHA256SUMS-v${version}.txt`),sums.join('\n')+'\n');
