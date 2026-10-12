// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { flushPendingRegistrations } from '../src/app/app';
import { Input, InputState } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { UIInteraction, Interactable } from '../src/ui/input/interactable';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { UIEvents } from '../src/ui/core/events';
import { setEntityActive } from '../src/ecs/entityUtils';
import { inputRouter } from '../src/input/inputRouter';
import { onGestureClick } from '../src/ui/input/gestureClick';
import { getComponent } from '../src/ecs/component';
import { inspectableTypes } from '../src/runtime/worldSnapshot';
const hit = vi.hoisted(() => ({ entity: null as number | null }));
vi.mock('../src/ui/util/ui-pick', () => ({
  screenToUiWorld: () => ({ x: 0, y: 0 }), screenToUiLayout: () => ({ x: 0, y: 0 }),
  uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity,
}));

describe('quick pointer focus through real interaction projection', () => {
  it.each(['control', 'surface'])('clears capture when the %s is switched off', async (reason) => {
    const { app } = bootMockApp(); const input = new InputState();
    const overlay = { active: true, surfaceH: 600 } as any;
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, overlay);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    expect(getComponent('UIInteraction')).toBe(UIInteraction);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true }); hit.entity = entity;
    input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
    expect(app.world.get(entity, UIInteraction).pressed).toBe(true);
    expect(inspectableTypes(app.world, entity)).not.toContain('UIInteraction');
    expect(inspectableTypes(app.world, entity, true)).toContain('UIInteraction');
    if (reason === 'control') app.world.update(entity, Interactable, data => { data.enabled = false; });
    else overlay.active = false;
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: false, pressed: false, justPressed: false, justReleased: false });
    expect(input.pointerOverUI).toBe(false);
    if (reason === 'control') app.world.update(entity, Interactable, data => { data.enabled = true; });
    else overlay.active = true;
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: false });
  });
  it('cancels disabled parent capture and focus, and re-hits a stationary pointer on restore', async () => {
    const { app } = bootMockApp();
    const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); focusPlugin.build(app); flushPendingRegistrations(app);
    const parent = app.world.spawn(), entity = app.world.spawn();
    app.world.setParent(entity, parent);
    app.world.insert(entity, Interactable, { enabled: true });
    app.world.insert(entity, Focusable, {});
    hit.entity = entity;
    const gesture = vi.fn(); onGestureClick(app.world, entity, gesture);
    const clicked = vi.fn(); app.getResource(UIEvents).on(entity, 'click', clicked);
    input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: true });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
    setEntityActive(app.world, parent, false);
    // The host's release can run before another frame observes the switch.
    inputRouter.dispatchPointerUp(0); expect(gesture).not.toHaveBeenCalled();
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: false, pressed: false, justPressed: false, justReleased: false });
    expect(app.getResource(FocusManager).focusedEntity).toBeNull();
    expect(app.world.get(entity, Focusable).isFocused).toBe(false);
    expect(input.pointerOverUI).toBe(false);
    setEntityActive(app.world, parent, true);
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: false });
    input.noteMouseUp(0); await app.tick(1 / 60);
    expect(clicked).not.toHaveBeenCalled();
    expect(gesture).not.toHaveBeenCalled();
  });
  it('preserves press/release edges when the whole click ends before a frame', async () => {
    const { app } = bootMockApp();
    const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app);
    focusPlugin.build(app);
    flushPendingRegistrations(app);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true });
    app.world.insert(entity, Focusable, {});
    hit.entity = entity;
    const kinds: string[] = [];
    for (const kind of ['press', 'release', 'click']) app.getResource(UIEvents).on(entity, kind, () => kinds.push(kind));
    input.noteMouseDown(0);
    input.noteMouseUp(0);
    await app.tick(1 / 60);
    expect(kinds).toEqual(['press', 'release', 'click']);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ pressed: false, justPressed: true, justReleased: true });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
    expect(app.getResource(FocusManager).focusVisible).toBe(false);
    input.clearFrameState();
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ justPressed: false, justReleased: false });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
  });
});
