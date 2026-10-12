import {describe,it,expect,vi} from 'vitest';
import {App,type Plugin} from '../src/app/app';
import {defineSystem,defineSystemSet,Schedule} from '../src/ecs/system';

describe('failed plugin build ownership',()=>{
    it('cleans partial resources once while retaining the original failure',()=>{
        const app=App.new(),failure=new Error('build failed'),release=vi.fn();
        const plugin={build(){throw failure;},cleanup:release};
        expect(()=>app.addPlugin(plugin)).toThrow(failure);
        expect(release).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledWith(app);
        app.quit({keepRenderer:true});expect(release).toHaveBeenCalledTimes(1);
    });
    it('unwinds newly installed children before their failed parent',()=>{
        const app=App.new(),parentCleanup=vi.fn(),childCleanup=vi.fn();
        const child:Plugin={name:'child',build(){},cleanup:childCleanup};
        const parent:Plugin={name:'parent',build(a){a.addPlugin(child);throw Error('parent failed');},cleanup:parentCleanup};
        expect(()=>app.addPlugin(parent)).toThrow('parent failed');
        expect(childCleanup).toHaveBeenCalledTimes(1);
        expect(childCleanup.mock.invocationCallOrder[0]).toBeLessThan(parentCleanup.mock.invocationCallOrder[0]);
        app.quit({keepRenderer:true});
        expect(parentCleanup).toHaveBeenCalledTimes(1);expect(childCleanup).toHaveBeenCalledTimes(1);
    });
    it('withdraws direct and grouped systems across schedules before the next tick',async()=>{
        const app=App.new(),failed=vi.fn(),live=vi.fn();
        app.addSystem(defineSystem([],live));await app.tick(1/60);live.mockClear();
        expect(()=>app.addPlugin({build(a){
            a.addSystem(defineSystem([],failed));
            a.addSystemSetToSchedule(Schedule.Last,defineSystemSet('failed-set',{systems:[defineSystem([],failed)]}));
            throw Error('failed');
        }})).toThrow('failed');
        await app.tick(1/60);expect(failed).not.toHaveBeenCalled();expect(live).toHaveBeenCalledTimes(1);
        app.quit({keepRenderer:true});
    });
    it('restores an existing template registration so removeSystem still removes it',async()=>{
        const app=App.new(),run=vi.fn(),template=defineSystem([],run);app.addSystem(template);
        expect(()=>app.addPlugin({build(a){a.addSystem(template);a.addSystem(template);throw Error('failed');}})).toThrow('failed');
        expect(app.removeSystem(template._id)).toBe(true);await app.tick(1/60);expect(run).not.toHaveBeenCalled();app.quit({keepRenderer:true});
    });
    it('unwinds nested systems that share the parent template',async()=>{
        const app=App.new(),run=vi.fn(),system=defineSystem([],run),child={build(a:App){a.addSystem(system);}};
        expect(()=>app.addPlugin({build(a){a.addSystem(system);a.addPlugin(child);a.addSystem(system);throw Error('failed');}})).toThrow('failed');
        await app.tick(1/60);expect(run).not.toHaveBeenCalled();
        expect(app.removeSystem(system._id)).toBe(false);app.quit({keepRenderer:true});
    });
    it('continues registration rollback when cleanup throws',async()=>{
        const app=App.new(),failure=new Error('original'),run=vi.fn(),warn=vi.spyOn(console,'error').mockImplementation(()=>{});
        try {expect(()=>app.addPlugin({build(a){a.addSystem(defineSystem([],run));throw failure;},cleanup(){throw Error('cleanup');}})).toThrow(failure);
            await app.tick(1/60);expect(run).not.toHaveBeenCalled();}
        finally{warn.mockRestore();app.quit({keepRenderer:true});}
    });
    it('can retry the same instance without stale systems or double cleanup',async()=>{
        const app=App.new(),run=vi.fn(),cleanup=vi.fn();let first=true;
        const plugin={build(a:App){a.addSystem(defineSystem([],run));if(first){first=false;throw Error('first');}},cleanup};
        expect(()=>app.addPlugin(plugin)).toThrow('first');app.addPlugin(plugin);await app.tick(1/60);
        expect(run).toHaveBeenCalledTimes(1);app.quit({keepRenderer:true});expect(cleanup).toHaveBeenCalledTimes(2);
    });
    it('does not clean a failed parent twice when its cleanup calls quit',()=>{
        const app=App.new(),cleanup=vi.fn((a?:App)=>a!.quit({keepRenderer:true}));
        expect(()=>app.addPlugin({build(){throw Error('failed');},cleanup})).toThrow('failed');
        expect(cleanup).toHaveBeenCalledTimes(1);app.quit({keepRenderer:true});expect(cleanup).toHaveBeenCalledTimes(1);
    });
    it('does not double-clean when build quits before throwing',()=>{
        const app=App.new(),cleanup=vi.fn();
        expect(()=>app.addPlugin({build(a){a.quit({keepRenderer:true});throw Error('failed');},cleanup})).toThrow('failed');
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
    it('rejects new plugin installation during shutdown',()=>{
        const app=App.new(),build=vi.fn();
        app.addPlugin({build(){},cleanup(a){expect(()=>a!.addPlugin({build})).toThrow(/while App.quit/);}});
        app.quit({keepRenderer:true});expect(build).not.toHaveBeenCalled();
    });
    it('preserves plugins installed before the failed enclosing build',async()=>{
        const app=App.new(),run=vi.fn(),cleanup=vi.fn(),child={build(a:App){a.addSystem(defineSystem([],run));},cleanup};
        app.addPlugin(child);
        expect(()=>app.addPlugin({build(a){a.addPlugin(child);throw Error('failed');}})).toThrow('failed');
        expect(cleanup).not.toHaveBeenCalled();await app.tick(1/60);expect(run).toHaveBeenCalledTimes(1);
        app.quit({keepRenderer:true});expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
