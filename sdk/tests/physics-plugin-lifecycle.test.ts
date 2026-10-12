// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
const apps: App[] = [];
function module() {
    return Object.fromEntries([
        '_physics_init', '_physics_shutdown', '_physics_setWorldConfig', '_physics_step',
        '_physics_capturePoses', '_physics_getInterpolatedCount', '_physics_getInterpolatedTransforms',
        '_physics_collectEvents', '_physics_getDynamicBodyCount', '_physics_getDynamicBodyTransforms',
        '_physics_setBodyTransform',
        '_physics_getCollisionEnterCount', '_physics_getCollisionExitCount', '_physics_getHitEventCount',
        '_physics_getSensorEnterCount', '_physics_getSensorExitCount',
    ].map(name => [name, vi.fn(() => 0)])) as unknown as PhysicsWasmModule;
}
function build(plugin: Physics2DPlugin) { const app = App.new(); apps.push(app); app.addPlugin(plugin); return app; }
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });
it('attributes asynchronously installed physics systems to the physics cost domain', async () => {
    const app = build(new Physics2DPlugin('', {}, async () => module())).enableStats();
    await app.getResource(Physics2DRuntime).initPromise;
    await app.stepFrames(2, 1 / 30);
    const costs = app.getFrameCosts()!.systems;
    for (const name of ['PhysicsStepSystem', 'PhysicsInterpolateSystem', 'PhysicsEventBridgeSystem', 'CharacterController2DSystem']) {
        expect(costs.find(system => system.name === name)?.domain).toBe('physics');
    }
});
it('quitting before the module arrives prevents late initialization and system installation', async () => {
    const loaded = module(); let resolve!: (m: PhysicsWasmModule) => void;
    const plugin = new Physics2DPlugin('', {}, () => new Promise(done => { resolve = done; }));
    const app = build(plugin), runtime = app.getResource(Physics2DRuntime), install = vi.spyOn(app, 'addSystem');
    app.quit(); resolve(loaded); await runtime.initPromise;
    expect(loaded._physics_init).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
    expect(runtime.module).toBeNull();
});
it('quitting an older app shuts down only its own Box2D module', async () => {
    const firstModule = module(), secondModule = module();
    const factory = vi.fn().mockResolvedValueOnce(firstModule).mockResolvedValueOnce(secondModule);
    const plugin = new Physics2DPlugin('', {}, factory), first = build(plugin), second = build(plugin);
    await Promise.all([first.getResource(Physics2DRuntime).initPromise, second.getResource(Physics2DRuntime).initPromise]);
    first.quit(); expect(firstModule._physics_shutdown).toHaveBeenCalledOnce();
    expect(secondModule._physics_shutdown).not.toHaveBeenCalled();
    second.quit(); expect(secondModule._physics_shutdown).toHaveBeenCalledOnce();
});
it('late completion from a cancelled older app cannot replace the newer app module', async () => {
    const oldModule = module(), currentModule = module(); let resolve!: (m: PhysicsWasmModule) => void;
    const factory = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(currentModule);
    const plugin = new Physics2DPlugin('', {}, factory), first = build(plugin), oldRuntime = first.getResource(Physics2DRuntime);
    first.quit(); const second = build(plugin); await second.getResource(Physics2DRuntime).initPromise;
    resolve(oldModule); await oldRuntime.initPromise; second.quit();
    expect(oldModule._physics_init).not.toHaveBeenCalled(); expect(currentModule._physics_shutdown).toHaveBeenCalledOnce();
});
it('parameterless cleanup shuts down the latest module once without losing the older owner', async () => {
    const firstModule = module(), secondModule = module();
    const factory = vi.fn().mockResolvedValueOnce(firstModule).mockResolvedValueOnce(secondModule);
    const plugin = new Physics2DPlugin('', {}, factory), first = build(plugin), second = build(plugin);
    await Promise.all([first.getResource(Physics2DRuntime).initPromise, second.getResource(Physics2DRuntime).initPromise]);
    plugin.cleanup(); plugin.cleanup(); expect(secondModule._physics_shutdown).toHaveBeenCalledOnce();
    expect(second.getResource(Physics2DRuntime).module).toBeNull(); expect(firstModule._physics_shutdown).not.toHaveBeenCalled();
    first.quit(); second.quit(); expect(firstModule._physics_shutdown).toHaveBeenCalledOnce();
    expect(secondModule._physics_shutdown).toHaveBeenCalledOnce();
});
it('a cancelled load failure does not mark the stopped app as failed', async () => {
    let reject!: (error: Error) => void;
    const plugin = new Physics2DPlugin('', {}, () => new Promise((_, fail) => { reject = fail; }));
    const app = build(plugin), runtime = app.getResource(Physics2DRuntime), failed = vi.spyOn(app.subsystems, 'markError');
    app.quit(); reject(Error('late load failure')); await runtime.initPromise?.catch(() => {});
    expect(failed).not.toHaveBeenCalled(); expect(runtime.module).toBeNull();
});
