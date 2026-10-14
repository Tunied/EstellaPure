// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import type { PlayableAdProfile } from './playableAdProfile';

export type PlayableCheckId = 'delivery-size' | 'html-size' | 'markup-resources' | 'host-sdk' | 'orientation-config' | 'cta-interaction' | 'host-lifecycle' | 'runtime-requests' | 'network-acceptance';

export interface PlayableCheckItem {
  id: PlayableCheckId;
  status: 'pass' | 'fail' | 'needs-runtime';
  detail: string;
}

export interface PlayableCheckReport {
  version: 1;
  network: string;
  status: 'failed' | 'needs-runtime';
  htmlSha256: string;
  deliverySha256: string;
  checks: PlayableCheckItem[];
}

/** Mask raw text while preserving positions so JS strings are not HTML tags. */
function sdkPlacement(html: string, rule: NonNullable<PlayableAdProfile['requiredSdk']>): boolean {
  const scripts: { index: number; src?: string; code: string; delayed: boolean; executable: boolean }[] = [];
  const markup = html.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length))
    .replace(/<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>/gi,
      (whole: string, tag: string, attributes: string, code: string, index: number) => {
        const attrs = [...attributes.matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
        const type = attrs.find(attr => attr[1].toLowerCase() === 'type')?.slice(2).find(value => value !== undefined)?.trim().toLowerCase() ?? '';
        if (tag.toLowerCase() === 'script') scripts.push({ index, code,
          src: attrs.find(attr => attr[1].toLowerCase() === 'src')?.slice(2).find(value => value !== undefined),
          executable: !type || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script(1\.[0-9])?$/.test(type),
          delayed: type === 'module' || attrs.some(attr => ['async', 'defer'].includes(attr[1].toLowerCase())) });
        const prefix = 2 + tag.length + attributes.length;
        return whole.slice(0, prefix) + ' '.repeat(code.length) + whole.slice(prefix + code.length);
      });
  const section = rule.placement === 'head' ? /<head\b[^>]*>[\s\S]*?<\/head\s*>/i.exec(markup)
    : /<body\b[^>]*>[\s\S]*?<\/body\s*>/i.exec(markup);
  if (!section) return false;
  const sdk = scripts.find(script => script.src === rule.url);
  if (!sdk || !sdk.executable || (rule.placement === 'body-before-game' && sdk.delayed) || sdk.index < section.index || sdk.index >= section.index + section[0].length) return false;
  return rule.placement === 'head' || !scripts.some(script => script.index < sdk.index && script.executable && (script.src || script.code.trim()));
}

/** Checks literal HTML references; embedded scripts still need request tracing. */
function markupReferences(html: string): { tag: string; url: string }[] {
  const refs: { tag: string; url: string }[] = [];
  const css = (value: string) => {
    for (const match of value.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) refs.push({ tag: 'css', url: match[1] });
    for (const match of value.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) refs.push({ tag: 'css', url: match[1] });
  };
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>/gi,
    (_all, tag: string, attributes: string, body: string) => { if (tag.toLowerCase() === 'style') css(body); return `<${tag}${attributes}></${tag}>`; });
  for (const match of markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const tag = match[1].toLowerCase();
    for (const attr of match[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const key = attr[1].toLowerCase(), value = attr[2] ?? attr[3] ?? attr[4];
      if (key === 'style') css(value);
      else if (key === 'src' || key === 'poster' || (key === 'data' && tag === 'object')
        || ((key === 'href' || key === 'xlink:href') && ['link', 'image', 'use'].includes(tag))) refs.push({ tag, url: value });
      else if (key === 'srcset') {
        for (const url of value.matchAll(/(?:https?:)?\/\/[^\s,]+/gi)) refs.push({ tag, url: url[0] });
        refs.push({ tag: 'srcset', url: value });
      }
    }
  }
  return refs.filter(ref => ref.tag === 'srcset' || !/^(data:|blob:|#)/i.test(ref.url));
}

export function checkPlayable(input: {
  profile: PlayableAdProfile;
  html: Buffer;
  delivery: Buffer;
  archiveFiles: { name: string; content: string }[];
}): PlayableCheckReport {
  const { profile, html, delivery, archiveFiles } = input;
  const checks: PlayableCheckItem[] = [];
  const check = (id: PlayableCheckId, valid: boolean, detail: string) => checks.push({ id, status: valid ? 'pass' : 'fail', detail });
  check('delivery-size', delivery.length <= profile.maxBytes, `${delivery.length} / ${profile.maxBytes} bytes; ${profile.limitNote}`);
  if (profile.maxHtmlBytes !== undefined) check('html-size', html.length <= profile.maxHtmlBytes, `${html.length} / ${profile.maxHtmlBytes} bytes`);
  const refs = markupReferences(html.toString('utf8'));
  const rejected = refs.filter(ref => ref.tag !== 'srcset' && (ref.tag !== 'script' || !profile.allowedExternalScripts?.includes(ref.url)));
  checks.push({ id: 'markup-resources', status: rejected.length ? 'fail' : refs.some(ref => ref.tag === 'srcset') ? 'needs-runtime' : 'pass',
    detail: rejected.length ? rejected.map(ref => `${ref.tag}: ${ref.url}`).join('\n') : 'No unapproved simple HTML/CSS references. Trace srcset, dynamic requests and generated markup at runtime.' });
  if (profile.requiredSdk) check('host-sdk', sdkPlacement(html.toString('utf8'), profile.requiredSdk),
    `Required script: ${profile.requiredSdk.url}; placement: ${profile.requiredSdk.placement}`);
  if (profile.configOrientationField) {
    let valid = false;
    try { const config = JSON.parse(archiveFiles.find(file => file.name === 'config.json')?.content ?? ''); valid = [0, 1, 2].includes(config?.[profile.configOrientationField]); } catch { /* Missing or malformed configuration is a failed check. */ }
    check('orientation-config', valid, `config.json: ${profile.configOrientationField} must be 0, 1 or 2`);
  }
  checks.push(
    { id: 'cta-interaction', status: 'needs-runtime', detail: 'Verify the actual user gesture and destination in the network container; declaring a bridge does not prove a store click.' },
    { id: 'host-lifecycle', status: 'needs-runtime', detail: 'Verify readiness, start/viewability, close/background, audio and retry using the target host.' },
    { id: 'runtime-requests', status: 'needs-runtime', detail: 'Trace runtime requests, redirects and offline behavior; embedded JavaScript is not executed by this check.' },
    { id: 'network-acceptance', status: 'needs-runtime', detail: 'Complete the official network preview and physical device acceptance.' },
  );
  return { version: 1, network: profile.id, status: checks.some(item => item.status === 'fail') ? 'failed' : 'needs-runtime',
    htmlSha256: createHash('sha256').update(html).digest('hex'), deliverySha256: createHash('sha256').update(delivery).digest('hex'), checks };
}
