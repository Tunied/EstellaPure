// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule } from '../src/ecs/system';
import { Canvas, Disabled, Parent } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { Interactable } from '../src/ui/input/interactable';
import { Focusable } from '../src/ui/input/focusable';
import { UINode } from '../src/ui/core/ui-node';
import { Text } from '../src/ui/core/text';
import { UIEventQueue } from '../src/ui/core/events';
import { UIDropdown, createDropdownSystem } from '../src/ui/behavior/dropdown';
import { createDropdown } from '../src/ui/widgets/dropdown';
import { UIController } from '../src/ui/controller/ui-controller';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('dropdown live options on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); events = new UIEventQueue();
        app.addSystemToSchedule(Schedule.Update, createDropdownSystem(app.world, events));
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    it('renaming the selected option repaints the label without changing selection', async () => {
        const changed = vi.fn(), dd = createDropdown({ world: app.world, events, options: ['old'], onSelect: changed });
        await app.tick(1 / 60);
        app.world.update(dd.entity, UIDropdown, d => { d.options[0] = 'new'; }); await app.tick(1 / 60);
        expect(app.world.get(dd.labelEntity, Text).content).toBe('new');
        expect(changed).not.toHaveBeenCalled();
    });
    it('an open popup rebuilds changed rows and clamps a removed selection', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['old-a','old-b'], selectedIndex: 1 });
        await app.tick(1 / 60); dd.open();
        app.world.update(dd.entity, UIDropdown, d => { d.options = ['new-a']; }); await app.tick(1 / 60);
        expect(dd.getSelectedIndex()).toBe(0);
        expect(app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content)).not.toContain('old-b');
        expect(dd.isOpen()).toBe(true);
    });
    it('replacement label receives the current option immediately', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['current'] }); await app.tick(1 / 60);
        const label = app.world.spawn(); app.world.insert(label, Text);
        app.world.update(dd.entity, UIDropdown, d => { d.label = label; }); await app.tick(1 / 60);
        expect(app.world.get(label, Text).content).toBe('current');
    });
    it('change callbacks may dispose a later dropdown without a system error', async () => {
        let later: ReturnType<typeof createDropdown>;
        const error = vi.fn(); app.onError(error);
        const first = createDropdown({ world: app.world, events, options: ['a','b'], onSelect: () => later.dispose() });
        later = createDropdown({ world: app.world, events, options: ['a','b'] }); await app.tick(1 / 60);
        first.setSelectedIndex(1); later.setSelectedIndex(1); await app.tick(1 / 60);
        expect(error).not.toHaveBeenCalled(); expect(app.world.valid(later.entity)).toBe(false);
    });
    it('a stale popup row cannot select an option changed before the next update', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const rows = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity);
        expect(rows).toHaveLength(2);
        app.world.update(dd.entity, UIDropdown, d => { d.options = ['a','replacement']; });
        events.emit(rows[1]!, 'click');
        expect(dd.getSelectedIndex()).toBe(0);
        expect(dd.isOpen()).toBe(false);
    });
    it('closing a row cannot resurrect an owner disposed by popup teardown', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const row = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity)[1]!;
        const panel = app.world.get(row, Parent).entity;
        const off = app.world.onDespawn(e => { if (e === panel) app.world.despawn(dd.entity); });
        try { events.emit(row, 'click'); } finally { off(); }
        expect(app.world.valid(dd.entity)).toBe(false);
        expect(app.world.has(dd.entity, UIDropdown)).toBe(false);
    });
    it('closed dropdowns do not rewrite stable labels', async () => {
        createDropdown({ world: app.world, events, options: ['a','b'] }); await app.tick(1 / 60);
        const write = vi.spyOn(app.world, 'insert');
        for (let i = 0; i < 100; i++) await app.tick(1 / 60);
        expect(write).not.toHaveBeenCalled();
    });
    it.each(['disabled', 'inactive', 'hidden', 'removed'])('%s owners retire open popups and ignore keyboard input', async kind => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        app.world.update(dd.entity, Focusable, d => { d.isFocused = true; });
        if (kind === 'disabled') app.world.update(dd.entity, Interactable, d => { d.enabled = false; });
        if (kind === 'inactive') app.world.insert(dd.entity, Disabled);
        if (kind === 'removed') app.world.remove(dd.entity, UIDropdown);
        if (kind === 'hidden') {
            app.world.insert(dd.entity, Canvas);
            app.world.update(dd.entity, UINode, n => { n.display = 1; });
            engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        }
        const input = new InputState(); input.noteKeyDown('ArrowDown'); app.insertResource(Input, input);
        await app.tick(1 / 60);
        expect(dd.isOpen()).toBe(false);
        if (kind !== 'removed') expect(dd.getSelectedIndex()).toBe(0);
    });
    it('a disabled owner cannot accept a row click before the next frame', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const row = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity)[1]!;
        app.world.update(dd.entity, Interactable, d => { d.enabled = false; });
        events.emit(row, 'click');
        expect(dd.getSelectedIndex()).toBe(0);
        expect(dd.isOpen()).toBe(false);
    });
});
