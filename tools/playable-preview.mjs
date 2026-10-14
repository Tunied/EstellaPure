// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NETWORKS = ['generic', 'mraid', 'unity', 'applovin', 'mintegral', 'tiktok', 'pangle', 'google', 'meta'];
const SDKS = [
  'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js',
  'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js',
];
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

/** The mocked host runs before creative scripts; it never opens a store. */
function installHost(config) {
  const source = 'estella-playable-preview', origin = location.origin;
  const events = new Map();
  let ready = false, visible = false, state = 'loading';
  const emit = (name, data = {}) => parent.postMessage({ source, type: 'event', name, data,
    gesture: !!navigator.userActivation?.isActive }, origin);
  const fire = (name, ...args) => events.get(name)?.forEach(fn => fn(...args));
  const visibility = value => {
    visible = value;
    if (ready) state = value ? 'default' : 'hidden';
    fire('viewableChange', value);
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const warn = console.warn;
  console.warn = (...args) => { warn.apply(console, args); emit('console-warning', { message: args.map(String).join(' ') }); };
  window.__PLAYABLE_PREVIEW_EMIT__ = emit;
  if (config.storeUrl) window.clickTag = config.storeUrl;
  if (['mraid', 'unity', 'applovin'].includes(config.network)) {
    window.mraid = {
      getVersion: () => '3.0', getState: () => state, isViewable: () => visible,
      supports: () => false,
      addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); emit('listener-added', { name }); },
      removeEventListener(name, fn) { events.get(name)?.delete(fn); },
      open: url => emit('store-click', { url }),
    };
  }
  if (config.network === 'mintegral') {
    window.install = () => emit('store-click');
    window.gameReady = () => { ready = true; emit('creative-ready'); };
    window.gameEnd = () => emit('game-end');
    window.gameRetry = () => { emit('game-retry'); window.gameStart?.(); };
  }
  if (['tiktok', 'pangle'].includes(config.network)) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
    window.openAppStore = () => emit('store-click');
  }
  if (config.network === 'meta') window.FbPlayableAd = { onCTAClick: () => emit('store-click') };
  if (config.network === 'google') window.ExitApi = { exit: () => emit('store-click') };
  window.addEventListener('error', event => emit('page-error', { message: event.message }));
  window.addEventListener('unhandledrejection', event => emit('page-error', { message: String(event.reason) }));
  document.addEventListener('securitypolicyviolation', event => emit('blocked-request', { url: event.blockedURI }));
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin || event.data?.source !== source || event.data.type !== 'command') return;
    const command = event.data.command;
    if (command === 'ready') {
      if (config.network === 'mintegral') { emit('notice', { message: 'Mintegral announces readiness from the creative.' }); return; }
      ready = true; state = 'default'; fire('ready');
    } else if (command === 'show') { visibility(true); if (config.network === 'mintegral') window.gameStart?.(); }
    else if (command === 'hide') { visibility(false); if (config.network === 'mintegral') window.gameClose?.(); }
    emit('host-command', { command, ready, visible });
  });
  emit('mock-installed', { network: config.network });
}

function viewer(config) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Playable container preview</title><style>
body{margin:0;background:#141923;color:#e8edf6;font:14px system-ui}main{max-width:1160px;margin:24px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 8px}.note{color:#bbc5d5;line-height:1.5}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0}
button,input,select{font:inherit;border:1px solid #61718a;border-radius:6px;padding:8px;background:#232d3e;color:inherit}button{cursor:pointer}button:hover{background:#34445d}input{min-width:280px;flex:1}
.layout{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}iframe{border:1px solid #61718a;background:#0b1019;display:block;max-width:100%}
.events{flex:1;min-width:260px;max-width:700px}#events{padding-left:20px;max-height:500px;overflow:auto;overflow-wrap:anywhere;line-height:1.6}.identity{font-size:12px;color:#bbc5d5;overflow-wrap:anywhere}
</style></head><body><main><h1>Local playable container / 本地试玩容器</h1>
<p class="note">Mock host callbacks only. Store clicks are recorded, not opened. This is not network approval or device acceptance.<br>仅模拟宿主回调，记录商店点击，不打开商店；不代表平台审核或真机验收。</p>
<div class="identity" id="identity"></div><div class="controls">
<button data-command="ready">Ready / 准备</button><button data-command="show">Show / 显示</button><button data-command="hide">Hide / 隐藏</button>
<label>Viewport / 视口 <select id="viewport"><option value="360,640">360 × 640</option><option value="800,400">800 × 400</option></select></label>
<input id="store-url" aria-label="Store URL" placeholder="MRAID store URL / 商店地址"><button id="reload">Reload / 重载</button><button id="save">Save log / 保存记录</button></div>
<div class="layout"><iframe id="creative" title="Playable creative" width="360" height="640"></iframe><section class="events"><h2>Host events / 宿主事件</h2><p id="truncated-log" class="note" aria-live="polite" hidden></p><ol id="events"></ol></section></div></main>
<script>
const config=${safeJson(config)},source='estella-playable-preview',frame=document.getElementById('creative'),events=[];
let truncatedEvents=0;
window.previewEvents=events;document.getElementById('identity').textContent=config.network+' · HTML SHA256 '+config.htmlSha256+(config.deliverySha256?' · Delivery SHA256 '+config.deliverySha256:' · HTML-only identity');
document.getElementById('store-url').value=config.storeUrl||'';
const load=()=>{frame.src='/creative?store='+encodeURIComponent(document.getElementById('store-url').value);};
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>frame.contentWindow.postMessage({source,type:'command',command:button.dataset.command},location.origin));
document.getElementById('reload').onclick=load;
document.getElementById('viewport').onchange=event=>{const [w,h]=event.target.value.split(',');frame.width=w;frame.height=h;};
window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.source!==source||event.data.type!=='event')return;
const record={...event.data,timeMs:Math.round(performance.now())};events.push(record);if(events.length>1000){events.shift();truncatedEvents++;const notice=document.getElementById('truncated-log');notice.hidden=false;notice.textContent=truncatedEvents+' earlier events omitted / 已省略 '+truncatedEvents+' 条早期记录';}const item=document.createElement('li');item.textContent=record.name+' '+JSON.stringify(record.data)+(record.gesture?' [gesture]':'');document.getElementById('events').append(item);if(document.getElementById('events').children.length>1000)document.getElementById('events').firstChild.remove();});
document.getElementById('save').onclick=()=>{const blob=new Blob([JSON.stringify({mode:'local-mock',identityScope:config.deliverySha256?'delivery':'html-only',network:config.network,htmlSha256:config.htmlSha256,deliverySha256:config.deliverySha256,deliveryFile:config.deliveryFile,truncatedEvents,events},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='playable-preview-log.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};load();
</script></body></html>`;
}

export async function createPlayablePreview({ htmlFile, network, storeUrl = '', reportFile, port = 0 }) {
  const html = await readFile(htmlFile);
  const htmlSha256 = createHash('sha256').update(html).digest('hex');
  let deliverySha256, deliveryFile;
  if (reportFile) {
    const result = JSON.parse(await readFile(reportFile, 'utf8'));
    const report = result.playableCheck ?? result;
    if (report.htmlSha256 !== htmlSha256) throw new Error('The report does not describe this HTML file. Export it again.');
    if (network && network !== report.network) throw new Error('The selected network differs from the export report.');
    network = report.network;
    if (report.deliverySha256) {
      let delivery = html;
      deliveryFile = path.basename(htmlFile);
      if (result.zipFile) {
        if (typeof result.zipFile !== 'string') throw new Error('The export result ZIP filename must be a string.');
        deliveryFile = path.basename(result.zipFile);
        if (!/^[A-Za-z0-9_]+\.zip$/.test(deliveryFile) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\.zip$/i.test(deliveryFile)) throw new Error('The report needs a portable ZIP filename.');
        delivery = await readFile(path.join(path.dirname(path.resolve(htmlFile)), deliveryFile));
      } else if (report.deliverySha256 !== htmlSha256) throw new Error('ZIP identity needs the full export result with zipFile, beside its HTML.');
      deliverySha256 = createHash('sha256').update(delivery).digest('hex');
      if (deliverySha256 !== report.deliverySha256) throw new Error('The delivered file differs from its export report. Export it again.');
    }
  }
  if (!NETWORKS.includes(network)) throw new Error(`Choose --network ${NETWORKS.join('|')} or supply --report export-result.json.`);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  if (!/<head\b[^>]*>/i.test(html.toString('utf8'))) throw new Error('The creative needs an explicit HTML head.');
  const config = { network, storeUrl, htmlSha256, deliverySha256, deliveryFile };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' data: blob:");
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(viewer(config)); }
    else if (url.pathname === '/creative') {
      const creativeConfig = { ...config, storeUrl: url.searchParams.get('store') ?? storeUrl };
      let document = html.toString('utf8');
      for (const sdk of SDKS) document = document.replaceAll(sdk, '/host-sdk.js');
      document = document.replace(/<head\b[^>]*>/i, match => `${match}<script>(${installHost.toString()})(${safeJson(creativeConfig)});</script>`);
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(document);
    } else if (url.pathname === '/host-sdk.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end('window.openAppStore=function(){window.__PLAYABLE_PREVIEW_EMIT__("store-click")};window.ExitApi={exit:window.openAppStore};');
    } else if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); }
    else { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/`, htmlSha256, deliverySha256,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; };
  if (!args[0] || args.includes('--help')) {
    console.log('node tools/playable-preview.mjs <index.html> --network <id> [--store-url <url>] [--report <export-result.json>] [--port <number>]\nStarts a local mock only; does not open a browser or modify the creative.');
  } else {
    createPlayablePreview({ htmlFile: path.resolve(args[0]), network: option('network'), storeUrl: option('store-url'),
      reportFile: option('report'), port: Number(option('port') ?? 0) }).then(preview => {
      console.log(`Local mock: ${preview.url}\nHTML SHA256: ${preview.htmlSha256}\nNo browser opened. Press Ctrl+C to stop.`);
      process.once('SIGINT', () => preview.close().then(() => process.exit(0)));
      process.once('SIGTERM', () => preview.close().then(() => process.exit(0)));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
