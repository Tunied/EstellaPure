import { chromium } from 'playwright';
import { serveHost } from '../../../tools/lib/staticServer.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('output/cyber-rooftop');
const outputName=path.basename(process.argv[2]??'actual.png');
const warmupFrames=Number(process.argv[3]??90);
const server=await serveHost(path.join(root,'web'));
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const errors=[]; const logs=[];
try {
 const page=await browser.newPage({viewport:{width:1672,height:940},deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning'){logs.push(m.text());console.log(m.type(),m.text().slice(0,350));}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?headless`,{waitUntil:'load',timeout:60000});
 await page.waitForFunction(()=>window.__estellaCooked?.facts().ready,null,{timeout:60000});
 await page.evaluate(()=>window.__estellaCooked.setPaused(true));
 console.log('ready',await page.evaluate(()=>window.__estellaCooked.facts()));
 await page.evaluate(n=>window.__estellaCooked.step(n),warmupFrames);
 await page.screenshot({path:path.join(root,outputName),timeout:60000});
 const state=await page.evaluate(()=>({globals:Object.keys(window).filter(k=>/estella|engine|app|playthrough/i.test(k)),splash:document.getElementById('es-splash')?.textContent,canvas:{w:document.querySelector('canvas')?.width,h:document.querySelector('canvas')?.height}}));
 await writeFile(path.join(root,'capture.json'),JSON.stringify({errors,logs,state},null,2));
 console.log(JSON.stringify({errors,logs:logs.slice(0,12),state},null,2));
}finally{await browser.close();server.close();}
