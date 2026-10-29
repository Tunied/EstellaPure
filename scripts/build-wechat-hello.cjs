#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : path.resolve(process.argv[i + 1]); };
const sdk = arg('--sdk', '/Users/eran/WorkGround/OldKingStudio/CopyEngineAI/.tools/emsdk');
const template = arg('--template', '/Users/eran/WorkGround/OldKingStudio/CopyEngineAI/release/wechat/Template');
const build = path.join(root, 'build/wechat-hello');
const release = path.join(root, 'release/wechat');
const output = path.join(release, 'DevBuild');
const staging = path.join(release, `.hello-${randomUUID()}`);
const env = { ...process.env, EMSDK: sdk, EM_CONFIG: path.join(sdk, '.emscripten'),
  EM_CACHE: path.join(root, 'build/emscripten-cache'), EMCC_CORES: '2', BINARYEN_CORES: '2' };
// Reuse the installed toolchain without writing its cache or altering its config.
env.PATH = [path.join(sdk, 'upstream/emscripten'), ...fs.readdirSync(path.join(sdk, 'node')).filter(n => fs.existsSync(path.join(sdk, 'node', n, 'bin/node'))).map(n => path.join(sdk, 'node', n, 'bin')), env.PATH].join(path.delimiter);
const cmake = ['/opt/homebrew/bin/cmake', '/usr/local/bin/cmake', '/Users/eran/WorkGround/OldKingStudio/CopyEngineAI/.tools/python/cmake/data/bin/cmake'].find(fs.existsSync) || 'cmake';
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} exited ${r.status ?? r.signal}`);
}
try {
  const project = JSON.parse(fs.readFileSync(path.join(template, 'project.config.json'), 'utf8'));
  if (!/^wx[0-9a-f]{16}$/i.test(project.appid)) throw new Error('Template AppID required');
  if (!fs.existsSync(path.join(root, 'third_party/glm/glm/glm.hpp'))) throw new Error('Run git submodule update --init --depth 1 -- third_party/glm');
  run(cmake, ['-S', 'examples/wechat_hello', '-B', build, '-G', 'Unix Makefiles',
    `-DCMAKE_TOOLCHAIN_FILE=${sdk}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`, '-DCMAKE_BUILD_TYPE=MinSizeRel']);
  run(cmake, ['--build', build, '--target', 'estella_hello', '--parallel', '2']);
  fs.mkdirSync(path.join(staging, 'wasm'), { recursive: true });
  for (const name of ['estella-hello.js', 'estella-hello.wasm']) fs.copyFileSync(path.join(build, 'bin', name), path.join(staging, 'wasm', name));
  for (const name of ['game.js', 'boot-journal.js']) fs.copyFileSync(path.join(root, 'examples/wechat_hello', name), path.join(staging, name));
  const wasm = fs.readFileSync(path.join(staging, 'wasm/estella-hello.wasm'));
  const sha = createHash('sha256').update(wasm).digest('hex');
  const hash = createHash('sha256');
  for (const file of ['wasm/estella-hello.wasm', 'wasm/estella-hello.js', 'game.js', 'boot-journal.js']) hash.update(fs.readFileSync(path.join(staging, file)));
  const config = { buildId: `estella-hello-${hash.digest('hex').slice(0, 12)}`, wasmSha256: sha,
    sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() };
  fs.writeFileSync(path.join(staging, 'game-config.js'), `module.exports = ${JSON.stringify(config, null, 2)};\n`);
  Object.assign(project, { projectname: 'EstellaPure-HelloWorld', compileType: 'game', miniprogramRoot: './', packOptions: { ignore: [], include: [] } });
  fs.writeFileSync(path.join(staging, 'project.config.json'), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(staging, 'game.json'), JSON.stringify({ deviceOrientation: 'portrait', showStatusBar: false }, null, 2));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
  run(process.execPath, [path.join(root, 'scripts/check-wechat-hello.cjs'), staging]);
  const old = path.join(release, `.previous-${randomUUID()}`);
  const hadPrevious = fs.existsSync(output);
  if (hadPrevious) fs.renameSync(output, old);
  try { fs.renameSync(staging, output); }
  catch (error) { if (hadPrevious) fs.renameSync(old, output); throw error; }
  if (hadPrevious) fs.rmSync(old, { recursive: true, force: true });
  console.log('ESTELLA_WECHAT_BUILD_OK', output, config.buildId, `${wasm.length} bytes`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { fs.rmSync(staging, { recursive: true, force: true }); }
