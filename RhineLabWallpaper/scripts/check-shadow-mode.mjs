import assert from 'node:assert/strict';
import {normalizeShadowMode,shadowPolicy} from '../src/mac-shadow-mode.ts';
for(const value of [null,undefined,'bad',true])assert.equal(normalizeShadowMode(value),'off');
for(const res of [0,1024,2048])for(const superMode of [false,true]){
 assert.deepEqual(shadowPolicy('off',res,superMode),{original:false,projected:false,aoAllowed:false,resolution:0});
 assert.deepEqual(shadowPolicy('texture',res,superMode),{original:false,projected:true,aoAllowed:false,resolution:0});
 assert.deepEqual(shadowPolicy('original',res,superMode),{original:true,projected:false,aoAllowed:true,resolution:res||2048});
 assert.equal(shadowPolicy(null,res,superMode).original,res>0&&!superMode);
}
console.log('PASS: off/original/texture exclusive, off disables AO, explicit choice overrides old settings, non-Mac unchanged.');
