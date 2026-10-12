// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import { disposeAll } from '../util/disposeAll';

const releaseCallback = (callback: ReleaseCallback): void => callback();

export type ReleaseCallback = () => void;

export class SceneHandle {
    readonly entities: Entity[];
    private releaseCallbacks_: ReleaseCallback[];
    private released_ = false;

    constructor(entities: Entity[], releaseCallbacks: ReleaseCallback[]) {
        this.entities = entities;
        this.releaseCallbacks_ = releaseCallbacks;
    }

    get isReleased(): boolean {
        return this.released_;
    }

    release(): void {
        if (this.released_) return;
        this.released_ = true;
        const callbacks = this.releaseCallbacks_;
        this.releaseCallbacks_ = [];
        disposeAll(callbacks, releaseCallback);
    }
}
