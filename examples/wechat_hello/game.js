'use strict';
const config = require('./game-config');
const { createBootJournal } = require('./boot-journal');
const journal = createBootJournal(wx, config.buildId, 'estella-hello-boot-v1');
async function start() {
  await journal.begin();
  // Match upstream ordering: reserve screen canvas, load wasm, then acquire GL.
  const canvas = wx.createCanvas();
  const dimensions = () => {
    const s = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return { width: Math.round(s.windowWidth * (s.pixelRatio || 1)), height: Math.round(s.windowHeight * (s.pixelRatio || 1)) };
  };
  Object.assign(canvas, dimensions());
  const factory = require('./wasm/estella-hello');
  journal.note('WASM_INSTANTIATE');
  let rejectLoad;
  const failure = new Promise((_, reject) => { rejectLoad = reject; });
  const timer = setTimeout(() => rejectLoad(new Error('WASM timeout')), 30000);
  let module;
  try {
    module = await Promise.race([factory({ canvas,
      print: value => journal.note('[C++]', value), printErr: value => journal.note('[C++ ERROR]', value),
      onAbort: reason => rejectLoad(new Error(String(reason))),
      instantiateWasm(imports, receive) {
        Promise.resolve().then(() => WXWebAssembly.instantiate('wasm/estella-hello.wasm', imports))
          .then(r => { journal.note('WASM_INSTANCE_READY'); receive(r.instance || r, r.module); }).catch(rejectLoad);
        return {};
      }
    }), failure]);
  } finally { clearTimeout(timer); }
  journal.note('WEBGL2_CREATE', `${canvas.width}x${canvas.height}`);
  // Upstream packagedRuntime.ts attributes, ordinary WebGL2 (no optional GLX).
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: true,
    premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const getExtension = gl.getExtension.bind(gl);
  const core = new Set(['OES_vertex_array_object', 'ANGLE_instanced_arrays', 'WEBGL_draw_buffers']);
  gl.getExtension = name => core.has(name) ? null : getExtension(name);
  journal.traceGL(gl);
  const context = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: true });
  if (!context) throw new Error('Context registration failed');
  journal.note('CPP_INIT_ENTER');
  if (!module._eh_init(context, canvas.width, canvas.height)) throw new Error('Estella init failed');
  journal.note('CPP_INIT_RETURN');
  let frame = null, previous = null, hidden = false, stopped = false, frames = 0;
  const tick = time => {
    frame = null;
    if (hidden || stopped) return;
    try {
      if (gl.isContextLost?.()) throw new Error('WebGL context lost');
      const dt = previous === null ? 0 : Math.max(0, Math.min(.25, (time - previous) / 1000));
      previous = time;
      if (!module._eh_frame(dt)) throw new Error('Estella frame failed');
      if (++frames === 1) journal.note('FIRST_FRAME_RETURN');
      if (frames === 120) journal.stable();
      frame = requestAnimationFrame(tick);
    } catch (error) { stopped = true; journal.fail(error); }
  };
  wx.onHide(() => { hidden = true; previous = null; if (frame !== null) cancelAnimationFrame(frame); frame = null; });
  wx.onShow(() => { hidden = false; previous = null; if (!stopped && frame === null) frame = requestAnimationFrame(tick); });
  wx.onTouchStart(() => { if (!stopped && !hidden) module._eh_touch(); });
  wx.onWindowResize(() => {
    Object.assign(canvas, dimensions());
    if (!module._eh_resize(canvas.width, canvas.height)) { stopped = true; journal.fail('resize failed'); }
  });
  frame = requestAnimationFrame(tick);
  journal.note('ESTELLA_HELLO_READY', config.buildId, 'C++ core / WebGL2 / no SDL / no TS SDK');
}
start().catch(error => { console.error(error?.stack || error); journal.fail(error); });
