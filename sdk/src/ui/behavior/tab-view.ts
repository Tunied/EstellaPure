// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, Parent, Children } from '../../ecs/component';
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UINode, UIDisplay } from '../core/ui-node';
import { UIEventType, type UIEventQueue } from '../core/events';
import { UIToggle, UIToggleGroup } from './toggle';
import { FocusManager, type FocusManagerState } from '../input/focusable';
import { isFocusEligible } from '../input/focus-inspection';
import { moveUIFocus } from '../input/focus-transition';
import { setUIVisible } from '../core/compose';
import { Text } from '../core/text';

/** Ordered, parallel entity lists use the same prefab remapping as MeshSkin.joints. */
export interface UITabViewData {
    selectedIndex: number;
    tabs: Entity[];
    pages: Entity[];
    labels: string[];
    allowSwitchOff: boolean;
    vertical: boolean;
    loopNavigation: boolean;
    selectOnFocus: boolean;
}

/** A ToggleGroup with corresponding content pages. No separate selection primitive. @beta */
export const UITabView = defineComponent<UITabViewData>('UITabView', {
    selectedIndex: 0, tabs: [], pages: [], labels: [], allowSwitchOff: false,
    vertical: false, loopNavigation: true, selectOnFocus: true,
}, { entityFields: ['tabs', 'pages'], fields: { selectedIndex: { min: -1, step: 1 } } });

function within(world: World, entity: Entity, root: Entity): boolean {
    const seen = new Set<Entity>();
    while (world.valid(entity) && world.has(entity, Parent) && !seen.has(entity)) {
        seen.add(entity);
        entity = world.get(entity, Parent).entity;
        if (entity === root) return true;
    }
    return false;
}

/** Bind only this view's descendants; malformed references cannot hide another panel. */
export function tabViewBindings(world: World, root: Entity, d: UITabViewData): number[] {
    const tabs = new Set<Entity>(), pages = new Set<Entity>();
    return d.tabs.flatMap((tab, i) => {
        const page = d.pages[i];
        if (!world.valid(tab) || !world.has(tab, UIToggle) || !within(world, tab, root)
            || !page || !world.valid(page) || !world.has(page, UINode) || !within(world, page, root)
            || tabs.has(tab) || pages.has(page) || tab === page || within(world, tab, page)) return [];
        // A nested ToggleGroup owns its own toggles, never this view's selection.
        let parent = world.get(tab, Parent).entity;
        while (parent !== root) {
            if (world.has(parent, UIToggleGroup)) return [];
            parent = world.get(parent, Parent).entity;
        }
        tabs.add(tab); pages.add(page);
        return [i];
    });
}

/** Apply selection without emitting: also used by the editor's ephemeral preview. */
export function applyTabViewSelection(world: World, root: Entity, index: number): void {
    if (!world.valid(root) || !world.has(root, UITabView)) return;
    const d = world.get(root, UITabView);
    const bindings = tabViewBindings(world, root, d);
    for (const i of bindings) {
        const toggle = world.get(d.tabs[i], UIToggle);
        if (toggle.isOn !== (i === index)) world.insert(d.tabs[i], UIToggle, { ...toggle, isOn: i === index });
        setUIVisible(world, toggle.check, i === index);
        const node = world.get(d.pages[i], UINode);
        const display = i === index ? UIDisplay.Flex : UIDisplay.None;
        if (node.display !== display) world.insert(d.pages[i], UINode, { ...node, display });
    }
}

/** Selection, page display and keyboard traversal are per-world runtime state. */
export function createTabViewSystem(world: World, events: UIEventQueue): SystemDef {
    const previous = new Map<Entity, { index: number; on: Set<Entity>; pages: Map<Entity, number>; focus: Entity | null }>();
    const restorePage = (page: Entity, display: number) => {
        if (world.valid(page) && world.has(page, UINode)) {
            const node = world.get(page, UINode);
            if (node.display !== display) world.insert(page, UINode, { ...node, display });
        }
    };
    return defineSystem([Res(Input), Res(FocusManager)], (input: InputState, focus: FocusManagerState) => {
        const live = new Set(world.getEntitiesWithComponents([UITabView]));
        for (const [e, old] of previous) if (!live.has(e)) {
            for (const [page, display] of old.pages) restorePage(page, display);
            previous.delete(e);
        }
        for (const root of live) {
            if (!world.valid(root) || !world.has(root, UITabView)) continue;
            const d = world.get(root, UITabView);
            if (!world.has(root, UIToggleGroup) || world.get(root, UIToggleGroup).allowSwitchOff !== d.allowSwitchOff) {
                world.insert(root, UIToggleGroup, { allowSwitchOff: d.allowSwitchOff });
            }
            const bindings = tabViewBindings(world, root, d);
            const old = previous.get(root);
            const pageStates = old?.pages ?? new Map<Entity, number>();
            const managed = new Set(bindings.map(i => d.pages[i]));
            for (const [page, display] of pageStates) if (!managed.has(page)) { restorePage(page, display); pageStates.delete(page); }
            for (const page of managed) if (!pageStates.has(page)) pageStates.set(page, world.get(page, UINode).display);
            let next = Number.isFinite(d.selectedIndex) ? Math.trunc(d.selectedIndex) : -1;
            if (old && old.index === next) {
                const switched = bindings.find(i => world.get(d.tabs[i], UIToggle).isOn && !old.on.has(d.tabs[i]));
                if (switched !== undefined) next = switched;
                else if (d.allowSwitchOff && !bindings.some(i => world.get(d.tabs[i], UIToggle).isOn)) next = -1;
            }
            const eligible = bindings.filter(i => isFocusEligible(world, d.tabs[i]));
            const at = eligible.findIndex(i => d.tabs[i] === focus.focusedEntity);
            if (at >= 0) {
                let move = at;
                const navigation = ['Home', 'End', ...(d.vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'])]
                    .some(key => input.isKeyPressed(key));
                if (input.isKeyPressed('Home')) move = 0;
                else if (input.isKeyPressed('End')) move = eligible.length - 1;
                else if (input.isKeyPressed(d.vertical ? 'ArrowDown' : 'ArrowRight')) move++;
                else if (input.isKeyPressed(d.vertical ? 'ArrowUp' : 'ArrowLeft')) move--;
                if (d.loopNavigation) move = (move + eligible.length) % eligible.length;
                else move = Math.max(0, Math.min(eligible.length - 1, move));
                if (move !== at) moveUIFocus(world, events, focus, d.tabs[eligible[move]], true);
                if (!world.valid(root) || !world.has(root, UITabView)) continue;
                if (d.selectOnFocus && focus.focusVisible && focus.focusedEntity === d.tabs[eligible[move]]
                    && (navigation || old?.focus !== focus.focusedEntity)) next = eligible[move];
            }
            if (!bindings.includes(next)) next = d.allowSwitchOff ? -1 : (eligible[0] ?? bindings[0] ?? -1);
            const changed = old !== undefined && old.index !== next;
            if (d.selectedIndex !== next) world.insert(root, UITabView, { ...d, selectedIndex: next });
            applyTabViewSelection(world, root, next);
            for (const i of bindings) {
                if (d.labels[i] === undefined || !world.has(d.tabs[i], Children)) continue;
                const label = world.get(d.tabs[i], Children).entities.find(child => world.has(child, Text));
                if (label === undefined) continue;
                const text = world.get(label, Text);
                if (text.content !== d.labels[i]) world.insert(label, Text, { ...text, content: d.labels[i] });
            }
            previous.set(root, { index: next, on: new Set(bindings.filter(i => i === next).map(i => d.tabs[i])),
                pages: pageStates, focus: focus.focusedEntity });
            if (changed) events.emit(root, UIEventType.Change, { index: next, page: d.pages[next] ?? 0 });
        }
    }, { name: 'UITabViewSystem', runAfter: ['FocusSystem'] });
}
