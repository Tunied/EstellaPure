// SPDX-License-Identifier: Apache-2.0
import {it,expect,vi} from 'vitest';
import {Navigation} from '../src/ai/nav/Navigation';
import {NavGrid} from '../src/ai/nav/NavGrid';

const grid=()=>new NavGrid({width:9,height:9,cellSize:10});
const from={x:20,y:40},to={x:60,y:40};

it('keeps the live surface but refuses routes while a replacement is pending',()=>{
    const nav=new Navigation(),old=grid();nav.setSurface(old);
    const query=vi.spyOn(old,'queryWorldPath');
    const update=nav.beginSurfaceUpdate();
    expect(nav.surface).toBe(old);expect(update.pending).toBe(true);
    expect(nav.queryWorldPath(from,to)).toEqual({path:null,status:'unavailable',reason:'building'});
    expect(nav.findWorldPath(from,to)).toBeNull();expect(query).not.toHaveBeenCalled();
    const replacement=grid(),before=nav.pathRevision;
    expect(update.commit(replacement)).toBe(true);
    expect(nav.surface).toBe(replacement);expect(nav.pathRevision).toBe(before+1);
    expect(nav.surfaceUpdatePending).toBe(false);expect(update.pending).toBe(false);
    expect(update.cancelled).toBe(false);expect(update.commit(old)).toBe(false);
    expect(update.cancel()).toBe(false);expect(nav.queryWorldPath(from,to).status).toBe('complete');
});

it('rejects a late async result after a newer request has committed',async()=>{
    const nav=new Navigation(),old=grid(),replacement=grid();nav.setSurface(old);
    const first=nav.beginSurfaceUpdate();
    let finish!:()=>void;
    const work=new Promise<void>(resolve=>{finish=resolve;}).then(()=>first.commit(old));
    const second=nav.beginSurfaceUpdate();
    expect(second.version).toBeGreaterThan(first.version);
    expect(first.cancelled).toBe(true);expect(first.pending).toBe(false);
    expect(second.commit(replacement)).toBe(true);
    finish();expect(await work).toBe(false);expect(nav.surface).toBe(replacement);
});

it('cancels idempotently and restores queries against the unchanged live surface',()=>{
    const nav=new Navigation(),old=grid();nav.setSurface(old);
    const update=nav.beginSurfaceUpdate(),revision=nav.pathRevision;
    expect(update.cancel()).toBe(true);expect(update.cancel()).toBe(false);
    expect(update.cancelled).toBe(true);expect(update.commit(grid())).toBe(false);
    expect(nav.pathRevision).toBe(revision);expect(nav.surface).toBe(old);
    expect(nav.queryWorldPath(from,to).status).toBe('complete');
});

it.each(['surface','setSurface'])('explicit %s replacement cancels an older producer',method=>{
    const nav=new Navigation(),update=nav.beginSurfaceUpdate(),replacement=grid();
    if(method==='surface')nav.surface=replacement;else nav.setSurface(replacement);
    expect(update.cancelled).toBe(true);expect(update.commit(grid())).toBe(false);
    expect(nav.surface).toBe(replacement);expect(nav.surfaceUpdatePending).toBe(false);
});

it('reports initial construction and supports an explicit empty result',()=>{
    const nav=new Navigation(),update=nav.beginSurfaceUpdate();
    expect(nav.hasSurface()).toBe(false);expect(nav.queryWorldPath(from,to).reason).toBe('building');
    expect(update.commit(null)).toBe(true);
    expect(nav.queryWorldPath(from,to).reason).toBe('no-surface');
});

it('invalidates cached plans even when a producer commits the same surface identity',()=>{
    const nav=new Navigation(),old=grid();nav.setSurface(old);
    const revision=nav.pathRevision,update=nav.beginSurfaceUpdate();
    expect(update.commit(old)).toBe(true);expect(nav.pathRevision).toBe(revision+1);
});

it('lets a failed producer cancel in finally without replacing the live surface',async()=>{
    const nav=new Navigation(),old=grid();nav.setSurface(old);
    const update=nav.beginSurfaceUpdate();
    await expect((async()=>{try{await Promise.reject(new Error('decode failed'));}
        finally{update.cancel();}})()).rejects.toThrow('decode failed');
    expect(nav.surfaceUpdatePending).toBe(false);expect(nav.surface).toBe(old);
    expect(nav.queryWorldPath(from,to).status).toBe('complete');
});
