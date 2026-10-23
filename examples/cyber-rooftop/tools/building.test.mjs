import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, canWalk } from '../src/building.ts';
const platform=(x,z,rotation=0)=>({x,z,rotation,kind:'platform'});

test('a clear deck accepts construction, the habitat and utilities reject it',()=>{
    assert.equal(canPlace(platform(0,5),[]),true);
    assert.equal(canPlace(platform(-6,-5),[]),false);
    assert.equal(canPlace(platform(6,-4),[]),false);
});
test('the complete rotated footprint must remain on the roof',()=>{
    assert.equal(canPlace(platform(15.1,15),[]),false);
    assert.equal(canPlace(platform(14.8,15,1),[]),true);
    assert.equal(canPlace(platform(0,19),[]),false);
});
test('a quarter turn changes which neighbouring platforms fit',()=>{
    const placed=[platform(0,4.5)];
    assert.equal(canPlace(platform(5.8,4.5),placed),false);
    assert.equal(canPlace(platform(5.8,4.5,1),placed),true);
    assert.equal(canPlace(platform(0,4.5,1),placed),false);
});
test('water filters obstruct walking; low platforms remain walkable',()=>{
    assert.equal(canWalk(0,9,[platform(0,9)]),true);
    assert.equal(canWalk(0,9,[{...platform(0,9),kind:'purifier'}]),false);
    assert.equal(canWalk(-6,-5,[]),false);
    assert.equal(canWalk(0,21,[]),false);
});
