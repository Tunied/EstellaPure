// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { VideoAPI } from '../src/video/VideoAPI';
import { NullVideoBackend } from '../src/video/NullVideoBackend';
const apps:App[]=[],videos:VideoAPI[]=[];
afterEach(()=>{for(const video of videos.splice(0))video.dispose();for(const app of apps.splice(0))app.quit();});
function fixture() {
    const app=App.new();apps.push(app);
    const backend=new NullVideoBackend(),create=vi.spyOn(backend,'createStream');
    const video=new VideoAPI(backend,app.onExecutionChange.bind(app));videos.push(video);
    return {app,video,create};
}
it('pauses playing streams, blocks play during holds and restores the player preference',()=>{
    const {app,video}=fixture(),playing=video.play('playing.mp4'),paused=video.play('paused.mp4');paused.pause();
    const first=app.holdExecution(),second=app.holdExecution();expect(playing.isPlaying).toBe(false);
    playing.play();expect(playing.isPlaying).toBe(false);first();expect(playing.isPlaying).toBe(false);
    second();expect(playing.isPlaying).toBe(true);expect(paused.isPlaying).toBe(false);
    const next=app.holdExecution();playing.pause();next();expect(playing.isPlaying).toBe(false);
});
it('creates non-autoplay streams during a hold and does not revive stopped streams',()=>{
    const {app,video,create}=fixture(),release=app.holdExecution();
    const pending=video.play('pending.mp4'),stopped=video.play('stopped.mp4');
    expect(create.mock.calls[0][1].autoplay).toBe(false);expect(pending.isPlaying).toBe(false);
    stopped.stop();release();expect(pending.isPlaying).toBe(true);expect(stopped.isPlaying).toBe(false);
});
it('does not restart completed streams or retain retired handles after disposal',()=>{
    const {app,video,create}=fixture(),ended=video.play('ended.mp4');
    const raw=create.mock.results[0].value;Object.defineProperty(raw,'isReady',{value:true});raw.pause();
    const release=app.holdExecution();release();expect(ended.isPlaying).toBe(false);
    const playing=video.play('playing.mp4');video.dispose();
    const late=app.holdExecution();late();expect(playing.isPlaying).toBe(false);
});
