// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { initializeYouTube, type YouTubeSdk } from '../src/runtime/youtubeProfile';
import { parseManifest } from '../src/project/format';
import { projectExportOptions } from '../src/export/projectExportOptions';
function fixture() {
    const pause=new Set<()=>void>(),resume=new Set<()=>void>(),audio=new Set<(enabled:boolean)=>void>();
    const sdk:YouTubeSdk={IN_PLAYABLES_ENV:true,
        game:{firstFrameReady:vi.fn(),gameReady:vi.fn(),loadData:vi.fn(async()=>''),saveData:vi.fn(async(_data:string)=>{})},
        system:{isAudioEnabled:()=>false,onPause:cb=>{pause.add(cb);return()=>{pause.delete(cb);};},onResume:cb=>{resume.add(cb);return()=>{resume.delete(cb);};},
            onAudioEnabledChange:cb=>{audio.add(cb);return()=>{audio.delete(cb);};}},
        ads:{requestInterstitialAd:vi.fn(async()=>{}),requestRewardedAd:vi.fn(async(_id:string)=>true)},
        engagement:{sendScore:vi.fn(async(_score:{value:number})=>{})},};
    return{sdk,pause:()=>{for(const cb of pause)cb();},resume:()=>{for(const cb of resume)cb();},audio:(value:boolean)=>{for(const cb of audio)cb(value);},listeners:()=>pause.size+resume.size+audio.size};
}
it('round-trips the named YouTube channel profile',async()=>{
    const manifest=parseManifest({name:'Game',packaging:{profiles:{youtube:{platform:'web',platforms:{web:{channel:'youtube'}}}}}});
    expect((await projectExportOptions(process.cwd(),manifest,'web','youtube')).webChannel).toBe('youtube');
});
it('loads before exposing storage, flushes through SDK and reports ordered readiness once',async()=>{
    const {sdk}=fixture(),session=initializeYouTube(sdk,vi.fn());
    expect(()=>session.storage.setStorageItem('key','wrong')).toThrow('load must succeed');
    await expect(session.gameReady()).rejects.toThrow('firstFrameReady');session.firstFrameReady();session.firstFrameReady();
    await session.load();session.storage.setStorageItem('key','value');await session.storage.flushStorage!();await session.gameReady();await session.gameReady();
    expect(sdk.game.firstFrameReady).toHaveBeenCalledOnce();expect(sdk.game.gameReady).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(sdk.game.saveData).mock.calls[0][0]).items).toEqual({key:'value'});session.dispose();
});
it('disables no-op local and missing SDK services instead of acknowledging fake saves',async()=>{
    for(const missing of [false,true]) {
        const {sdk}=fixture();sdk.IN_PLAYABLES_ENV=false;const session=initializeYouTube(missing?undefined:sdk,vi.fn());
        await session.load();expect(session.provider).toBeNull();expect(session.submitScore).toBeUndefined();
        expect(()=>session.storage.setStorageItem('key','bad')).toThrow('unavailable');expect(sdk.game.loadData).not.toHaveBeenCalled();expect(sdk.game.saveData).not.toHaveBeenCalled();session.dispose();
    }
});
it('preserves failed/corrupt cloud loads without writes',async()=>{
    for(const raw of ['bad','{"version":2,"items":{}}']) {
        const{sdk}=fixture();vi.mocked(sdk.game.loadData).mockResolvedValue(raw);const session=initializeYouTube(sdk,vi.fn());await session.load();
        expect(()=>session.storage.setStorageItem('key','new')).toThrow('unavailable');expect(sdk.game.saveData).not.toHaveBeenCalled();session.dispose();
    }
});
it('honors pause independently of audio mute and releases waiters only on resume',async()=>{
    const f=fixture(),session=initializeYouTube(f.sdk,vi.fn()),mutes:boolean[]=[],pauses:boolean[]=[];
    session.onAudioMute(value=>mutes.push(value));session.onPause(value=>pauses.push(value));f.audio(true);f.pause();f.pause();
    let active=false;const pending=session.waitActive().then(()=>{active=true;});await Promise.resolve();expect(active).toBe(false);
    f.audio(true);expect(mutes.at(-1)).toBe(true);f.resume();await pending;expect(mutes.at(-1)).toBe(false);expect(pauses).toEqual([false,true,false]);
    session.dispose();expect(f.listeners()).toBe(0);
});
it('rejects pending work after disposal and ignores late SDK events',async()=>{
    const f=fixture(),session=initializeYouTube(f.sdk,vi.fn());f.pause();const pending=expect(session.waitActive()).rejects.toThrow('disposed');
    session.dispose();await pending;f.resume();await expect(session.waitActive()).rejects.toThrow('disposed');
});
it('grants only true rewarded results and preserves reward IDs, ad failures and score requirements',async()=>{
    const{sdk}=fixture(),session=initializeYouTube(sdk,vi.fn()),reward=session.provider!.createRewardedAd!('training-credit');
    expect(await reward.show()).toEqual({completed:true});expect(sdk.ads.requestRewardedAd).toHaveBeenCalledWith('training-credit');
    vi.mocked(sdk.ads.requestRewardedAd).mockResolvedValueOnce(false);expect(await reward.show()).toEqual({completed:false});
    vi.mocked(sdk.ads.requestRewardedAd).mockRejectedValueOnce(new Error('no fill'));await expect(reward.show()).rejects.toThrow('no fill');
    await session.submitScore!(3);expect(sdk.engagement.sendScore).toHaveBeenCalledWith({value:3});
    await expect(session.submitScore!(1.5)).rejects.toThrow('safe integers');reward.destroy?.();await expect(reward.show()).rejects.toThrow('destroyed');session.dispose();
});
it('keeps oversized pause flushes dirty without sending a truncated or oversized save',async()=>{
    const f=fixture(),warn=vi.fn(),session=initializeYouTube(f.sdk,warn);await session.load();session.storage.setStorageItem('large','x'.repeat(70000));f.pause();
    await expect(session.storage.flushStorage!()).rejects.toThrow('64 KiB');expect(f.sdk.game.saveData).not.toHaveBeenCalled();
    f.resume();await session.storage.flushStorage!();expect(f.sdk.game.saveData).toHaveBeenCalledOnce();session.dispose();
});
it('does not activate a cloud load after its timeout or start an abandoned paused ad',async()=>{
    const f=fixture();let finish!:(data:string)=>void;
    vi.mocked(f.sdk.game.loadData).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const session=initializeYouTube(f.sdk,vi.fn(),5);await session.load();finish('');await Promise.resolve();
    expect(()=>session.storage.setStorageItem('key','bad')).toThrow('unavailable');
    f.pause();const unit=session.provider!.createRewardedAd!('credit'),pending=expect(unit.show()).rejects.toThrow('destroyed');
    unit.destroy?.();f.resume();await pending;expect(f.sdk.ads.requestRewardedAd).not.toHaveBeenCalled();session.dispose();
});
