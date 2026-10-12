// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule } from '../src/ecs/system';
import { UIEventQueue } from '../src/ui/core/events';
import { UINode } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import { UISlider, createSliderSystem } from '../src/ui/behavior/slider';
import { createSlider } from '../src/ui/widgets/slider';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('slider visual reconciliation on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); events = new UIEventQueue();
        app.addSystemToSchedule(Schedule.Update, createSliderSystem(app.world, events));
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    it('range edits repaint fill and thumb without reporting a value change', async () => {
        const changed = vi.fn(), slider = createSlider({ world: app.world, events, value: .5, onChange: changed });
        await app.tick(1 / 60);
        app.world.update(slider.entity, UISlider, d => { d.max = 2; }); await app.tick(1 / 60);
        expect(app.world.get(slider.fillEntity, UIVisual).fillAmount).toBe(.25);
        expect(app.world.get(slider.handleEntity, UINode).insetLeft.value).toBe(25);
        expect(changed).not.toHaveBeenCalled();
    });
    it('new visual targets receive the current fraction immediately', async () => {
        const slider = createSlider({ world: app.world, events, value: .5 }); await app.tick(1 / 60);
        const fill = app.world.spawn(), handle = app.world.spawn();
        app.world.insert(fill, UIVisual); app.world.insert(handle, UINode);
        app.world.update(slider.entity, UISlider, d => { d.fill = fill; d.handle = handle; });
        await app.tick(1 / 60);
        expect(app.world.get(fill, UIVisual).fillAmount).toBe(.5);
        expect(app.world.get(handle, UINode).insetLeft.value).toBe(50);
    });
});
