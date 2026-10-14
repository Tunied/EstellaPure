import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app/app';
import type { ESEngineModule } from '../src/wasm';
import { World } from '../src/ecs/world';
import { Sprite, Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { worldSnapshot } from '../src/runtime/worldSnapshot';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('snapshot visibility with borrowed core values', () => {
    let module: ESEngineModule;
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    it('keeps opposite flags and selected values independent across snapshots', () => {
        const registry = new module.Registry(), world = new World();
        world.connectCpp(registry, module);
        const app = { world, hasResource: () => false } as unknown as App;
        const a = world.spawn('Shown'), b = world.spawn('Hidden'), ui = world.spawn('UI');
        try {
            world.insert(a, Transform); world.insert(b, Transform);
            world.insert(a, Sprite, { enabled: true }); world.insert(b, Sprite, { enabled: false });
            world.insert(ui, Sprite, { enabled: false }); world.insert(ui, UINode, { display: UIDisplay.Flex });
            const before = worldSnapshot(app, b, true);
            expect(before.tree!.entities.find(e => e.id === a)).toMatchObject({ hidden: false });
            expect(before.tree!.entities.find(e => e.id === b)).toMatchObject({ hidden: true });
            expect(before.tree!.entities.find(e => e.id === ui)).toMatchObject({ hidden: false });
            const selected = before.selected!.components.find(c => c.type === 'Sprite')!.data;
            expect(selected.enabled).toBe(false);
            world.update(a, Sprite, data => { data.enabled = false; });
            world.update(b, Sprite, data => { data.enabled = true; });
            world.update(ui, UINode, data => { data.display = UIDisplay.None; });
            const after = worldSnapshot(app, b, true);
            expect(after.tree!.entities.find(e => e.id === a)).toMatchObject({ hidden: true });
            expect(after.selected).toMatchObject({ hidden: false });
            expect(after.tree!.entities.find(e => e.id === ui)).toMatchObject({ hidden: true });
            expect(selected.enabled).toBe(false);
            expect(before.selected!.hidden).toBe(true);
        } finally { world.disconnectCpp(); registry.delete(); }
    });
});
