import assert from 'node:assert/strict';
import test from 'node:test';
import { bounds,placementReason,snap } from '../src/construction/rules.ts';

test('grid and oriented module footprints',()=>{
  assert.equal(snap(3.1),4);assert.equal(snap(-3.1),-4);
  assert.deepEqual(bounds({x:4,z:4,rotation:1,kind:1}),{x:4,z:4,w:1.1,d:2});
  assert.match(placementReason({x:3,z:4,rotation:0,kind:0},[]),/网格/);
});
test('shared seams are allowed, overlapping interiors and existing props are rejected',()=>{
  const floor={x:2,z:4,rotation:0,kind:0};
  assert.equal(placementReason(floor,[]),'');
  assert.match(placementReason(floor,[floor]),/占用/);
  assert.equal(placementReason({...floor,x:4},[floor]),'');
  assert.match(placementReason({...floor,x:-2},[]),/占用/);
});
test('whole footprint stays in the courtyard and finite pool is enforced',()=>{
  assert.match(placementReason({x:10,z:4,rotation:0,kind:0},[]),/庭院/);
  assert.match(placementReason({x:2,z:4,rotation:0,kind:1},Array.from({length:8},()=>({x:8,z:8,rotation:0,kind:2}))),/8/);
  assert.match(placementReason({x:NaN,z:4,rotation:0,kind:0},[]),/有效/);
  assert.match(placementReason({x:2,z:4,rotation:0,kind:99},[]),/有效/);
});
