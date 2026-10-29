'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function check(directory) {
  const binary = fs.readFileSync(path.join(directory, 'wasm/estella-hello.wasm'));
  const context = vm.createContext({ console, setTimeout, clearTimeout, WebAssembly, module: { exports: {} }, exports: {},
    wx: { getPerformance: () => ({ now: () => performance.now() * 1000 }) } });
  vm.runInContext(fs.readFileSync(path.join(directory, 'wasm/estella-hello.js'), 'utf8'), context);
  const instance = await context.module.exports({ instantiateWasm(imports, receive) {
    WebAssembly.instantiate(binary, imports).then(r => receive(r.instance, r.module)); return {};
  } });
  for (const name of ['init', 'frame', 'resize', 'touch', 'shutdown', 'heap_bytes']) assert.equal(typeof instance[`_eh_${name}`], 'function');
  assert.equal(instance._eh_init(0, 0, 0), 0);
  assert.equal(instance._eh_frame(0), 0);
  assert.equal(instance._eh_resize(0, 1), 0);
  assert.equal(instance._eh_heap_bytes(), 33554432);
  instance._eh_shutdown();
  const project = JSON.parse(fs.readFileSync(path.join(directory, 'project.config.json')));
  assert.equal(project.compileType, 'game');
  new vm.Script(fs.readFileSync(path.join(directory, 'game.js'), 'utf8'));
  console.log('ESTELLA_HELLO_CHECK_OK real WASM, C ABI, 32MiB heap, package; GPU requires device/runtime verification');
}
check(path.resolve(process.argv[2] || path.join(__dirname, '../release/wechat/DevBuild'))).catch(e => { console.error(e); process.exitCode = 1; });
