import { beforeAll, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Sprite, Disabled, defineComponent } from '../src/ecs/component';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('bulk builtin inspection on the core', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('reflects native and script edits and preserves the legacy answer', () => {
        const registry = new module.Registry();
        const world = new World();
        world.connectCpp(registry, module);
        const script = defineComponent('BulkInspectionScript', { value: 1 });
        const entity = world.spawn('Actor');
        try {
            expect(typeof registry.getBuiltinComponentNames).toBe('function');
            world.insert(entity, Transform);
            world.insert(entity, Sprite);
            world.insert(entity, script);
            world.insert(entity, Disabled);
            const bulk = world.getComponentTypes(entity);
            expect(bulk).toEqual(expect.arrayContaining(['Name', 'Transform', 'Sprite', 'Disabled', 'BulkInspectionScript']));
            const read = registry.getBuiltinComponentNames!;
            registry.getBuiltinComponentNames = undefined;
            const legacy = world.getComponentTypes(entity);
            registry.getBuiltinComponentNames = read;
            expect(bulk).toEqual(legacy);
            registry.removeSprite(entity);
            expect(world.getComponentTypes(entity)).not.toContain('Sprite');
            world.remove(entity, script);
            expect(world.getComponentTypes(entity)).not.toContain('BulkInspectionScript');
            world.despawn(entity);
            expect(registry.getBuiltinComponentNames!(entity)).toBe('');
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('reads the registry it is called on, including recycled entity ids', () => {
        const first = new module.Registry(), second = new module.Registry();
        const a = new World(), b = new World();
        a.connectCpp(first, module); b.connectCpp(second, module);
        try {
            const e = a.spawn(), other = b.spawn();
            expect(e).toBe(other);
            a.insert(e, Sprite);
            b.insert(other, Transform);
            expect(a.getComponentTypes(e)).toContain('Sprite');
            expect(a.getComponentTypes(e)).not.toContain('Transform');
            expect(b.getComponentTypes(other)).toContain('Transform');
            expect(b.getComponentTypes(other)).not.toContain('Sprite');
            a.despawn(e);
            const next = a.spawn();
            expect(a.getComponentTypes(next)).not.toContain('Sprite');
            expect(first.getBuiltinComponentNames!(e)).toBe('');
        } finally { a.disconnectCpp(); b.disconnectCpp(); first.delete(); second.delete(); }
    });
});
