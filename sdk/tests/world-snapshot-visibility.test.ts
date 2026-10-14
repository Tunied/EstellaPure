import { describe, it, expect } from 'vitest';
import type { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { Sprite, Transform, defineComponent, unregisterComponent, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { hasVisibility, isEntityVisible } from '../src/ecs/entityUtils';
import { worldSnapshot } from '../src/runtime/worldSnapshot';
import { createMockModule } from './mocks/wasm';

function fixture() {
    ensureBuiltinComponentsRegistered();
    const module = createMockModule(), world = new World();
    world.connectCpp(module.getRegistry(), module);
    return { world, app: { world, hasResource: () => false } as unknown as App };
}

describe('runtime snapshot visibility', () => {
    it('matches UI priority, sprite flags and bare entity semantics without repeated has checks', () => {
        const { world, app } = fixture();
        const shown = world.spawn('Shown'), hidden = world.spawn('Hidden'), ui = world.spawn('UI'), bare = world.spawn('Bare');
        world.insert(shown, Sprite, { enabled: true });
        world.insert(hidden, Sprite, { enabled: false });
        world.insert(ui, Sprite, { enabled: false });
        world.insert(ui, UINode, { display: UIDisplay.Flex });
        world.insert(bare, Transform);
        const expected = [shown, hidden, ui, bare].map(id => ({ id, hideable: hasVisibility(world, id), hidden: !isEntityVisible(world, id) }));
        const original = world.has.bind(world);
        const checks: string[] = [];
        world.has = ((entity, comp) => { checks.push(comp._name); return original(entity, comp); }) as typeof world.has;
        const snapshot = worldSnapshot(app, hidden, true);
        for (const row of expected) {
            const actual = snapshot.tree!.entities.find(e => e.id === row.id)!;
            if (row.hideable) expect(actual).toMatchObject(row);
            else expect(actual.hideable).toBeUndefined();
        }
        expect(checks).not.toContain('Sprite');
        expect(checks).not.toContain('UINode');
        expect(snapshot.selected).toMatchObject({ id: hidden, hidden: true });
        world.update(ui, UINode, node => { node.display = UIDisplay.None; });
        expect(worldSnapshot(app, ui, false).selected).toMatchObject({ hidden: true });
        world.remove(hidden, Sprite);
        expect(worldSnapshot(app, hidden, false).selected?.hideable).toBeUndefined();
    });

    it('falls back when a resolved reader has no component value or flag', () => {
        const { world, app } = fixture();
        const entity = world.spawn();
        world.insert(entity, Sprite, { enabled: false });
        for (const value of [null, {}]) {
            world.resolveGetter = () => () => value;
            expect(worldSnapshot(app, entity, false).selected).toMatchObject({ hideable: true, hidden: true });
        }
    });

    it('keeps transient renderers hideable and follows runtime registration', () => {
        const { world, app } = fixture();
        const entity = world.spawn();
        expect(worldSnapshot(app, entity, true).selected?.hideable).toBeUndefined();
        const renderer = defineComponent('SnapshotTransientRenderer', { visible: false }, { renderableField: 'visible', transient: true });
        try {
            world.insert(entity, renderer);
            const snapshot = worldSnapshot(app, entity, true);
            expect(snapshot.selected).toMatchObject({ hideable: true, hidden: true });
            expect(snapshot.selected!.components.map(c => c.type)).not.toContain(renderer._name);
            world.set(entity, renderer, { visible: true });
            expect(worldSnapshot(app, entity, false).selected?.hidden).toBe(false);
            world.remove(entity, renderer);
            expect(worldSnapshot(app, entity, true).selected?.hideable).toBeUndefined();
        } finally { unregisterComponent(renderer._name); }
    });
});
