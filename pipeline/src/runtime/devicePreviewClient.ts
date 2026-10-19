// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getUserComponentFingerprint, probeRegistrations, type App } from 'esengine';

/** Uses the same schema probe and system replacement as editor Play. */
export function installDevicePreview(app: App, scripts?: string): void {
  const events = new EventSource(new URL('__events', location.href));
  let revision = Number(document.querySelector('meta[name="estella-preview-revision"]')?.getAttribute('content') ?? 0);
  let queue = Promise.resolve();
  const report = (note: string) => fetch(new URL('__status', location.href), {
    method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
  }).catch(() => {});
  events.addEventListener('connected', event => {
    if (JSON.parse((event as MessageEvent).data).revision !== revision) location.reload();
  });
  events.addEventListener('update', event => {
    const update = JSON.parse((event as MessageEvent).data) as { revision: number; scriptsOnly: boolean };
    queue = queue.then(async () => {
      if (update.revision <= revision) return;
      revision = update.revision;
      if (update.scriptsOnly && scripts) {
        const release = app.holdExecution();
        try {
          const fingerprint = getUserComponentFingerprint();
          const url = new URL(scripts, location.href); url.searchParams.set('previewRevision', String(revision));
          const incoming = await probeRegistrations(() => import(/* @vite-ignore */ url.href));
          if (incoming.fingerprint === fingerprint && app.hotSwapSystems(incoming.pending as Parameters<App['hotSwapSystems']>[0])) {
            void report(''); return;
          }
          void report('Script structure changed; reloaded the preview');
        } catch (error) { void report(`Script hot reload failed; reloaded the preview: ${String(error)}`); }
        finally { release(); }
      }
      location.reload();
    }).catch(async error => { await report(String(error)); location.reload(); });
  });
  addEventListener('pagehide', () => events.close(), { once: true });
}
