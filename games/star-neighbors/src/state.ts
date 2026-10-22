import { defineResource } from 'esengine';
import type { Placement } from './construction/rules';

export const home={x:14,y:9,z:20,yaw:.614,pitch:-.302};
export function initialState() {
  return {
    frame:0,elapsed:0,night:false,building:false,selected:0,
    cursor:{x:2,z:4,rotation:0},placed:[] as Placement[],
    yaw:home.yaw,pitch:home.pitch,lastMouse:null as {x:number;y:number}|null,
    message:'欢迎来到你的星球。先看看这片家园。',valid:true,
  };
}
export const StudyState=defineResource(initialState(),'StarNeighborsStudy');
