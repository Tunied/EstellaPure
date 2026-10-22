import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, canWalk } from '../src/building.ts';
const platform=(x,z,rotation=0)=>({x,z,rotation,kind:'platform'});

test('a clear deck accepts construction, the habitat and utilities reject it',()=>{
    assert.equal(canPlace(platform(0,10),[]),true);
    assert.equal(canPlace(platform(-6,-5),[]),false);
    assert.equal(canPlace(platform(6,-4),[]),false);
});
test('the complete rotated footprint must remain on the roof',()=>{
    assert.equal(canPlace(platform(15.1,15),[]),false);
    assert.equal(canPlace(platform(15.1,15,1),[]),true);
    assert.equal(canPlace(platform(0,19),[]),false);
});
test('a quarter turn changes which neighbouring platforms fit',()=>{
    const placed=[platform(0,9)];
    assert.equal(canPlace(platform(4.8,9),placed),false);
    assert.equal(canPlace(platform(4.8,9,1),placed),true);
    assert.equal(canPlace(platform(0,9,1),placed),false);
});
test('water filters obstruct walking; low platforms remain walkable',()=>{
    assert.equal(canWalk(0,9,[platform(0,9)]),true);
    assert.equal(canWalk(0,9,[{...platform(0,9),kind:'purifier'}]),false);
    assert.equal(canWalk(-6,-5,[]),false);
    assert.equal(canWalk(0,21,[]),false);
});
