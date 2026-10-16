// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Six square images become a panorama that points every face the way a viewer standing
 * inside the box sees it, and a set that cannot be read says which face is wrong.
 */
import { describe, it, expect } from 'vitest';
import {
    cubeFacesToPanorama, validateCubeFaces, parseCubeSource, CubeImportError, CUBE_FACE_NAMES,
    type CubeFace, type CubeFaceSet, type CubeFaceName,
} from '../src/assets/environmentCube';
import {
    samplePanorama, importEnvironmentFromPanorama, ENV_MAX_FACE_SIZE, type Panorama,
} from '../src/assets/environmentImport';

const N = 32;

function face(fill: [number, number, number], mark?: (x: number, y: number) => boolean, extra: Partial<CubeFace> = {}): CubeFace {
    const rgba = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const on = mark?.(x, y) ?? false;
            const o = (y * N + x) * 4;
            rgba[o] = on ? 255 : fill[0]; rgba[o + 1] = on ? 255 : fill[1]; rgba[o + 2] = on ? 255 : fill[2]; rgba[o + 3] = 255;
        }
    }
    return { width: N, height: N, rgba, ...extra };
}

const FILLS: Record<CubeFaceName, [number, number, number]> = {
    px: [200, 0, 0], nx: [100, 0, 0], py: [0, 200, 0], ny: [0, 100, 0], pz: [0, 0, 200], nz: [0, 0, 100],
};
const solid = (): CubeFaceSet => Object.fromEntries(CUBE_FACE_NAMES.map((n) => [n, face(FILLS[n])])) as CubeFaceSet;
const topRight = (x: number, y: number): boolean => x >= N - 6 && y < 6;

function at(p: Panorama, x: number, y: number, z: number): number[] {
    const l = Math.hypot(x, y, z);
    const out = new Float32Array(3);
    samplePanorama(p, x / l, y / l, z / l, out);
    return [...out];
}
const bright = (c: number[]): boolean => c[0]! > 0.9 && c[1]! > 0.9 && c[2]! > 0.9;

describe('six faces as a panorama', () => {
    it('puts each face on the axis it is named for', () => {
        const p = cubeFacesToPanorama(solid());
        expect(p.width).toBe(N * 4);
        expect(p.height).toBe(N * 2);
        const dominant = (c: number[]): number => c.indexOf(Math.max(...c));
        expect(dominant(at(p, 1, 0, 0))).toBe(0);
        expect(dominant(at(p, 0, 1, 0))).toBe(1);
        expect(dominant(at(p, 0, 0, 1))).toBe(2);
        // +X is the brighter red (200 against 100), and likewise for the other two axes.
        expect(at(p, 1, 0, 0)[0]!).toBeGreaterThan(at(p, -1, 0, 0)[0]!);
        expect(at(p, 0, 1, 0)[1]!).toBeGreaterThan(at(p, 0, -1, 0)[1]!);
        expect(at(p, 0, 0, 1)[2]!).toBeGreaterThan(at(p, 0, 0, -1)[2]!);
    });

    it('linearizes sRGB faces, and leaves linear ones alone', () => {
        const s = cubeFacesToPanorama(solid(), 'srgb');
        const l = cubeFacesToPanorama(solid(), 'linear');
        expect(at(s, 1, 0, 0)[0]!).toBeCloseTo(Math.pow((200 / 255 + 0.055) / 1.055, 2.4), 2);
        expect(at(l, 1, 0, 0)[0]!).toBeCloseTo(200 / 255, 2);
    });

    it('reads a face as a viewer inside the box does: facing +Z, right is -X', () => {
        const faces = solid();
        faces.pz = face(FILLS.pz, topRight);
        const p = cubeFacesToPanorama(faces);
        expect(bright(at(p, -0.7, 0.7, 1))).toBe(true);
        expect(bright(at(p, 0.7, 0.7, 1))).toBe(false);
        expect(bright(at(p, -0.7, -0.7, 1))).toBe(false);
    });

    it('reads the side faces and a pole with their tops toward the sky and the front', () => {
        const faces = solid();
        faces.nz = face(FILLS.nz, topRight);   // facing -Z: right is +X
        faces.px = face(FILLS.px, topRight);   // facing +X: right is +Z
        faces.py = face(FILLS.py, topRight);   // looking up, top toward -Z, right is +X
        const p = cubeFacesToPanorama(faces);
        expect(bright(at(p, 0.7, 0.7, -1))).toBe(true);
        expect(bright(at(p, -0.7, 0.7, -1))).toBe(false);
        expect(bright(at(p, 1, 0.7, 0.7))).toBe(true);
        expect(bright(at(p, 1, 0.7, -0.7))).toBe(false);
        expect(bright(at(p, 0.7, 1, -0.7))).toBe(true);
        expect(bright(at(p, 0.7, 1, 0.7))).toBe(false);
    });

    it('turns and mirrors one face without touching the others', () => {
        const turned = solid(); turned.pz = face(FILLS.pz, topRight, { rotate: 90 });
        const mirrored = solid(); mirrored.pz = face(FILLS.pz, topRight, { flip: true });
        // Top right turned clockwise lands bottom right; mirrored it lands top left.
        const t = cubeFacesToPanorama(turned);
        expect(bright(at(t, -0.7, -0.7, 1))).toBe(true);
        expect(bright(at(t, -0.7, 0.7, 1))).toBe(false);
        const m = cubeFacesToPanorama(mirrored);
        expect(bright(at(m, 0.7, 0.7, 1))).toBe(true);
        expect(bright(at(m, -0.7, 0.7, 1))).toBe(false);
        expect(at(m, 0, 0, -1)[2]!).toBeGreaterThan(0);
    });
});

describe('a face set that cannot be imported', () => {
    const fails = (faces: CubeFaceSet): CubeImportError => {
        try { validateCubeFaces(faces); } catch (e) { return e as CubeImportError; }
        throw new Error('expected the set to be refused');
    };

    it('names every missing face rather than filling one with black', () => {
        const faces = solid(); delete faces.ny; delete faces.nz;
        const e = fails(faces);
        expect(e.message).toBe('missing faces -Y, -Z');
        expect(e.face).toBe('ny');
    });

    it('names a face that is not square', () => {
        const faces = solid();
        faces.py = { width: 32, height: 16, rgba: new Uint8Array(32 * 16 * 4) };
        const e = fails(faces);
        expect(e.message).toContain('+Y');
        expect(e.message).toContain('not square');
        expect(e.face).toBe('py');
    });

    it('names the face whose size differs from the rest', () => {
        const faces = solid();
        faces.nx = { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) };
        const e = fails(faces);
        expect(e.face).toBe('nx');
        expect(e.message).toMatch(/-X is 16px but \+X is 32px/);
    });

    it('refuses a face whose bytes are not its size', () => {
        const faces = solid();
        faces.pz = { width: 32, height: 32, rgba: new Uint8Array(10) };
        expect(fails(faces).face).toBe('pz');
    });
});

describe('an imported panorama reports what it cost and what it clipped', () => {
    const flat = (value: number): Panorama => {
        const width = 64, height = 32;
        return { width, height, rgb: new Float32Array(width * height * 3).fill(value) };
    };

    it('says nothing is clipped for a source inside the stored range', () => {
        const r = importEnvironmentFromPanorama(flat(0.5), 'dim', { faceSize: 16, skyWidth: 64 });
        expect(r.report.clippedFraction).toBe(0);
        expect(r.warnings).toEqual([]);
        expect(r.report.faceSize).toBe(16);
        expect(r.report.skyWidth).toBe(64);
        expect(r.report.atlasBytes).toBe(r.atlasBytes.length);
        expect(r.report.skyBytes).toBe(r.sky!.bytes.length);
    });

    it('measures the share of texels past the range, and the peak, apart from a dim exposure', () => {
        const p = flat(0.5);
        for (let i = 0; i < 64 * 4; i++) p.rgb[i * 3] = 50;      // 4 of the 32 rows are far over the range
        const r = importEnvironmentFromPanorama(p, 'hot', { faceSize: 16, skyWidth: 0 });
        expect(r.report.peak).toBe(50);
        expect(r.report.clippedFraction).toBeCloseTo(4 / 32, 5);
        expect(r.warnings.join(' ')).toMatch(/brighter than the 8/);
        expect(r.sky).toBeNull();
        expect(r.report.skyBytes).toBe(0);
    });

    it('refuses to be asked for more than an import allows, and says so', () => {
        const r = importEnvironmentFromPanorama(flat(0.5), 'huge', { faceSize: ENV_MAX_FACE_SIZE * 4, mipCount: 1, skyWidth: 0 });
        expect(r.report.faceSize).toBe(ENV_MAX_FACE_SIZE);
        expect(r.warnings.join(' ')).toMatch(/past the 1024/);
    }, 120000);
});

describe('a cube source document', () => {
    const good = (): Record<string, unknown> => ({
        version: 1, colorSpace: 'linear',
        faces: { px: { file: 'sky/px.png', rotate: 90, flip: true }, nx: { file: 'sky/nx.png' } },
    });
    const refused = (raw: unknown): CubeImportError => {
        try { parseCubeSource(raw); } catch (e) { return e as CubeImportError; }
        throw new Error('expected the document to be refused');
    };

    it('reads the faces, their turns and the colour space, and allows an unfinished set', () => {
        const doc = parseCubeSource(good());
        expect(doc.colorSpace).toBe('linear');
        expect(doc.faces.px).toEqual({ file: 'sky/px.png', rotate: 90, flip: true });
        expect(doc.faces.nx).toEqual({ file: 'sky/nx.png' });
        expect(doc.faces.pz).toBeUndefined();
    });

    it('refuses a document it cannot mean, naming the face where there is one', () => {
        expect(refused({ version: 2, faces: {} }).message).toMatch(/version 2/);
        expect(refused({ version: 1, faces: [] }).message).toMatch(/under "faces"/);
        expect(refused({ version: 1, colorSpace: 'p3', faces: {} }).message).toMatch(/colorSpace/);
        expect(refused({ version: 1, faces: { up: { file: 'a.png' } } }).message).toMatch(/"up" is not a face/);
        expect(refused({ version: 1, faces: { py: { file: '' } } }).face).toBe('py');
        expect(refused({ version: 1, faces: { ny: { file: 'a.png', rotate: 45 } } }).face).toBe('ny');
        expect(refused({ version: 1, faces: { nz: { file: 'a.png', flip: 'yes' } } }).face).toBe('nz');
        expect(refused('nope').message).toMatch(/JSON object/);
    });
});
