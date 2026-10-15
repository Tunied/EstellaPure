// SPDX-License-Identifier: Apache-2.0
import {expect, it} from 'vitest';
import {runInNewContext} from 'node:vm';
import {InputState, inputEventCallbacks} from '../../sdk/src/input/input';
import {inputScript} from '../launchers/inputScript.mjs';
import {suspendDrive} from '../lib/suspendDrive.mjs';

async function sample(hidden: {from:number;to:number} | null) {
  const input=new InputState(), callbacks=inputEventCallbacks(input);
  const history: Array<{hidden:boolean;down:boolean}>=[], pending: Array<()=>void>=[];
  const document={hidden:false,querySelector:()=>null,dispatchEvent(event:{type:string;code:string}){
    if(event.type==='keydown')callbacks.onKeyDown?.(event.code);
    if(event.type==='keyup')callbacks.onKeyUp?.(event.code);
    if(event.type==='visibilitychange'&&document.hidden)callbacks.onInputCancel?.();
  }};
  class Event {constructor(public type:string, options={}){Object.assign(this,options);}}
  const result=runInNewContext(inputScript(suspendDrive({keys:['KeyD'],frames:10},hidden)),{
    document,window:{dispatchEvent(){}},navigator:{},Event,KeyboardEvent:Event,
    requestAnimationFrame:(callback:()=>void)=>pending.push(callback),
  });
  for(let frame=0;frame<12&&pending.length;frame++){
    history.push({hidden:document.hidden,down:input.isKeyDown('KeyD')});
    pending.splice(0).forEach(callback=>callback());
    await new Promise(resolve=>setImmediate(resolve));
    input.clearFrameState();
  }
  await result;
  expect(input.keysDown.size).toBe(0);
  return history;
}

it('renews foreground keyboard intent after cancellation without replaying a hidden hold',async()=>{
  const history=await sample({from:2,to:5});
  expect(history.slice(0,2).every(frame=>frame.down)).toBe(true);
  expect(history.slice(2,5).every(frame=>frame.hidden&&!frame.down)).toBe(true);
  expect(history[5]).toEqual({hidden:false,down:false});
  expect(history[6]).toEqual({hidden:false,down:true});
});

it('does not renew movement in the last frame of the held-background comparison',async()=>{
  const history=await sample({from:2,to:9});
  expect(history.slice(2).every(frame=>!frame.down)).toBe(true);
});

it('keeps the uninterrupted drive held for its requested frames and releases it afterwards',async()=>{
  const history=await sample(null);
  expect(history.slice(0,10).every(frame=>frame.down&&!frame.hidden)).toBe(true);
  expect(history[10].down).toBe(false);
});
