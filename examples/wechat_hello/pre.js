// The upstream wxgame-pre.js browser-name shim, plus a module-local wx clock.
// Keep the real platform globals intact. All scene logic remains C++.
if (typeof window === 'undefined') globalThis.window = globalThis;
if (typeof document === 'undefined') globalThis.document = {};
if (typeof WebAssembly === 'undefined' && typeof WXWebAssembly !== 'undefined') globalThis.WebAssembly = WXWebAssembly;
var performance = globalThis.performance || (() => {
  const clock = typeof wx !== 'undefined' && wx.getPerformance ? wx.getPerformance() : null;
  const origin = Date.now(); let last = 0;
  return { now() { return last = Math.max(last, clock ? clock.now() / 1000 : Date.now() - origin); } };
})();
