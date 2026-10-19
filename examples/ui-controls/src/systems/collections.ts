// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
    defineSystem, GetWorld, Res, UIEvents, UITreeView, UIColorPicker, UIDropdown,
    UIEventType, Sprite, MeshRenderer, Name, Text, setTreeViewData,
    type World, type UIEventQueue, type TreeDataSource, type TreeDropRequest,
} from 'esengine';

// Project records deliberately use a different shape from TreeViewNode. The
// adapter is the only place that knows these domain keys and child collections.
interface Entry { key: string; title: string; entries?: Entry[] }
const DATASETS: readonly Entry[][] = [
    [{ key: 'world', title: 'World', entries: [
        { key: 'environment', title: 'Environment / 3D', entries: [{ key: 'terrain', title: 'Terrain' }, { key: 'light', title: 'KeyLight' }] },
        { key: 'hud', title: 'HUD / 2D', entries: [{ key: 'portrait', title: 'Portrait / Sprite' }, { key: 'health', title: 'HealthBar / UI' }] },
    ] }],
    [{ key: 'assets', title: 'Assets', entries: [
        { key: 'art', title: 'Art', entries: [{ key: 'sprite', title: 'player.png' }, { key: 'model', title: 'character.glb' }] },
        { key: 'audio', title: 'Audio', entries: [{ key: 'music', title: 'ambient.ogg' }] },
    ] }],
    [{ key: 'quests', title: 'Quest log', entries: [
        { key: 'main', title: 'Main quests', entries: [{ key: 'camp', title: 'Reach the camp' }, { key: 'ruins', title: 'Explore the ruins' }] },
        { key: 'side', title: 'Side quests', entries: [{ key: 'herbs', title: 'Collect herbs / 0 of 5' }] },
    ] }],
];
interface State { tree: number; dropdown: number; picker: number; sprite: number; mesh: number; status: number; index: number; color: string; off?: () => void }
const states = new WeakMap<World, State>();

function bind(world: World, state: State, index: number): void {
    state.off?.(); state.index = index;
    const roots: Entry[] = structuredClone(DATASETS[index] ?? DATASETS[0]);
    const listeners = new Set<() => void>();
    const source: TreeDataSource<Entry> = {
        getRoots: () => roots, getChildren: item => item.entries ?? [], getId: item => item.key, getLabel: item => item.title,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const lookup = (key: string): { item: Entry; siblings: Entry[] } | undefined => {
        const stack = [roots]; while (stack.length) {
            const siblings = stack.pop()!;
            for (const item of siblings) { if (item.key === key) return { item, siblings }; if (item.entries) stack.push(item.entries); }
        }
        return undefined;
    };
    // This is project policy. The engine validates cycles and emits an intent;
    // only the host adapter decides how a domain record should actually move.
    const move = (request: TreeDropRequest<Entry>): void => {
        const source = lookup(String(request.source.id)), target = lookup(String(request.target.id)); if (!source || !target) return;
        source.siblings.splice(source.siblings.indexOf(source.item), 1);
        if (request.position === 'inside') (target.item.entries ??= []).push(source.item);
        else target.siblings.splice(target.siblings.indexOf(target.item) + (request.position === 'after' ? 1 : 0), 0, source.item);
        for (const listener of listeners) listener();
    };
    state.off = setTreeViewData(world, state.tree, source, { onDrop: move });
    const expandedIds: string[] = [], stack = [...roots];
    while (stack.length) { const item = stack.pop()!; if (item.entries?.length) { expandedIds.push(item.key); stack.push(...item.entries); } }
    world.update(state.tree, UITreeView, data => { data.expandedIds = expandedIds; data.selectedIds = []; });
}

export const collectionsSystem = defineSystem([GetWorld(), Res(UIEvents)], (world: World, events: UIEventQueue) => {
    let state = states.get(world);
    if (!state || !world.valid(state.tree)) {
        const named = new Map(world.getEntitiesWithComponents([Name]).map(entity => [world.get(entity, Name).value, entity]));
        const tree = named.get('ContentTree'), picker = named.get('AccentPicker'), dropdown = named.get('DataSource');
        const sprite = named.get('SpriteSample'), mesh = named.get('MaterialSample'), status = named.get('SelectionStatus');
        if (tree == null || picker == null || dropdown == null || sprite == null || mesh == null || status == null) return;
        state = { tree, picker, dropdown, sprite, mesh, status, index: -1, color: '' }; states.set(world, state);
    }
    const index = world.get(state.dropdown, UIDropdown).selectedIndex;
    if (index !== state.index) bind(world, state, index);
    const color = world.get(state.picker, UIColorPicker).color, revision = JSON.stringify(color);
    if (state.color !== revision) {
        state.color = revision;
        if (world.valid(state.sprite)) world.update(state.sprite, Sprite, sprite => { sprite.color = { ...color }; });
        if (world.valid(state.mesh)) world.update(state.mesh, MeshRenderer, mesh => { mesh.color = { ...color }; mesh.opaque = color.a >= 1; });
    }
    // Expose the event contract in the sample without coupling the control to a
    // gameplay type. Other projects can route this to their own bindings.
    for (const event of events.query(UIEventType.Change)) if (event.target === state.tree) {
        const ids = (event.data as { ids: Array<string | number> }).ids;
        if (world.valid(state.status)) world.update(state.status, Text, text => { text.content = `Selected: ${ids.join(', ') || 'none'}`; });
    }
}, { name: 'CollectionsExampleSystem', runAfter: ['UITreeViewSystem', 'UIColorPickerSystem'] });
