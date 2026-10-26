// Bundles the worlds' planning worker (src/worldgen/planWorker.ts) into the text the engine starts its workers from, and writes it as a module:
//   node scripts/build-worker.mjs [--check]
// `--check` writes nothing and exits 1 when the committed text is not what the source makes now.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { workerModule } from './worker-source.mjs';

const { path, source, bytes } = await workerModule();
if (process.argv.includes('--check')) {
  if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== source) { console.error('planWorkerBundle.generated.ts is not what src/worldgen/planWorker.ts makes now: run node scripts/build-worker.mjs'); process.exit(1); }
  console.log('planWorkerBundle.generated.ts is current');
} else {
  writeFileSync(path, source);
  console.log(`planWorkerBundle.generated.ts: ${bytes} bytes of worker`);
}
