// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rulesAsset.ts
 * @brief   World rules as a project file (`.esworld`): biomes, recipes and layers as data, which artists and designers edit and a
 *          package carries with every mesh and material they name.
 *
 * @details The file is the rules' JSON: what `registerWorldRules` takes, less the fields made by code (a game's own fields stay in
 *          code). Meshes and materials are named by their project paths, so the cook follows them from the file as it follows a
 *          material's textures. A file that does not say what rules need is refused with where it went wrong, rather than laying out
 *          a world from half of it.
 */
import type { AssetLoader, LoadContext } from '../asset/AssetLoader';
import type { BiomeDef, PlacementLayer, Recipe, RecipeMember, WorldRules } from './rules';

/** Whether a WorldGen's `rules` names a file rather than rules registered by code. */
export function isRulesFile(ref: string): boolean {
    return ref.endsWith('.esworld') || ref.startsWith('@uuid:');
}

const fail = (where: string, what: string): never => { throw new Error(`${where}: ${what}`); };

function num(v: unknown, where: string, min = -Infinity): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(where, `a number${min > -Infinity ? ` of at least ${min}` : ''}, not ${JSON.stringify(v)}`);
    return v as number;
}

function str(v: unknown, where: string): string {
    if (typeof v !== 'string' || v.length === 0) fail(where, `a name, not ${JSON.stringify(v)}`);
    return v as string;
}

function range(v: unknown, where: string): [number, number] | undefined {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length !== 2) fail(where, 'two numbers, [least, most]');
    const a = num((v as unknown[])[0], where), b = num((v as unknown[])[1], where);
    if (b < a) fail(where, 'the least is more than the most');
    return [a, b];
}

function member(v: unknown, where: string): RecipeMember {
    if (!v || typeof v !== 'object') fail(where, 'a member, an object');
    const m = v as Record<string, unknown>;
    const mesh = m.mesh;
    if (typeof mesh !== 'string' && typeof mesh !== 'number') fail(`${where}.mesh`, 'a mesh path');
    return {
        ...(m as object),
        id: str(m.id, `${where}.id`),
        mesh: mesh as string | number,
        footprint: num(m.footprint, `${where}.footprint`, 0),
        count: range(m.count, `${where}.count`),
        ring: range(m.ring, `${where}.ring`),
        arc: range(m.arc, `${where}.arc`),
        scale: range(m.scale, `${where}.scale`),
    } as RecipeMember;
}

/** Rules from a file's JSON, checked; throws naming the first thing a world could not be laid out from. */
export function parseWorldRules(json: unknown, file = 'world rules'): WorldRules {
    if (!json || typeof json !== 'object') fail(file, 'an object');
    const r = json as Record<string, unknown>;
    const id = str(r.id, `${file}.id`);
    if (!Array.isArray(r.versions) || r.versions.length === 0) fail(`${file}.versions`, 'the versions it can make, at least one');
    const versions = (r.versions as unknown[]).map((v, i) => num(v, `${file}.versions[${i}]`, 1));
    if (!Array.isArray(r.recipes)) fail(`${file}.recipes`, 'a list');
    const recipes: Recipe[] = (r.recipes as unknown[]).map((v, i) => {
        const where = `${file}.recipes[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        return {
            ...(o as object),
            id: str(o.id, `${where}.id`), version: num(o.version, `${where}.version`, 1),
            anchor: member(o.anchor, `${where}.anchor`),
            members: Array.isArray(o.members) ? (o.members as unknown[]).map((m, k) => member(m, `${where}.members[${k}]`)) : undefined,
        } as Recipe;
    });
    if (!Array.isArray(r.layers) || r.layers.length === 0) fail(`${file}.layers`, 'at least one layer');
    const layers: PlacementLayer[] = (r.layers as unknown[]).map((v, i) => {
        const where = `${file}.layers[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        return {
            ...(o as object),
            id: str(o.id, `${where}.id`), spacing: num(o.spacing, `${where}.spacing`, 1e-6), drawDistance: num(o.drawDistance, `${where}.drawDistance`, 0),
        } as PlacementLayer;
    });
    const recipeIds = new Set(recipes.map((x) => x.id)), layerIds = new Set(layers.map((x) => x.id));
    if (!Array.isArray(r.biomes)) fail(`${file}.biomes`, 'a list');
    const biomes: BiomeDef[] = (r.biomes as unknown[]).map((v, i) => {
        const where = `${file}.biomes[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.conditions)) fail(`${where}.conditions`, 'a list (empty holds everywhere)');
        if (!Array.isArray(o.recipes)) fail(`${where}.recipes`, 'a list');
        for (const [k, br] of (o.recipes as Record<string, unknown>[]).entries()) {
            if (!recipeIds.has(br.recipe as string)) fail(`${where}.recipes[${k}].recipe`, `no recipe ${JSON.stringify(br.recipe)} in the file`);
            if (!layerIds.has(br.layer as string)) fail(`${where}.recipes[${k}].layer`, `no layer ${JSON.stringify(br.layer)} in the file`);
            num(br.density, `${where}.recipes[${k}].density`, 0);
        }
        return { ...(o as object), id: str(o.id, `${where}.id`) } as BiomeDef;
    });
    return { id, versions, biomes, recipes, layers, ...(r.noise ? { noise: r.noise as WorldRules['noise'] } : {}) };
}

/** Loads `.esworld` files as checked world rules. */
export class WorldRulesAssetLoader implements AssetLoader<WorldRules> {
    readonly type = 'world-rules';
    readonly extensions = ['.esworld'];

    async load(path: string, ctx: LoadContext): Promise<WorldRules> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        return parseWorldRules(JSON.parse(text), path);
    }

    unload(): void {
        // Rules are plain data; the meshes they name are loaded and held by the world that lays them out.
    }
}
