// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Exported game against explicit SDK mocks; never opens a visible window. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const args=process.argv.slice(2);
const flag=name=>args[args.indexOf(name)+1];
if (!args.includes('--dir')) throw new Error('Expected --dir <CrazyGames Web export>');
const root=fs.realpathSync(flag('--dir')), out=path.resolve(args.includes('--out') ? flag('--out') : 'output/crazygames-training-check');
fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=(under='')=>fs.readdirSync(path.join(root,under),{withFileTypes:true}).flatMap(entry=>{
    const file=under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return files(file);
    if (!entry.isFile()) throw new Error(`Unsupported entry ${file}`);
    return [file];
});
const identities=Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))]));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const server=http.createServer((req,res)=>{
    try {
        const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1) || 'index.html';
        const file=fs.realpathSync(path.resolve(root,name));
        if (!file.startsWith(root+path.sep) || !fs.statSync(file).isFile()) throw new Error('Outside export');
        res.setHeader('Content-Type',mime[path.extname(file)] ?? 'application/octet-stream');res.end(fs.readFileSync(file));
    } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio']});
const report={mode:'local-mock',headless:true,status:'failed',identities,verifierSha256:sha(new URL(import.meta.url)),cases:[],
    pending:['Official CrazyGames QA','Production ad fill','Cross-account cloud restoration','Physical-device and audible quality acceptance','Leaderboards']};
try {
    for (const mode of ['normal','init-failed','sdk-missing','save-disabled']) {
        const context=await browser.newContext({viewport:{width:800,height:450}}), page=await context.newPage();
        const observation={mode,status:'failed',errors:[],unexpectedRequests:[]};report.cases.push(observation);
        page.on('pageerror',error=>observation.errors.push(String(error)));
        await page.addInitScript(()=>{
            window.__audioContexts=[];const Original=window.AudioContext;
            if (Original) window.AudioContext=class extends Original {constructor(...args){super(...args);window.__audioContexts.push(this);}};
        });
        await context.route('**/*',async route=>{
            const url=route.request().url();
            if (url.startsWith(origin+'/')) return route.continue();
            if (url==='https://sdk.crazygames.com/crazygames-sdk-v3.js') return route.fulfill({contentType:'text/javascript',body:mode==='sdk-missing' ? '' : `
                window.__events=[];window.__settingsListeners=new Set();window.__data=new Map();
                const record=event=>__events.push(event);
                window.CrazyGames={SDK:{
                    init(){record('init');return ${mode==='init-failed' ? 'Promise.reject(new Error("blocked"))' : 'Promise.resolve()'}},
                    game:{settings:{muteAudio:true},loadingStart(){record('loading')},loadingStop(){record('loaded')},
                        gameplayStart(){record('start')},gameplayStop(){record('stop')},
                        addSettingsChangeListener(cb){__settingsListeners.add(cb)},removeSettingsChangeListener(cb){__settingsListeners.delete(cb)}},
                    ad:{requestAd(type,cb){record(type);window.__ad=cb;cb.adStarted()}},
                    data:{getItem(key){${mode==='save-disabled' ? 'throw new Error("Progress Save disabled");' : 'return __data.get(key) ?? null;'}},
                        setItem(key,value){__data.set(key,value)},removeItem(key){__data.delete(key)}}
                }};
                window.__mute=value=>{CrazyGames.SDK.game.settings.muteAudio=value;for(const cb of __settingsListeners)cb({muteAudio:value})};
            `});
            observation.unexpectedRequests.push(url);return route.abort();
        });
        try {
            await page.goto(origin+'/?headless');
            await page.waitForFunction(()=>window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text,{}, {timeout:30000});
            await page.waitForFunction(()=>!document.getElementById('es-splash'));
            const click=async name=>{
                const box=await page.evaluate(n=>__estellaCooked.probe([n]).at[n],name);assert(box,`Missing ${name}`);
                await page.mouse.click(400+box.x,225-box.y);
            };
            const phase=value=>page.waitForFunction(v=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.startsWith(v),value.toUpperCase());
            const active=mode==='normal'||mode==='save-disabled';
            assert.deepEqual(await page.evaluate(()=>window.__events ?? []),mode==='sdk-missing' ? [] : active ? ['init','loading','loaded'] : ['init']);
            await click('TrainingStart');await phase('playing');
            if (active) {
                await page.waitForFunction(()=>__audioContexts.length>0 && __audioContexts.every(c=>c.state==='suspended'));
                await page.evaluate(()=>__mute(false));
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                const before=await page.evaluate(()=>__events.slice());
                await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
                assert.deepEqual(await page.evaluate(()=>__events),before);
                await phase('playing');
                await page.evaluate(()=>__mute(true));
                await click('TrainingReward');await phase('ad');
                await page.evaluate(()=>__ad.adFinished());await phase('playing');
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='suspended'));
                await page.evaluate(()=>__mute(false));
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                await click('TrainingReward');await phase('ad');await page.evaluate(()=>__ad.adError(new Error('no fill')));await phase('playing');
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                await click('TrainingPause');await phase('paused');await click('TrainingStart');await phase('ad');
                await page.evaluate(()=>__ad.adFinished());await phase('playing');
                observation.storage=await page.evaluate(async()=>{
                    const {Storage}=await import('esengine');
                    try {Storage.setString('training-check','retained');const restored=Storage.getString('training-check');
                        CrazyGames.SDK.data.setItem('publisher-data','keep');Storage.clear();
                        return {restored,cleared:Storage.has('training-check'),publisher:CrazyGames.SDK.data.getItem('publisher-data')};
                    } catch(error) {return {error:String(error),localFallback:localStorage.getItem('esengine:training-check')};}
                });
                if (mode==='normal') assert.deepEqual(observation.storage,{restored:'retained',cleared:false,publisher:'keep'});
                else {assert.match(observation.storage.error,/Progress Save disabled/);assert.equal(observation.storage.localFallback,null);}
                assert.deepEqual(await page.evaluate(()=>__events),['init','loading','loaded','start','stop','rewarded','start','stop','rewarded','start','stop','midgame','start']);
            } else {
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['TrainingReward']).at.TrainingReward ? __estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text : ''),/Credits: 0/);
                observation.storage=await page.evaluate(async()=>{try{(await import('esengine')).Storage.setString('training-check','bad');return 'unexpected success';}catch(error){return String(error);}});
                assert.match(observation.storage,/storage unavailable/);
                assert.deepEqual(await page.evaluate(()=>window.__events ?? []),mode==='sdk-missing' ? [] : ['init']);
            }
            const screenshot=`${mode}.png`;await page.screenshot({path:path.join(out,screenshot)});
            observation.screenshot={file:screenshot,sha256:sha(path.join(out,screenshot))};
            assert.deepEqual(observation.errors,[]);assert.deepEqual(observation.unexpectedRequests,[]);
            observation.events=await page.evaluate(()=>window.__events ?? []);observation.status='passed';
        } catch(error) {observation.failure=String(error);throw error;}
        finally {await context.close();}
    }
    assert.deepEqual(Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))])),identities);
    report.status='checks-passed';
} finally {
    fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify(report,null,2));
    await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(`CrazyGames local mock checks: ${report.cases.length} passed`);
