import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { transcoderFromModule, type BasisWasmModule } from '../src/asset/basisTranscoder';
import { hasSideModule, loadSideModule } from './helpers/loadWasm';

describe.skipIf(!hasSideModule('basis'))('repro', () => {
  it('matrix', async () => {
    const transcoder = transcoderFromModule(await loadSideModule<BasisWasmModule>('basis'));
    const encoder = await import(path.join('D:/estella', 'build-tools/basis/encoder.mjs'));
    const png = new Uint8Array(readFileSync('D:/estella/examples/bistro/assets/models/Vespa_Headlight_BaseColor.png'));
    const rgba = new Uint8Array(16 * 16 * 4).map((_, i) => (i * 37) & 0xff);
    const cases: [string, any, any][] = [
      ['rgba uastc nomips', { type: encoder.ImageType.RGBA, data: rgba, width: 16, height: 16 }, { mode: 'uastc', mipmaps: false }],
      ['rgba uastc mips', { type: encoder.ImageType.RGBA, data: rgba, width: 16, height: 16 }, { mode: 'uastc', mipmaps: true }],
      ['rgba uastc mips zstd', { type: encoder.ImageType.RGBA, data: rgba, width: 16, height: 16 }, { mode: 'uastc', mipmaps: true, supercompress: true }],
      ['png uastc mips zstd', { type: encoder.ImageType.PNG, data: png }, { mode: 'uastc', mipmaps: true, supercompress: true, srgb: true }],
      ['png uastc mips', { type: encoder.ImageType.PNG, data: png }, { mode: 'uastc', mipmaps: true, srgb: true }],
      ['png uastc nomips', { type: encoder.ImageType.PNG, data: png }, { mode: 'uastc', mipmaps: false, srgb: true }],
      ['png etc1s mips', { type: encoder.ImageType.PNG, data: png }, { mode: 'etc1s', mipmaps: true, srgb: true }],
    ];
    for (const [label, img, opts] of cases) {
      try {
        const k = await encoder.encodeToKtx2(img, opts);
        const r = await transcoder.transcodeToRgba(k);
        console.log(label, k.length, 'rgba', !!r);
      } catch (e) { console.log(label, 'ENCODE THREW', String(e).slice(0, 100)); }
    }
  }, 120000);
});
