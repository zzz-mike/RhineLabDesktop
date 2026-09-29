import {randomBytes,timingSafeEqual} from 'node:crypto';
import {realpath,stat} from 'node:fs/promises';
import {parse} from 'node:path';
import {homedir} from 'node:os';
import {chooseFolder} from './folder-picker.mjs';
export class AccessState {
  constructor({picker=chooseFolder,onChange=()=>{}}={}) {
    this.picker=picker;this.onChange=onChange;this.token=randomBytes(32).toString('hex');this.revision=randomBytes(12).toString('hex');this.root=null;
    this.flags={file_actions:false,secretary:false,solar:false,media:false};this.pending=null;
  }
  snapshot(){return {revision:this.revision,desktop:!!this.root,root:this.root,...this.flags};}
  authorized(token){if(typeof token!=='string')return false;const a=Buffer.from(token),b=Buffer.from(this.token);return a.length===b.length&&timingSafeEqual(a,b);}
  changed(){this.revision=randomBytes(12).toString('hex');this.onChange(this.snapshot());}
  async select() {
    if(this.pending)throw Error('selection_in_progress');
    const revision=this.revision,controller=new AbortController();this.pending=controller;
    try {
      const selected=await this.picker({signal:controller.signal});
      if(!selected)return this.snapshot();
      const path=await realpath(selected);
      if(path===parse(path).root || path===await realpath(homedir()))throw Error('choose_specific_folder');
      if(!(await stat(path)).isDirectory())throw Error('not_a_directory');
      if(revision!==this.revision || controller.signal.aborted)throw Error('selection_cancelled');
      this.root=path;this.flags.file_actions=false;this.changed();return this.snapshot();
    } finally {if(this.pending===controller)this.pending=null;}
  }
  update(input) {
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==4 || Object.keys(input).some(k=>!Object.hasOwn(this.flags,k)||typeof input[k]!=='boolean'))throw Error('invalid_permissions');
    if(input.file_actions&&!this.root)throw Error('select_folder_first');
    this.flags={...input};this.changed();return this.snapshot();
  }
  revoke(){this.pending?.abort();this.root=null;this.flags={file_actions:false,secretary:false,solar:false,media:false};this.changed();return this.snapshot();}
}
