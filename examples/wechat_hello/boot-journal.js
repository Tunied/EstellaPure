'use strict';

// Small, bounded diagnostic record. Sync writes happen at startup checkpoints,
// never on every draw. A native termination cannot be caught by JS; the next
// launch can still show the last checkpoint without USB or remote debugging.
function createBootJournal(wx, buildId, key = 'copyengine-boot-journal-v1') {
  let previous;
  try { previous = wx.getStorageSync?.(key); } catch (_) {}
  const record = { buildId, active: true, rows: [] };
  const save = () => { try { wx.setStorageSync?.(key, record); } catch (_) {} };
  const note = (...parts) => {
    const line = parts.map(value => String(value)).join(' ').slice(0, 600);
    record.rows.push(line);
    if (record.rows.length > 36) record.rows.shift();
    save();
    console.log('[BOOT]', line);
  };
  const report = value => new Promise(resolve => {
    if (!wx.showModal) return resolve();
    const content = [`Build: ${value.buildId}`, ...value.rows].join('\n').slice(-6500);
    wx.showModal({ title: '启动诊断记录（不等于崩溃原因）', content,
      confirmText: '复制记录', cancelText: '继续启动',
      success(result) {
        if (result.confirm) wx.setClipboardData?.({ data: content });
      }, complete: resolve });
  });
  let stable = false;
  return {
    note,
    async begin() {
      // Do not overwrite the previous failure before the user can copy it.
      if (previous?.active && Array.isArray(previous.rows)) await report(previous);
      let info = {};
      try { info = wx.getDeviceInfo?.() || wx.getSystemInfoSync?.() || {}; } catch (_) {}
      note('BOOT', buildId, info.platform || '', info.model || '', info.system || '');
      wx.onMemoryWarning?.(event => note('HOST_MEMORY_WARNING', event?.level ?? 'unknown'));
      wx.onError?.(message => { record.active = true; note('HOST_ERROR', message); });
      wx.onUnhandledRejection?.(event => { record.active = true; note('UNHANDLED_REJECTION', event?.reason?.stack || event?.reason || event); });
      // Diagnostic-only gesture, also works for a running but visually black
      // frame: three simultaneous fingers opens the saved record.
      wx.onTouchStart?.(event => { if ((event.touches || event.changedTouches || []).length >= 3) report(record); });
    },
    stable() { if (!stable) { stable = true; record.active = false; note('STABLE_120_FRAMES'); } },
    fail(error) { record.active = true; note('FAILED', error?.stack || error); return report(record); },
    // Track the first use of risky upload/draw calls, including the exact data
    // view size. Do not intercept getError or change GL results/arguments.
    traceGL(gl) {
      for (const name of ['texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData', 'drawArrays', 'drawElements']) {
        if (typeof gl[name] !== 'function') continue;
        const original = gl[name].bind(gl);
        let first = true;
        gl[name] = (...args) => {
          if (!first) return original(...args);
          first = false;
          note('GL_ENTER', name, args.map(a => ArrayBuffer.isView(a) ? `viewBytes=${a.byteLength}` : typeof a === 'number' ? a : a === null ? 'null' : typeof a).join(','));
          const result = original(...args);
          note('GL_RETURN', name);
          return result;
        };
      }
    }
  };
}
module.exports = { createBootJournal };
