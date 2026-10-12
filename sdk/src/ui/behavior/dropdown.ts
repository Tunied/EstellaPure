// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/dropdown.ts
 * @brief   UIDropdown — data-driven select control.
 *
 * The component holds the display labels + `selectedIndex` + the button-label
 * entity ref; the system owns the popup lifecycle (click toggles it, a click
 * anywhere else closes it), row selection, keyboard stepping while focused,
 * and the label sync — the single writer, so `setSelectedIndex`, a binding,
 * the editor inspector, and pointer selection all behave identically. A
 * prefab-placed dropdown is fully functional without code.
 *
 * The popup is a transient runtime subtree, rebuilt on each open with fresh
 * theme colors and tagged with ThemeStyle roles for live re-theming.
 */
import { defineComponent } from '../../ecs/component';
import { defineSystem, type SystemDef } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { px, percent } from '../core/dimension';
import { UINode } from '../core/ui-node';
import { spawnUIEntity } from '../core/compose';
import { Text, type TextData } from '../core/text';
import { UIEventType, type UIEventQueue } from '../core/events';
import { Interactable, makeWidgetInteractable, type InteractableData } from '../input/interactable';
import { Focusable, type FocusableData } from '../input/focusable';
import { UIController, interactionController, type UIControllerData, INTERACTION_CONTROLLER } from '../controller/ui-controller';
import { UIGear } from '../controller/ui-gear';
import { interactionGears } from '../controller/interaction-gears';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { EntityStateMap, walkParentChain } from '../util/helpers';

export interface UIDropdownData {
    /** Display labels, one per option. */
    options: string[];
    selectedIndex: number;
    /** Popup row height in px. */
    optionHeight: number;
    /** The button's label Text entity (content tracks the selection). */
    label: Entity;
}

export const UIDropdown = defineComponent<UIDropdownData>('UIDropdown', {
    options: [],
    selectedIndex: 0,
    optionHeight: 32,
    label: 0 as Entity,
}, { entityFields: ['label'] });

interface PopupState {
    panel: Entity;
    rows: Entity[];
    unsubs: Array<() => void>;
    options: string[];
    optionHeight: number;
}

function popupMatches(p: PopupState, d: UIDropdownData): boolean {
    if (p.optionHeight !== d.optionHeight || p.options.length !== d.options.length) return false;
    for (let i = 0; i < p.options.length; i++) if (p.options[i] !== d.options[i]) return false;
    return true;
}

function dropdownAvailable(world: World, e: Entity): boolean {
    if (!world.isEntityActive(e) || world.isDestructionPending(e) || !world.has(e, UIDropdown)) return false;
    if (world.has(e, Interactable) && !(world.get(e, Interactable) as InteractableData).enabled) return false;
    return !world.has(e, UINode)
        || !worldEngineApi(world)?.getUINodeHiddenInTree?.(world.getCppRegistry()!, e);
}

// Popup registries are runtime-only and per-world (unit tests run many worlds).
const popupsByWorld = new WeakMap<World, Map<Entity, PopupState>>();

function popupsOf(world: World): Map<Entity, PopupState> {
    let m = popupsByWorld.get(world);
    if (!m) {
        m = new Map();
        popupsByWorld.set(world, m);
    }
    return m;
}

export function isDropdownOpen(world: World, e: Entity): boolean {
    return popupsOf(world).has(e);
}

export function closeDropdown(world: World, e: Entity): void {
    const popups = popupsOf(world);
    const p = popups.get(e);
    if (!p) return;
    popups.delete(e);
    for (const off of p.unsubs) off();
    if (world.valid(p.panel)) world.despawn(p.panel);
}

export function openDropdown(world: World, events: UIEventQueue, e: Entity): void {
    const popups = popupsOf(world);
    if (popups.has(e) || !dropdownAvailable(world, e)) return;
    const d = world.get(e, UIDropdown) as UIDropdownData;
    const options = [...d.options], optionHeight = d.optionHeight;

    // Fresh theme resolution per open — the popup is transient, so a stale
    // capture would pin whatever theme was active earlier.
    const t = themeColors();
    const panel = spawnUIEntity({
        world,
        parent: e,
        // Below the button: absolute, full width, top at the button's bottom edge.
        node: {
            position: 1,
            insetLeft: px(0),
            insetRight: px(0),
            insetTop: percent(100),
            height: px(options.length * optionHeight),
        },
        visual: { color: t.surfaceElevated },
    });
    markThemed(world, panel, { visual: 'surfaceElevated' });

    const unsubs: Array<() => void> = [];
    const rows: Entity[] = [];
    for (let i = 0; i < options.length; i++) {
        const row = spawnUIEntity({
            world,
            parent: panel,
            node: {
                position: 1,
                insetLeft: px(0),
                insetRight: px(0),
                insetTop: px(i * optionHeight),
                height: px(optionHeight),
            },
            visual: { color: t.control },
        });
        // Rows are pointer-only: the popup is transient, so they stay out of
        // the Tab ring. 'selected' is NOT driver-owned — the keyboard highlight
        // holds it, and the pointer driver leaves such pages alone.
        makeWidgetInteractable(world, row, { focusable: false });
        world.insert(row, UIController, {
            controllers: [interactionController(['normal', 'hover', 'pressed', 'selected'])],
        });
        world.insert(row, UIGear, {
            bindings: interactionGears({
                normal: { color: t.control },
                hover: { color: t.primaryHover },
                pressed: { color: t.primaryActive },
                selected: { color: t.primaryActive },
            }),
        });
        markThemed(world, row, {
            states: {
                normal: 'control', hover: 'primaryHover',
                pressed: 'primaryActive', selected: 'primaryActive',
            },
        });

        const rowLabel = spawnUIEntity({
            world,
            parent: row,
            node: { fill: true },
            text: { content: options[i]!, color: t.text },
        });
        markThemed(world, rowLabel, { text: 'text' });

        const index = i;
        unsubs.push(events.on(row, UIEventType.Click, () => {
            const available = dropdownAvailable(world, e);
            closeDropdown(world, e);
            if (!available || !dropdownAvailable(world, e)) return;
            const cur = world.get(e, UIDropdown) as UIDropdownData;
            if (cur.options[index] !== options[index]) return;
            if (cur.selectedIndex !== index) {
                cur.selectedIndex = index;
                world.insert(e, UIDropdown, cur);
            }
        }));
        rows.push(row);
    }
    popups.set(e, { panel, rows, unsubs, options, optionHeight });
    highlightRow(world, rows, d.selectedIndex);
}

/** Keyboard highlight: the selected row holds the non-driver-owned 'selected'
 *  page; every other row returns to 'normal', handing pointer hover back to
 *  the driver. */
function highlightRow(world: World, rows: Entity[], selected: number): void {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (!world.valid(row) || !world.has(row, UIController)) continue;
        const data = world.get(row, UIController) as UIControllerData;
        const ctrl = data.controllers.find((c) => c.name === INTERACTION_CONTROLLER);
        if (!ctrl) continue;
        const want = i === selected ? 'selected' : (ctrl.current === 'selected' ? 'normal' : ctrl.current);
        if (ctrl.current !== want) {
            ctrl.current = want;
            world.insert(row, UIController, data);
        }
    }
}

/** True when `entity` is inside the popup subtree of any open dropdown. */
function insideAnyPopup(world: World, entity: Entity): boolean {
    const popups = popupsOf(world);
    if (popups.size === 0) return false;
    const panels = new Set<number>();
    for (const p of popups.values()) panels.add(p.panel as number);
    if (panels.has(entity as number)) return true;
    let inside = false;
    walkParentChain(world, entity, (ancestor) => {
        if (panels.has(ancestor as number)) {
            inside = true;
            return true;
        }
        return false;
    });
    return inside;
}

/**
 * Popup lifecycle + selection + keyboard + label sync for every UIDropdown.
 */
export function createDropdownSystem(world: World, events: UIEventQueue): SystemDef {
    const shown = new EntityStateMap<{ index: number; label: Entity; content: string }>();

    // One global click handler arbitrates: the dropdown root toggles its own
    // popup; a click inside a popup is the row handler's business; any other
    // click closes every open popup (click-outside-to-close).
    events.on(UIEventType.Click, (ev) => {
        const target = ev.target;
        if (world.valid(target) && world.has(target, UIDropdown)) {
            if (!dropdownAvailable(world, target)) {
                closeDropdown(world, target);
                return;
            }
            if (isDropdownOpen(world, target)) closeDropdown(world, target);
            else openDropdown(world, events, target);
            return;
        }
        if (insideAnyPopup(world, target)) return;
        for (const e of [...popupsOf(world).keys()]) closeDropdown(world, e);
    });

    world.onDespawn((e) => {
        // The popup subtree dies with its parent; drop the bookkeeping.
        if (popupsOf(world).has(e)) closeDropdown(world, e);
    });

    return defineSystem([Res(Input)], (input: InputState) => {
        const popups = popupsOf(world);
        // Inactive owners disappear from component queries but still own popup entries.
        if (popups.size > 0) {
            for (const e of popups.keys()) {
                if (!dropdownAvailable(world, e)) closeDropdown(world, e);
            }
        }
        for (const e of world.getEntitiesWithComponents([UIDropdown])) {
            if (!world.valid(e) || !world.has(e, UIDropdown)) continue;
            let d = world.get(e, UIDropdown) as UIDropdownData;
            const index = Number.isFinite(d.selectedIndex) ? Math.trunc(d.selectedIndex) : 0;
            const clamped = Math.max(0, Math.min(index, d.options.length - 1));
            if (clamped !== d.selectedIndex) {
                d.selectedIndex = clamped;
                world.insert(e, UIDropdown, d);
            }
            const previousPopup = popups.get(e);
            if (previousPopup && !popupMatches(previousPopup, d)) {
                closeDropdown(world, e);
                if (!world.valid(e) || !world.has(e, UIDropdown)) continue;
                openDropdown(world, events, e);
                d = world.get(e, UIDropdown) as UIDropdownData;
            }

            // Keyboard: arrows step the selection whether the popup is open
            // (moving the row highlight) or closed (the native <select>
            // convention); Enter confirms and Escape dismisses an open popup.
            const focused = world.has(e, Focusable)
                && (world.get(e, Focusable) as FocusableData).isFocused;
            const open = isDropdownOpen(world, e);
            if (focused && dropdownAvailable(world, e) && d.options.length > 0) {
                let next = d.selectedIndex;
                if (input.isKeyPressed('ArrowDown')) next = Math.min(next + 1, d.options.length - 1);
                if (input.isKeyPressed('ArrowUp')) next = Math.max(next - 1, 0);
                if (next !== d.selectedIndex) {
                    d.selectedIndex = next;
                    world.insert(e, UIDropdown, d);
                }
                if (open && (input.isKeyPressed('Enter') || input.isKeyPressed('Escape'))) {
                    closeDropdown(world, e);
                }
            }

            if (!world.valid(e) || !world.has(e, UIDropdown)) continue;

            // Selection → label + row highlight + change event, whoever wrote
            // the index.
            const content = d.options[d.selectedIndex] ?? '';
            const previous = shown.get(e);
            if (!previous || previous.index !== d.selectedIndex || previous.label !== d.label || previous.content !== content) {
                const emitChange = previous !== undefined && previous.index !== d.selectedIndex;
                if (previous) {
                    previous.index = d.selectedIndex; previous.label = d.label; previous.content = content;
                } else {
                    shown.set(e, { index: d.selectedIndex, label: d.label, content });
                }
                if (world.valid(d.label) && world.has(d.label, Text)) {
                    const txt = world.get(d.label, Text) as TextData;
                    if (txt.content !== content) {
                        txt.content = content;
                        world.insert(d.label, Text, txt);
                    }
                }
                const popup = popups.get(e);
                if (popup) highlightRow(world, popup.rows, d.selectedIndex);
                if (emitChange) events.emit(e, UIEventType.Change, { index: d.selectedIndex });
            }
        }
        shown.cleanup(world);
    }, { name: 'UIDropdownSystem' });
}
