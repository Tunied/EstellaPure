// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Explicit SDK mocks for the exported YouTube profile; official certification is separate. */
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {chromium} from 'playwright';
const args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1];if(!args.includes('--dir'))throw Error('Expected --dir <YouTube export>');
const root=fs.realpathSync(flag('--dir')),out=path.resolve(args.includes('--out')?flag('--out'):'output/youtube-training-check');fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=(under='')=>fs.readdirSync(path.join(root,under),{withFileTypes:true}).flatMap(entry=>{const file=under?`${under}/${entry.name}`:entry.name;
    if(entry.isDirectory())return files(file);if(!entry.isFile())throw Error('Unsupported entry');return[file];});
const identities=Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))]));
const report={headless:true,mode:'local-mock',status:'failed',identities,verifierSha256:sha(new URL(import.meta.url)),cases:[]};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',file=fs.realpathSync(path.resolve(root,name));
    if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('Outside export');res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio']});
try {
    for(const mode of ['normal','local-noop','sdk-missing','load-failed','paused-boot']) {
        const context=await browser.newContext({viewport:{width:800,height:450}}),page=await context.newPage();
        const observation={mode,status:'failed',errors:[],unexpectedRequests:[]};report.cases.push(observation);
        page.on('pageerror',error=>observation.errors.push(String(error)));
        await page.addInitScript(()=>{window.__audioContexts=[];const Original=window.AudioContext;if(Original)window.AudioContext=class extends Original{constructor(...args){super(...args);__audioContexts.push(this);}};});
        await context.route('**/*',route=>{
            const url=route.request().url();if(url.startsWith(origin+'/'))return route.continue();
            if(url==='https://www.youtube.com/game_api/v1')return route.fulfill({contentType:'text/javascript',body:mode==='sdk-missing'?'':`
                window.__events=[];window.__pauseListeners=new Set();window.__resumeListeners=new Set();window.__muteListeners=new Set();window.__scores=[];
                ${mode==='normal'?`if(localStorage.getItem('__youtube_mock_data')===null)localStorage.setItem('__youtube_mock_data',JSON.stringify({version:1,items:{'esengine:mobile-controls.training-best-score':'5'}}));`:''}
                const record=event=>__events.push(event);const sdk={IN_PLAYABLES_ENV:${mode!=='local-noop'},
                    game:{firstFrameReady(){record('first');window.__firstLoading=!!document.getElementById('es-splash')},
                        gameReady(){record('ready');window.__readyLoading=!!document.getElementById('es-splash')},
                        loadData(){record('load');return ${mode==='load-failed'?'Promise.reject(new Error("offline"))':'Promise.resolve(localStorage.getItem("__youtube_mock_data")??"")'}},
                        saveData(data){record('save');localStorage.setItem('__youtube_mock_data',data);return Promise.resolve()}},
                    system:{isAudioEnabled(){return false},onAudioEnabledChange(cb){__muteListeners.add(cb);return()=>__muteListeners.delete(cb)},
                        onPause(cb){__pauseListeners.add(cb);${mode==='paused-boot'?'cb();':''}return()=>__pauseListeners.delete(cb)},onResume(cb){__resumeListeners.add(cb);return()=>__resumeListeners.delete(cb)}},
                    ads:{requestRewardedAd(id){record('reward');window.__rewardId=id;return new Promise((resolve,reject)=>{window.__rewardResolve=resolve;window.__rewardReject=reject;})},
                        requestInterstitialAd(){record('midgame');return Promise.resolve()}},engagement:{sendScore(score){record('score');__scores.push(score);return Promise.resolve()}}};
                window.ytgame=sdk;window.__pause=()=>{for(const cb of __pauseListeners)cb()};window.__resume=()=>{for(const cb of __resumeListeners)cb()};
                window.__audio=value=>{for(const cb of __muteListeners)cb(value)};
            `});
            observation.unexpectedRequests.push(url);return route.abort();
        });
        try {
            await page.goto(origin+'/?headless');
            if(mode==='paused-boot') {
                await page.waitForFunction(()=>window.__resumeListeners?.size>0);await page.waitForTimeout(150);
                assert.deepEqual(await page.evaluate(()=>__events),[]);assert.equal(await page.evaluate(()=>!!window.__estellaCooked),false);await page.evaluate(()=>__resume());
            }
            await page.waitForFunction(()=>window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text,{}, {timeout:30000});
            await page.waitForFunction(()=>!document.getElementById('es-splash'));
            if(mode!=='sdk-missing') {await page.waitForFunction(()=>__events.includes('ready'));assert(await page.evaluate(()=>__firstLoading));assert.equal(await page.evaluate(()=>__readyLoading),false);}
            const phase=value=>page.waitForFunction(v=>window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text?.startsWith(v),value.toUpperCase());
            const click=async name=>{const box=await page.evaluate(n=>__estellaCooked.probe([n]).at[n],name);assert(box);await page.mouse.click(400+box.x,225-box.y);};
            const hosted=mode!=='local-noop'&&mode!=='sdk-missing';
            await click('TrainingStart');await phase('playing');
            if(hosted) {
                await page.waitForFunction(()=>__audioContexts.length>0&&__audioContexts.every(c=>c.state==='suspended'));await page.evaluate(()=>__audio(true));
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                await page.evaluate(()=>__pause());await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='suspended'));
                const held=await page.evaluate(()=>__estellaCooked.probe(['Player']).at.Player);
                await page.keyboard.press('KeyD');await click('TrainingPause');await page.waitForTimeout(150);await phase('playing');
                assert.deepEqual(await page.evaluate(()=>__estellaCooked.probe(['Player']).at.Player),held);
                await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));});
                assert(await page.evaluate(()=>__audioContexts.every(c=>c.state==='suspended')));await page.evaluate(()=>__resume());
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                await click('TrainingReward');await phase('ad');await page.evaluate(()=>__rewardResolve(true));await phase('playing');
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                if(mode!=='load-failed') {
                    await page.waitForFunction(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.includes('Save acknowledged'));
                }
                const at=await page.evaluate(()=>__estellaCooked.probe(['Player','Target']).at);
                if(Math.abs(at.Target.y-at.Player.y)>15) {
                    const vertical=at.Target.y>at.Player.y?'KeyW':'KeyS';await page.keyboard.down(vertical);
                    await page.waitForFunction(()=>{const p=__estellaCooked.probe(['Player','Target']).at;return Math.abs(p.Player.y-p.Target.y)<15;});await page.keyboard.up(vertical);
                }
                const current=await page.evaluate(()=>__estellaCooked.probe(['Player','Target']).at),horizontal=current.Target.x>current.Player.x?'KeyD':'KeyA';
                await page.keyboard.down(horizontal);await page.waitForFunction(()=>{const p=__estellaCooked.probe(['Player','Target']).at;return Math.hypot(p.Player.x-p.Target.x,p.Player.y-p.Target.y)<60;});await page.keyboard.up(horizontal);
                for(let hit=0;hit<3;hit++){await page.keyboard.press('Space',{delay:80});await page.waitForTimeout(80);}
                await phase('finished');await click('TrainingScore');
                if(mode!=='load-failed') {
                    await page.waitForFunction(()=>__scores.length===1);
                    observation.score=await page.evaluate(()=>({sent:__scores[0].value,saved:Number(JSON.parse(localStorage.getItem('__youtube_mock_data')).items['esengine:mobile-controls.training-best-score'])}));
                    assert.deepEqual(observation.score,{sent:mode==='normal'?5:3,saved:mode==='normal'?5:3});
                    await page.reload();
                    if(mode==='paused-boot'){await page.waitForFunction(()=>window.__resumeListeners?.size>0);await page.evaluate(()=>__resume());}
                    await phase('menu');await page.waitForFunction(()=>!document.getElementById('es-splash'));
                    assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                } else {
                    await page.waitForFunction(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.includes('Score submission failed'));
                    assert.equal(await page.evaluate(()=>__scores.length),0);assert.equal(await page.evaluate(()=>localStorage.getItem('__youtube_mock_data')),null);
                }
            } else {
                assert.equal(await page.evaluate(async()=>(await import('esengine')).Scores.available),false);
                observation.storage=await page.evaluate(async()=>{try{(await import('esengine')).Storage.setString('test','bad');return'bad';}catch(error){return String(error);}});
                assert.match(observation.storage,/unavailable/);assert.equal(await page.evaluate(()=>localStorage.getItem('esengine:test')),null);
            }
            const file=mode+'.png';await page.screenshot({path:path.join(out,file)});observation.screenshot={file,sha256:sha(path.join(out,file))};
            assert.deepEqual(observation.errors,[]);assert.deepEqual(observation.unexpectedRequests,[]);observation.events=await page.evaluate(()=>window.__events??[]);observation.status='passed';
        } catch(error){observation.failure=String(error);throw error;}finally{await context.close();}
    }
    assert.deepEqual(Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))])),identities);report.status='checks-passed';
} finally {fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log('YouTube training: 5 headless SDK mock paths passed');
