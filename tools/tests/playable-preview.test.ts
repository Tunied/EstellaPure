// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { makeZip } from '../../build-tools/utils/zip.js';
import { createPlayablePreview } from '../playable-preview.mjs';

async function fixture(network: string, run: (preview: any, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'estella-playable-preview-'));
  const file = path.join(root, 'index.html');
  const html = '<!doctype html><html><head><script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script></head><body>Creative</body></html>';
  await writeFile(file, html);
  let preview: any;
  try { preview = await createPlayablePreview({ htmlFile: file, network }); await run(preview, file); }
  finally {
    await preview?.close();
    const target = path.resolve(root), temp = path.resolve(tmpdir());
    if (!target.startsWith(temp + path.sep) || !path.basename(target).startsWith('estella-playable-preview-')) throw new Error('Unexpected fixture cleanup path');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

describe('local playable mock', () => {
  it('serves an instrumented copy without changing the delivered file or exposing arbitrary files', async () => {
    await fixture('pangle', async (preview, file) => {
      const original = await readFile(file, 'utf8');
      const home = await (await fetch(preview.url)).text();
      expect(home).toContain('Mock host callbacks only');
      expect(home).toContain(preview.htmlSha256);
      const response = await fetch(preview.url + 'creative');
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
      const creative = await response.text();
      expect(creative).toContain('installHost'); expect(creative).toContain('src="/host-sdk.js"');
      expect(await readFile(file, 'utf8')).toBe(original);
      expect((await fetch(preview.url + '../package.json')).status).toBe(404);
    });
  });

  it('refuses mismatched artifact identity and network before starting a server', async () => {
    await fixture('mraid', async (preview, file) => {
      const reportFile = path.join(path.dirname(file), 'report.json');
      await writeFile(reportFile, JSON.stringify({ playableCheck: { network: 'mraid', htmlSha256: 'stale' } }));
      await expect(createPlayablePreview({ htmlFile: file, reportFile })).rejects.toThrow(/does not describe/);
      await writeFile(reportFile, JSON.stringify({ network: 'mraid', htmlSha256: preview.htmlSha256 }));
      await expect(createPlayablePreview({ htmlFile: file, reportFile, network: 'mintegral' })).rejects.toThrow(/differs/);
    });
  });

  it('keeps completion independent of close and reports creative-owned readiness', async () => {
    await fixture('mintegral', async preview => {
      const creative = await (await fetch(preview.url + 'creative')).text();
      const source = /<script>([\s\S]*?)<\/script>/.exec(creative)![1];
      const messages: any[] = []; let closes = 0, starts = 0;
      const window: any = { addEventListener() {}, gameClose: () => closes++, gameStart: () => starts++ };
      runInNewContext(source, { window, document: { addEventListener() {}, dispatchEvent() {} }, parent: { postMessage: (value: any) => messages.push(value) }, location: { origin: 'http://local' }, navigator: {}, console: { warn() {} }, Event, URL });
      window.gameReady(); window.gameEnd(); expect(closes).toBe(0);
      expect(messages.map(message => message.name)).toContain('creative-ready');
      expect(messages.map(message => message.name)).toContain('game-end');
      window.gameRetry(); expect(starts).toBe(1);
    });
  });

  it('binds records to the actual relocated ZIP and refuses changed config with unchanged HTML', async () => {
    await fixture('pangle', async (initial, file) => {
      const html = await readFile(file), root = path.dirname(file), zipFile = path.join(root, 'playable.zip');
      const zip = (orientation: number) => makeZip([{ name: 'index.html', data: html },
        { name: 'config.json', data: Buffer.from(JSON.stringify({ playable_orientation: orientation })) }]);
      const original = zip(0), deliverySha256 = createHash('sha256').update(original).digest('hex');
      await writeFile(zipFile, original);
      const reportFile = path.join(root, 'report.json');
      for (const previousPath of ['/previous/export/playable.zip', 'C:\\previous\\export\\playable.zip']) {
        await writeFile(reportFile, JSON.stringify({ zipFile: previousPath,
          playableCheck: { network: 'pangle', htmlSha256: initial.htmlSha256, deliverySha256 } }));
        const preview = await createPlayablePreview({ htmlFile: file, reportFile });
        try {
          expect(preview.deliveryFile).toBe('playable.zip');
          expect(preview.deliverySha256).toBe(deliverySha256);
          expect(await (await fetch(preview.url)).text()).toContain(deliverySha256);
          expect(await readFile(zipFile)).toEqual(original);
        } finally { await preview.close(); }
      }
      await writeFile(zipFile, zip(1));
      expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(initial.htmlSha256);
      await expect(createPlayablePreview({ htmlFile: file, reportFile })).rejects.toThrow(/delivered file differs/);
    });
  });

  it('refuses ZIP-only hashes without an archive filename and keeps HTML-only records explicit', async () => {
    await fixture('mraid', async (initial, file) => {
      const reportFile = path.join(path.dirname(file), 'report.json');
      await writeFile(reportFile, JSON.stringify({ network: 'mraid', htmlSha256: initial.htmlSha256, deliverySha256: 'other' }));
      await expect(createPlayablePreview({ htmlFile: file, reportFile })).rejects.toThrow(/full export result/);
      expect(await (await fetch(initial.url)).text()).toContain('HTML-only identity');
    });
  });

  it('emits genuine mock callbacks and ignores commands from an unrelated frame', async () => {
    await fixture('mraid', async preview => {
      const creative = await (await fetch(preview.url + 'creative?store=https%3A%2F%2Fexample.com%2Fstore')).text();
      const source = /<script>([\s\S]*?)<\/script>/.exec(creative)![1];
      const messages: any[] = [], handlers: Record<string, Function> = {};
      const parent = { postMessage: (value: any) => messages.push(value) };
      const window: any = { addEventListener: (name: string, fn: Function) => { handlers[name] = fn; } };
      const document = { addEventListener() {}, dispatchEvent() {} };
      runInNewContext(source, { window, document, parent, location: { origin: 'http://local' }, navigator: { userActivation: { isActive: false } }, console: { warn() {} }, Event, URL });
      const ready = () => messages.push({ readyCallback: true }); window.mraid.addEventListener('ready', ready);
      const command = (name: string, owner = parent) => handlers.message({ source: owner, origin: 'http://local', data: { source: 'estella-playable-preview', type: 'command', command: name } });
      command('ready', {}); expect(window.mraid.getState()).toBe('loading');
      command('ready'); expect(messages.some(message => message.readyCallback)).toBe(true);
      expect(window.mraid.getState()).toBe('default'); expect(window.mraid.isViewable()).toBe(false);
      command('show'); expect(window.mraid.isViewable()).toBe(true);
      command('hide'); expect(window.mraid.isViewable()).toBe(false);
      window.mraid.open(window.clickTag);
      expect(messages.find(message => message.name === 'store-click').data.url).toBe('https://example.com/store');
      window.mraid.removeEventListener('ready', ready);
    });
  });
});
