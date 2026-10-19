// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { DataSource, DataSourceChange, Unsubscribe } from './data-source';

/** Stable application identity, independent of ECS entity IDs. @beta */
export type TreeItemId = string | number;

/** Adapt any project model to a tree; mutations and persistence stay with the host. @beta */
export interface TreeDataSource<T> {
    getRoots(): readonly T[];
    getChildren(item: T): readonly T[];
    getId(item: T): TreeItemId;
    getLabel(item: T): string;
    isSelectable?(item: T): boolean;
    subscribe?(listener: () => void): Unsubscribe;
}

/** A visible row projected into the existing virtualized ListView. @beta */
export interface TreeRow<T> {
    readonly id: TreeItemId;
    readonly item: T;
    readonly parentId: TreeItemId | null;
    readonly depth: number;
    readonly hasChildren: boolean;
    readonly expanded: boolean;
    readonly selectable: boolean;
    readonly selected: boolean;
}

/** A drop is a request, never an implicit mutation of the host model. @beta */
export interface TreeDropRequest<T> {
    readonly source: TreeRow<T>;
    readonly target: TreeRow<T>;
    readonly position: 'before' | 'inside' | 'after';
}

/** Iterative traversal handles deep trees; stable IDs retain state through reorder. @beta */
export class TreeViewModel<T> implements DataSource<TreeRow<T>> {
    private rows_: TreeRow<T>[] = [];
    private nodes_ = new Map<TreeItemId, TreeRow<T>>();
    private children_ = new Map<TreeItemId | null, TreeItemId[]>();
    private expanded_ = new Set<TreeItemId>();
    private selected_ = new Set<TreeItemId>();
    private readonly listeners_ = new Set<(change: DataSourceChange) => void>();
    private readonly off_: Unsubscribe | undefined;
    private disposed_ = false;

    constructor(readonly source: TreeDataSource<T>, expanded: readonly TreeItemId[] = []) {
        this.expanded_ = new Set(expanded);
        this.refresh();
        this.off_ = source.subscribe?.(() => this.refresh());
    }

    getCount(): number { return this.rows_.length; }
    getItem(index: number): TreeRow<T> {
        if (!Number.isInteger(index) || index < 0 || index >= this.rows_.length) throw new RangeError('Tree row index out of range');
        return this.rows_[index];
    }
    getItemId(_index: number, row: TreeRow<T>): TreeItemId { return row.id; }
    getNode(id: TreeItemId): TreeRow<T> | undefined {
        const node = this.nodes_.get(id);
        return node ? { ...node, expanded: this.expanded_.has(id), selected: this.selected_.has(id) } : undefined;
    }
    indexOf(id: TreeItemId): number { return this.rows_.findIndex(row => row.id === id); }
    get expandedIds(): readonly TreeItemId[] { return [...this.expanded_]; }
    get selectedIds(): readonly TreeItemId[] { return [...this.selected_]; }
    subscribe(listener: (change: DataSourceChange) => void): Unsubscribe {
        this.listeners_.add(listener); return () => { this.listeners_.delete(listener); };
    }

    /** Build transactionally: invalid IDs/cycles leave the previous projection intact. */
    refresh(): void {
        if (this.disposed_) return;
        const nodes = new Map<TreeItemId, TreeRow<T>>(), children = new Map<TreeItemId | null, TreeItemId[]>();
        const roots = this.source.getRoots();
        const stack: Array<{ item: T; parentId: TreeItemId | null; depth: number }> = [];
        for (let i = roots.length - 1; i >= 0; i--) stack.push({ item: roots[i], parentId: null, depth: 0 });
        while (stack.length) {
            const { item, parentId, depth } = stack.pop()!;
            const id = this.source.getId(item);
            if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'number' && !Number.isFinite(id))) {
                throw new Error('Tree item ID must be a finite number or a string');
            }
            if (nodes.has(id)) throw new Error(`Duplicate or cyclic tree item ID: ${id}`);
            const nested = this.source.getChildren(item);
            nodes.set(id, { id, item, parentId, depth, hasChildren: nested.length > 0,
                expanded: this.expanded_.has(id), selectable: this.source.isSelectable?.(item) !== false, selected: this.selected_.has(id) });
            let siblings = children.get(parentId);
            if (!siblings) children.set(parentId, siblings = []);
            siblings.push(id);
            for (let i = nested.length - 1; i >= 0; i--) stack.push({ item: nested[i], parentId: id, depth: depth + 1 });
        }
        this.nodes_ = nodes; this.children_ = children;
        this.expanded_ = new Set([...this.expanded_].filter(id => nodes.get(id)?.hasChildren));
        this.selected_ = new Set([...this.selected_].filter(id => nodes.get(id)?.selectable));
        this.project_();
    }

    setExpanded(ids: readonly TreeItemId[]): void {
        const next = new Set(ids.filter(id => this.nodes_.get(id)?.hasChildren));
        if (next.size === this.expanded_.size && [...next].every(id => this.expanded_.has(id))) return;
        this.expanded_ = next; this.project_();
    }
    toggle(id: TreeItemId): void {
        if (!this.nodes_.get(id)?.hasChildren) return;
        if (this.expanded_.has(id)) this.expanded_.delete(id); else this.expanded_.add(id);
        this.project_();
    }
    select(ids: readonly TreeItemId[], mode: number = 1): void {
        const eligible = ids.filter(id => this.nodes_.get(id)?.selectable);
        const next = new Set(mode === 0 ? [] : mode === 2 ? eligible : eligible.slice(-1));
        if (next.size === this.selected_.size && [...next].every(id => this.selected_.has(id))) return;
        this.selected_ = next;
        this.project_();
    }
    isSelected(id: TreeItemId): boolean { return this.selected_.has(id); }
    /** Reveal ancestors without forcing any project-specific selection policy. */
    reveal(id: TreeItemId): void {
        let node = this.nodes_.get(id);
        while (node?.parentId != null) { this.expanded_.add(node.parentId); node = this.nodes_.get(node.parentId); }
        this.project_();
    }
    canDrop(request: TreeDropRequest<T>): boolean {
        if (!['before', 'inside', 'after'].includes(request.position)) return false;
        const source = this.nodes_.get(request.source.id), target = this.nodes_.get(request.target.id);
        if (!source || !target || source.id === target.id) return false;
        let ancestor: TreeRow<T> | undefined = target;
        while (ancestor) { if (ancestor.id === source.id) return false; ancestor = ancestor.parentId == null ? undefined : this.nodes_.get(ancestor.parentId); }
        return true;
    }
    dispose(): void {
        if (this.disposed_) return; this.disposed_ = true; this.off_?.(); this.listeners_.clear();
        this.rows_ = []; this.nodes_.clear(); this.children_.clear();
    }
    private project_(): void {
        const rows: TreeRow<T>[] = [], stack = [...(this.children_.get(null) ?? [])].reverse();
        while (stack.length) {
            const id = stack.pop()!, node = this.nodes_.get(id)!;
            const row = { ...node, expanded: this.expanded_.has(id), selected: this.selected_.has(id) }; this.nodes_.set(id, row); rows.push(row);
            if (row.expanded) { const children = this.children_.get(id) ?? []; for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]); }
        }
        this.rows_ = rows; this.emit_();
    }
    private emit_(): void { for (const listener of [...this.listeners_]) listener({ type: 'reset' }); }
}
