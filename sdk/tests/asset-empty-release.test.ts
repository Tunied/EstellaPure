// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { HttpBackend } from '../src/asset/Backend';
import { AppContext, getDefaultContext, setDefaultContext } from '../src/ecs/context';
import type { ESEngineModule } from '../src/wasm';

it('releases an unused loader before a native resource manager exists, repeatedly', () => {
    const previous = getDefaultContext(); setDefaultContext(new AppContext());
    try {
        const assets = Assets.create({ backend: new HttpBackend({ baseUrl: '' }), module: {} as ESEngineModule });
        expect(() => assets.releaseAll()).not.toThrow();
        expect(() => assets.releaseAll()).not.toThrow();
        expect(assets.sizes().refRows).toBe(0);
    } finally { setDefaultContext(previous); }
});
