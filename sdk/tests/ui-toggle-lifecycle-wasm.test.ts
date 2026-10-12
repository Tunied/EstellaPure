// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule } from '../src/ecs/system';
import { UIVisual } from '../src/ui/core/ui-visual';
import { UIEventQueue } from '../src/ui/core/events';
import { UIToggle, createToggleSystem } from '../src/ui/behavior/toggle';
import { createToggle } from '../src/ui/widgets/toggle';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('toggle visual and callback lifecycle on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); events = new UIEventQueue();
        app.addSystemToSchedule(Schedule.Update, createToggleSystem(app.world, events));
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    it.each([false, true])('replacement indicator receives the current state %s without a change event', async isOn => {
        const changed = vi.fn(), toggle = createToggle({ world: app.world, events, isOn, onChange: changed });
        await app.tick(1 / 60);
        const check = app.world.spawn(); app.world.insert(check, UIVisual, { enabled: !isOn });
        app.world.update(toggle.entity, UIToggle, d => { d.check = check; });
        await app.tick(1 / 60);
        expect(app.world.get(check, UIVisual).enabled).toBe(isOn);
        expect(changed).not.toHaveBeenCalled();
    });
    it('a change callback may dispose another toggle awaiting its update', async () => {
        const error = vi.fn(); app.onError(error);
        let later: ReturnType<typeof createToggle>;
        const first = createToggle({ world: app.world, events, onChange: () => later.dispose() });
        later = createToggle({ world: app.world, events }); await app.tick(1 / 60);
        first.setValue(true); later.setValue(true);
        await app.tick(1 / 60);
        expect(error).not.toHaveBeenCalled();
        expect(app.world.valid(later.entity)).toBe(false);
    });
    it('stable frames do not rewrite indicators', async () => {
        createToggle({ world: app.world, events, isOn: true }); await app.tick(1 / 60);
        const write = vi.spyOn(app.world, 'insert');
        for (let i = 0; i < 100; i++) await app.tick(1 / 60);
        expect(write).not.toHaveBeenCalled();
    });
});
