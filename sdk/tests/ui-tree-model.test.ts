// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { TreeViewModel, type TreeDataSource } from '../src/ui/collection/tree-data-source';
import { col } from '../src/math/color';
import { normalizePickerColor } from '../src/ui/behavior/color-picker-system';

interface Item { key: string | number; title: string; items?: Item[]; selectable?: boolean }
function source(items: Item[]): TreeDataSource<Item> {
    return { getRoots: () => items, getChildren: item => item.items ?? [], getId: item => item.key,
        getLabel: item => item.title, isSelectable: item => item.selectable !== false };
}
const items = (): Item[] => [{ key: 'root', title: 'World', items: [
    { key: '3d', title: 'Models', items: [{ key: 0, title: 'Hero' }] },
    { key: '2d', title: 'Sprites' }, { key: 'locked', title: 'Disabled', selectable: false },
] }];
describe('generic tree projection', () => {
    it('projects arbitrary data, preserving numeric zero identity and depth', () => {
        const model = new TreeViewModel(source(items()), ['root', '3d']);
        expect(Array.from({length:model.getCount()},(_,i)=>model.getItem(i).id)).toEqual(['root','3d',0,'2d','locked']);
        expect(model.getNode(0)).toMatchObject({ depth:2,parentId:'3d' });
        expect(model.source.getLabel(model.getItem(2).item)).toBe('Hero');
        expect(()=>model.getItem(-1)).toThrow(RangeError);
    });
    it('retains selection when ancestors collapse and reveals without selecting', () => {
        const model=new TreeViewModel(source(items()),['root','3d']);model.select([0]);model.toggle('root');
        expect(model.getCount()).toBe(1);expect(model.selectedIds).toEqual([0]);model.reveal(0);
        expect(model.indexOf(0)).toBe(2);expect(model.selectedIds).toEqual([0]);
    });
    it('supports none/single/multiple selection and rejects unselectable IDs', () => {
        const model=new TreeViewModel(source(items()));model.select([0,'locked','2d','missing'],2);
        expect(model.selectedIds).toEqual([0,'2d']);model.select([0,'2d'],1);expect(model.selectedIds).toEqual(['2d']);
        model.select([0],0);expect(model.selectedIds).toEqual([]);
    });
    it('retains state across reorder and prunes removed IDs', () => {
        const data=items(),model=new TreeViewModel(source(data),['root','3d']);model.select([0]);
        data[0].items!.reverse();model.refresh();expect(model.selectedIds).toEqual([0]);expect(model.indexOf(0)).toBe(4);
        data[0].items=data[0].items!.filter(item=>item.key!=='3d');model.refresh();expect(model.selectedIds).toEqual([]);expect(model.expandedIds).toEqual(['root']);
    });
    it('rejects duplicate IDs transactionally, including collapsed branches', () => {
        const data=items(),model=new TreeViewModel(source(data));data.push({key:0,title:'Duplicate'});
        expect(()=>model.refresh()).toThrow('Duplicate');expect(model.getCount()).toBe(1);expect(model.getNode('root')).toBeDefined();
    });
    it('rejects a cyclic host tree instead of recursing forever', () => {
        const data=items();data[0].items!.push(data[0]);expect(()=>new TreeViewModel(source(data))).toThrow('cyclic');
    });
    it('handles 20,000 levels without recursive traversal', () => {
        let root:Item={key:0,title:'0'};const ids:number[]=[];
        for(let i=1;i<20000;i++){root={key:i,title:String(i),items:[root]};ids.push(i);}
        const model=new TreeViewModel(source([root]),ids);expect(model.getCount()).toBe(20000);expect(model.getItem(19999).depth).toBe(19999);
    });
    it('rejects self and descendant drops while leaving mutation to the host', () => {
        const data=items(),model=new TreeViewModel(source(data));
        expect(model.canDrop({source:model.getNode('3d')!,target:model.getNode(0)!,position:'inside'})).toBe(false);
        expect(model.canDrop({source:model.getNode(0)!,target:model.getNode('2d')!,position:'after'})).toBe(true);
        expect(data[0].items![0].items![0].key).toBe(0);
    });
    it('unsubscribes once and releases subscribers on disposal', () => {
        const off=vi.fn(),data=source(items());let notify=()=>{};data.subscribe=cb=>{notify=cb;return off;};
        const model=new TreeViewModel(data),listener=vi.fn();model.subscribe(listener);notify();expect(listener).toHaveBeenCalledOnce();
        model.dispose();model.dispose();notify();expect(off).toHaveBeenCalledOnce();expect(listener).toHaveBeenCalledOnce();
    });
});
describe('canonical HSV editing', () => {
    it.each([0,37,60,120,208,240,300,359])('round trips hue %s without implicit color-space conversion', h=>{
        const color=col.fromHsv(h,.73,.82,.42),hsv=col.toHsv(color);
        expect(hsv.h).toBeCloseTo(h);expect(hsv.s).toBeCloseTo(.73);expect(hsv.v).toBeCloseTo(.82);expect(color.a).toBe(.42);
    });
    it('preserves hue for gray and black editing and wraps hue',()=>{
        expect(col.toHsv(col.rgb(.5,.5,.5),208).h).toBe(208);expect(col.toHsv(col.rgb(0,0,0),208).h).toBe(208);
        expect(col.fromHsv(-60,1,1)).toEqual(col.fromHsv(300,1,1));
    });
    it('bounds nonfinite/imported colors and disables alpha explicitly',()=>{
        expect(normalizePickerColor({r:NaN,g:Infinity,b:-3,a:NaN})).toEqual({r:0,g:0,b:0,a:1});
        expect(normalizePickerColor({r:1,g:.4,b:.2,a:.1},false).a).toBe(1);
    });
});
