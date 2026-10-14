// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { checkPlayable } from '../src/export/playableCheck';
import { genericPlayableProfile, tiktokPlayableProfile, googlePlayableProfile } from '../src/export/playableAdProfile';

const inspect = (html: string, profile = genericPlayableProfile, config?: string) => checkPlayable({
  profile, html: Buffer.from(html), delivery: Buffer.from(html),
  archiveFiles: config === undefined ? [] : [{ name: 'config.json', content: config }],
});

describe('playable export checks', () => {
  it('records bytes and file identity while keeping interactions unverified', () => {
    const report = inspect('<html><body><canvas></canvas></body></html>');
    expect(report.status).toBe('needs-runtime');
    expect(report.checks.find(item => item.id === 'delivery-size')?.status).toBe('pass');
    expect(report.checks.find(item => item.id === 'cta-interaction')?.status).toBe('needs-runtime');
    expect(report.checks.find(item => item.id === 'host-lifecycle')?.status).toBe('needs-runtime');
    expect(report.htmlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inspect('<html>changed</html>').htmlSha256).not.toBe(report.htmlSha256);
  });

  it.each(['<img src="https://example.com/image.png">', '<script src="game.js"></script>',
    '<style>body{background:url(https://example.com/image.png)}</style>',
    '<style>@import "theme.css";</style>', '<svg><image href="https://example.com/image.png"/></svg>'])
    ('reports an unembedded resource: %s', html => {
      const report = inspect(html);
      expect(report.status).toBe('failed');
      expect(report.checks.find(item => item.id === 'markup-resources')?.status).toBe('fail');
    });

  it('ignores script text and comments as markup, and allows embedded resources', () => {
    const report = inspect('<script>const unused = "<img src=remote.png>";</script><!--<img src=remote.png>--><img src="data:image/png;base64,AAAA">');
    expect(report.checks.find(item => item.id === 'markup-resources')?.status).toBe('pass');
  });

  it('allows only the exact mandatory SDK script and verifies config field casing', () => {
    const script = tiktokPlayableProfile.emitBody!({ title: 'T', orientation: 'portrait' });
    const good = inspect(script, tiktokPlayableProfile, '{"Playable_orientation":0}');
    expect(good.checks.find(item => item.id === 'markup-resources')?.status).toBe('pass');
    expect(good.checks.find(item => item.id === 'orientation-config')?.status).toBe('pass');
    expect(inspect(script, tiktokPlayableProfile, '{"playable_orientation":0}').status).toBe('failed');
    expect(inspect(script.replace('<script src=', '<img src='), tiktokPlayableProfile, '{"Playable_orientation":0}').status).toBe('failed');
  });

  it('keeps ambiguous srcset parsing pending and rejects visible external candidates', () => {
    expect(inspect('<img srcset="data:image/png;base64,AAAA 1x">').checks.find(item => item.id === 'markup-resources')?.status).toBe('needs-runtime');
    expect(inspect('<img srcset="data:image/png;base64,AAAA 1x, https://example.com/img.png 2x">').status).toBe('failed');
  });

  it('rejects a missing SDK even when the allowlist permits its URL', () => {
    const report = inspect('<html><head></head><body></body></html>', tiktokPlayableProfile, '{"Playable_orientation":0}');
    expect(report.checks.find(item => item.id === 'markup-resources')?.status).toBe('pass');
    expect(report.checks.find(item => item.id === 'host-sdk')?.status).toBe('fail');
  });

  it('requires the Google exit script in head', () => {
    const script = googlePlayableProfile.emitHead!({ title: 'T', orientation: 'portrait' });
    expect(inspect(`<html><head>${script}</head><body></body></html>`, googlePlayableProfile).status).toBe('needs-runtime');
    expect(inspect(`<html><head></head><body>${script}</body></html>`, googlePlayableProfile).status).toBe('failed');
  });

  it.each(['head', 'late', 'async', 'defer', 'data'])('rejects incorrectly placed or nonexecuting TikTok SDK: %s', mode => {
    let script = tiktokPlayableProfile.emitBody!({ title: 'T', orientation: 'portrait' });
    if (['async', 'defer'].includes(mode)) script = script.replace('<script ', `<script ${mode} `);
    if (mode === 'data') script = script.replace('<script ', '<script type="application/json" ');
    const html = mode === 'head' ? `<head>${script}</head><body></body>`
      : `<head></head><body>${mode === 'late' ? '<script>startGame()</script>' : ''}${script}</body>`;
    expect(inspect(html, tiktokPlayableProfile, '{"Playable_orientation":0}').checks.find(item => item.id === 'host-sdk')?.status).toBe('fail');
  });

  it('ignores commented tags and JS strings, allowing JSON metadata before the SDK', () => {
    const script = tiktokPlayableProfile.emitBody!({ title: 'T', orientation: 'portrait' });
    const html = `<head><!-- <script src="ignored"></script> --><script type="application/json">{"x":"<body>"}</script></head><body>${script}<script>const text="<head>";</script></body>`;
    expect(inspect(html, tiktokPlayableProfile, '{"Playable_orientation":0}').checks.find(item => item.id === 'host-sdk')?.status).toBe('pass');
  });

  it('reports an oversized deliverable without declaring runtime acceptance', () => {
    const report = inspect('<html></html>', { ...genericPlayableProfile, maxBytes: 1 });
    expect(report.status).toBe('failed');
    expect(report.checks.find(item => item.id === 'delivery-size')?.status).toBe('fail');
    expect(report.checks.find(item => item.id === 'network-acceptance')?.status).toBe('needs-runtime');
  });
});
