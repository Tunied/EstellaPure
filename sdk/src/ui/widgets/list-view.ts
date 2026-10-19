// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    list-view.ts
 * @brief   createListView — the ergonomic widget factory over the collection core.
 *
 * A one-call, data-driven, virtualized list/grid that composes the existing
 * primitives (DataSource + LayoutProvider + ViewPool + ListView + ScrollContainer
 * + UIMask) — matching the createButton/createDialog factory-and-handle shape.
 *
 * Items are positioned by UINode Absolute inset (not Transform, which the UI
 * layout owns); the content frame is translated by the scroll offset; a
 * Scissor UIMask on the viewport clips. Wheel and drag/touch scrolling (with
 * a kinetic fling) are handled by the behavior plugin once the viewport is a
 * hovered raycast target.
 */
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../ecs/world';

import { UINode, UIDisplay, UIPositionType, type UINodeData } from '../core/ui-node';
import { px, auto } from '../core/dimension';
import { UIMask, MaskMode } from '../core/ui-mask';

import { spawnUIEntity, setUIVisible, type UINodeInit, type UIVisualInit } from '../core/compose';
import { makeWidgetInteractable } from '../input/interactable';

import {
    type DataSource,
    ArrayDataSource,
} from '../collection/data-source';
import {
    type LayoutProvider,
    type Rect,
    LinearLayoutProvider,
    MeasuredLinearLayoutProvider,
    GridLayoutProvider,
} from '../collection/layout-provider';
import { ListView, type ListViewOptions } from '../collection/list-view';
import { ScrollContainer } from '../collection/scroll-container';
import { worldEngineApi, type EngineApi } from '../../ecs/bridge/engineApi';
import { WasmBridge } from '../../wasm/WasmBridge';

class ViewportBridge extends WasmBridge<NonNullable<EngineApi>> {
    protected readonly label = 'listViewport';
}

/** Linear UI items fill the resolved cross axis; custom layouts keep their own sizes. */
class CrossAxisLayout implements LayoutProvider {
    constructor(private readonly base_: LayoutProvider, private readonly axis_: 'vertical' | 'horizontal',
        private crossSize_: number) {}

    resize(size: Vec2): void {
        this.crossSize_ = this.axis_ === 'vertical' ? size.x : size.y;
    }

    getContentSize(count: number): Vec2 {
        const size = this.base_.getContentSize(count);
        if (count <= 0) return size;
        return this.axis_ === 'vertical' ? { x: this.crossSize_, y: size.y } : { x: size.x, y: this.crossSize_ };
    }

    getItemRect(index: number): Rect {
        const rect = this.base_.getItemRect(index);
        return this.axis_ === 'vertical' ? { ...rect, width: this.crossSize_ } : { ...rect, height: this.crossSize_ };
    }

    getVisibleRange(viewport: Rect, count: number): [number, number] {
        return this.base_.getVisibleRange(viewport, count);
    }

    invalidate(): void {
        (this.base_ as LayoutProvider & { invalidate?: () => void }).invalidate?.();
    }
}

/** The actual UI box owns the visible range and scroll bounds, in layout-local units. */
class LayoutBoundListView<T> extends ListView<T> {
    private uiDisposed_ = false;
    private readonly viewportWorld_: World;
    private readonly bounds_ = new ViewportBridge();
    private boundsEngine_: EngineApi | null = null;

    constructor(opts: ListViewOptions<T>, private readonly viewport_: Entity,
        private readonly scroll_: ScrollContainer, private readonly crossLayout_: CrossAxisLayout | null) {
        super(opts);
        this.viewportWorld_ = opts.world;
    }

    override update(): void {
        if (this.uiDisposed_ || !this.viewportWorld_.valid(this.viewport_)) return;
        const engine = worldEngineApi(this.viewportWorld_);
        const registry = this.viewportWorld_.getCppRegistry();
        if (engine && registry && engine !== this.boundsEngine_) {
            this.bounds_.connect(engine);
            this.boundsEngine_ = engine;
        }
        const bounds = engine && registry ? this.bounds_.module : null;
        const x = bounds?.getUINodeComputedWidth?.(registry!, this.viewport_) ?? 0;
        const y = bounds?.getUINodeComputedHeight?.(registry!, this.viewport_) ?? 0;
        const current = this.getViewport();
        // Unresolved layout keeps the initial hint; only finite resolved boxes resize.
        if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0
            && (x !== current.width || y !== current.height)) {
            const size = { x, y };
            this.crossLayout_?.resize(size);
            this.setViewportSize(size);
            this.scroll_.setSizes(size, this.getContentSize());
        }
        super.update();
    }

    override dispose(): void {
        this.uiDisposed_ = true;
        this.bounds_.disconnect();
        this.boundsEngine_ = null;
        super.dispose();
    }
}

/**
 * The per-frame runtime a list view plugs into: the tick registry that drives
 * virtualization and the scroll input hookup. The composed `uiPlugin` (and the
 * granular `uiBehaviorPlugin`) satisfy this — passed explicitly so the factory
 * works against whichever plugin instance owns the app, never a module
 * singleton.
 */
export interface ListViewHost {
    registerListView(list: ListView<unknown>): void;
    unregisterListView(list: ListView<unknown>): void;
    attachScrollContainer(entity: Entity, container: ScrollContainer): void;
    detachScrollContainer(entity: Entity): void;
}

/** A single item type: how to build the entity and how to bind data to it. */
export interface ListItemTemplate<T> {
    /** Create one item entity (use `spawnUIEntity` so it carries a UINode). */
    create: (world: World, parent: Entity) => Entity;
    /** Apply data to an item; called on every (re)bind, so keep it idempotent. */
    bind: (entity: Entity, data: T, index: number) => void;
}

/** Layout sugar. A column list, a row list, or a grid (`columns`). */
export type ListLayoutSpec =
    | { itemHeight: number | ((index: number) => number); spacing?: number; direction?: 'column' }
    | { itemWidth: number; spacing?: number; direction: 'row' }
    | { columns: number; itemSize: Vec2; spacing?: Vec2 };

export interface CreateListViewOptions<T> {
    world: World;
    /** The plugin that ticks virtualization + routes scroll input (`uiPlugin`). */
    host: ListViewHost;
    parent?: Entity;
    /** Initial UI layout size; virtualization and scroll bounds follow the resolved box. */
    viewportSize: Vec2;
    /** Extra viewport UINode props (its size defaults to `viewportSize`). */
    node?: UINodeInit;
    /** Viewport background. Default: a transparent hit-target (so the wheel works). */
    background?: UIVisualInit;
    /** Backing data — a `DataSource<T>` or a raw array (wrapped in an ArrayDataSource). */
    data: DataSource<T> | readonly T[];
    /** Layout sugar (`itemHeight` / `columns` …) or a full `LayoutProvider`. */
    layout: ListLayoutSpec | LayoutProvider;
    /** One template, or a map of item type → template for heterogeneous rows. */
    item: ListItemTemplate<T> | Record<string, ListItemTemplate<T>>;
    /** Scroll axis. Defaults from the layout (column→vertical, row→horizontal). */
    direction?: 'vertical' | 'horizontal' | 'both';
    /** Extra indices kept mounted on each side of the visible range. Default 2. */
    recycleBuffer?: number;
    /** Wheel delta multiplier. Default 1. */
    wheelSpeed?: number;
    /** Drag/touch scrolling with a kinetic fling. Default true. */
    dragScroll?: boolean;
    /** Fling velocity fraction left after 1s of coasting. Default 0.135. */
    decelerationRate?: number;
    /** Called after each item bind. */
    onItemBound?: (entity: Entity, data: T, index: number) => void;
}

export interface ListViewHandle<T> {
    /** The viewport entity (the clipped window; add it to your UI tree). */
    readonly entity: Entity;
    /** The scrolling content frame that items are parented to. */
    readonly content: Entity;
    /** The data source — mutate an `ArrayDataSource` here to update the list. */
    readonly data: DataSource<T>;
    /** The scroll model (escape hatch: `scroll.scrollBy`, `onScroll`, …). */
    readonly scroll: ScrollContainer;
    /** The virtualization driver (escape hatch). */
    readonly view: ListView<T>;
    /** Force a re-sync of mounted items on the next frame. */
    refresh(): void;
    /** Scroll so item `index` is at the top-left of the viewport. */
    scrollToIndex(index: number): void;
    /** Number of item entities currently mounted (for virtualization checks). */
    mountedCount(): number;
    /** Tear down: unregister, release items, drop scroll/data subscriptions. */
    dispose(): void;
}

function isDataSource<T>(d: DataSource<T> | readonly T[]): d is DataSource<T> {
    return !Array.isArray(d) && typeof (d as DataSource<T>).getCount === 'function';
}

function isLayoutProvider(l: ListLayoutSpec | LayoutProvider): l is LayoutProvider {
    return typeof (l as LayoutProvider).getItemRect === 'function';
}

function buildLayout(spec: ListLayoutSpec, viewport: Vec2): { layout: LayoutProvider; axis: 'vertical' | 'horizontal' } {
    if ('columns' in spec) {
        return {
            layout: new GridLayoutProvider({ columns: spec.columns, itemSize: spec.itemSize, spacing: spec.spacing }),
            axis: 'vertical',
        };
    }
    if ('itemWidth' in spec) {
        return {
            layout: new LinearLayoutProvider({ direction: 'row', itemSize: { x: spec.itemWidth, y: viewport.y }, spacing: spec.spacing }),
            axis: 'horizontal',
        };
    }
    if (typeof spec.itemHeight === 'function') {
        const mainSizeOf = spec.itemHeight;
        return {
            layout: new MeasuredLinearLayoutProvider({ direction: 'column', crossSize: viewport.x, mainSizeOf, spacing: spec.spacing }),
            axis: 'vertical',
        };
    }
    return {
        layout: new LinearLayoutProvider({ direction: 'column', itemSize: { x: viewport.x, y: spec.itemHeight }, spacing: spec.spacing }),
        axis: 'vertical',
    };
}

/** Position an item within the content by its computed rect (Absolute inset). */
function placeByInset(world: World, entity: Entity, rect: Rect): void {
    if (!world.has(entity, UINode)) return;
    const n = world.get(entity, UINode) as UINodeData;
    n.position = UIPositionType.Absolute;
    n.insetLeft = px(rect.x);
    n.insetTop = px(rect.y);
    n.insetRight = auto();
    n.insetBottom = auto();
    n.width = px(rect.width);
    n.height = px(rect.height);
    world.insert(entity, UINode, n);
}

/**
 * Build a virtualized list (or grid) in one call.
 *
 * @example
 * const list = createListView<Player>({
 *   world, parent, viewportSize: { x: 320, y: 480 },
 *   data: arrayDataSource(players),
 *   layout: { itemHeight: 56 },
 *   item: {
 *     create: (w, parent) => spawnUIEntity({ world: w, parent, node: { height: px(56) } }),
 *     bind: (e, p) => setText(e, p.name),
 *   },
 * });
 * list.data.append([newPlayer]);   // auto-refreshes
 */
export function createListView<T>(opts: CreateListViewOptions<T>): ListViewHandle<T> {
    const { world, host, viewportSize } = opts;

    // 1) Viewport: sized box + Scissor mask + a hovered hit-target (for the wheel).
    const viewport = spawnUIEntity({
        world,
        parent: opts.parent,
        node: { width: opts.node?.fill ? auto() : px(viewportSize.x), height: opts.node?.fill ? auto() : px(viewportSize.y), ...opts.node },
        visual: opts.background ?? { color: { r: 0, g: 0, b: 0, a: 0 } },
    });
    world.insert(viewport, UIMask, { enabled: true, mode: MaskMode.Scissor });
    makeWidgetInteractable(world, viewport, { focusable: false });

    // 2) Content: an Absolute frame translated by the scroll offset; items live here.
    const content = spawnUIEntity({
        world,
        parent: viewport,
        node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0), width: px(viewportSize.x), height: px(viewportSize.y) },
    });

    // 3) Resolve data + layout.
    const data: DataSource<T> = isDataSource(opts.data) ? opts.data : new ArrayDataSource<T>(opts.data);
    const resolved = isLayoutProvider(opts.layout)
        ? { layout: opts.layout, axis: 'vertical' as const }
        : buildLayout(opts.layout, viewportSize);
    const { axis } = resolved;
    const crossLayout = !isLayoutProvider(opts.layout) && !('columns' in opts.layout)
        ? new CrossAxisLayout(resolved.layout, axis, axis === 'vertical' ? viewportSize.x : viewportSize.y)
        : null;
    const layout = crossLayout ?? resolved.layout;

    // 4) Item templates → ViewPool template shape ({ factory, binder }).
    const single = 'create' in opts.item && 'bind' in opts.item;
    const templateMap = (single ? { default: opts.item as ListItemTemplate<T> } : opts.item as Record<string, ListItemTemplate<T>>);
    const templates: Record<string, { factory: (w: World, p: Entity) => Entity; binder: (e: Entity, d: T, i: number) => void }> = {};
    for (const [type, tpl] of Object.entries(templateMap)) {
        templates[type] = { factory: tpl.create, binder: tpl.bind };
    }

    // The scroll model and virtualization driver share the resolved viewport.
    const scroll = new ScrollContainer({
        viewportSize,
        contentSize: layout.getContentSize(data.getCount()),
        direction: opts.direction ?? axis,
        wheelSpeed: opts.wheelSpeed,
        dragScroll: opts.dragScroll,
        decelerationRate: opts.decelerationRate,
    });
    const view = new LayoutBoundListView<T>({
        world,
        parent: content,
        dataSource: data,
        layout,
        viewportSize,
        templates,
        recycleBuffer: opts.recycleBuffer,
        placeItem: (w, e, rect) => placeByInset(w, e, rect),
        setVisible: (w, e, visible) => {
            // Recycled rows include text, nested controls and style prefabs.
            // Hide the subtree, rather than only its background quad.
            if (w.valid(e) && w.has(e, UINode)) {
                const node = w.get(e, UINode), display = visible ? UIDisplay.Flex : UIDisplay.None;
                if (node.display !== display) w.insert(e, UINode, { ...node, display });
            }
            setUIVisible(w, e, visible);
        },
        onItemBound: opts.onItemBound,
    }, viewport, scroll, crossLayout);
    host.registerListView(view as ListView<unknown>);

    // Scroll input translates the content and pushes the same offset into the driver.
    const offScroll = scroll.onScroll((offset) => {
        const n = world.get(content, UINode) as UINodeData;
        n.insetLeft = px(-offset.x);
        n.insetTop = px(-offset.y);
        world.insert(content, UINode, n);
        view.setScrollOffset(offset);
    });
    host.attachScrollContainer(viewport, scroll);

    // 7) Keep the scroll range in step with the data count.
    const offData = data.subscribe?.(() => {
        scroll.setContentSize(layout.getContentSize(data.getCount()));
    });

    let disposed = false;
    return {
        entity: viewport,
        content,
        data,
        scroll,
        view,
        refresh: () => view.refresh(),
        scrollToIndex: (index) => {
            const rect = layout.getItemRect(index);
            scroll.setOffset({ x: rect.x, y: rect.y });
        },
        mountedCount: () => view.getMountedCount(),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            offScroll();
            offData?.();
            host.unregisterListView(view as ListView<unknown>);
            host.detachScrollContainer(viewport);
            scroll.dispose();
            view.dispose();
            if (world.valid(viewport)) world.despawn(viewport);
        },
    };
}
