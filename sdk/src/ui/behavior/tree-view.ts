// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';

/** Optional authored adapter; runtime TreeDataSource can wrap any project model. @beta */
export interface TreeViewNode {
    id: string;
    label: string;
    children?: TreeViewNode[];
    selectable?: boolean;
}

/** Serializable configuration; live adapters and subscriptions remain per world. @beta */
export interface UITreeViewData {
    nodes: TreeViewNode[];
    expandedIds: Array<string | number>;
    selectedIds: Array<string | number>;
    selectionMode: number;
    rowHeight: number;
    indent: number;
    dragEnabled: boolean;
    rowPrefab: string;
    emptyPrefab: string;
}

/** One virtualized collection with stable project IDs, not a second UI tree. @beta */
export const UITreeView = defineComponent<UITreeViewData>('UITreeView', {
    nodes: [], expandedIds: [], selectedIds: [], selectionMode: 1,
    rowHeight: 32, indent: 20, dragEnabled: false, rowPrefab: '', emptyPrefab: '',
}, {
    fields: {
        selectionMode: { enum: [{ label: 'None', value: 0 }, { label: 'Single', value: 1 }, { label: 'Multiple', value: 2 }] },
        rowHeight: { min: 12, step: 1, unit: 'px' }, indent: { min: 0, step: 1, unit: 'px' },
    },
    assetFields: [{ field: 'rowPrefab', type: 'prefab' }, { field: 'emptyPrefab', type: 'prefab' }],
});
