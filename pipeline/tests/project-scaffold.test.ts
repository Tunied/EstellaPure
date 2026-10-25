// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A new project made from a template: the one implementation the editor's gallery and the command line's `create` share.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFromTemplate, listTemplates, npmPackageName } from '../src/project/scaffold';

let dir = '';
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'estella-scaffold-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

const template = (root: string, id: string, manifest: object | string): string => {
    const t = path.join(root, id);
    mkdirSync(path.join(t, 'src'), { recursive: true });
    writeFileSync(path.join(t, 'project.esproject'), typeof manifest === 'string' ? manifest : JSON.stringify({ formatVersion: '1', name: id, ...manifest }));
    writeFileSync(path.join(t, 'src/main.ts'), 'export {};\n');
    return t;
};

describe('listing templates', () => {
    it('lists the projects under each root in order, and does not list a name twice', async () => {
        const starters = path.join(dir, 'starters'), examples = path.join(dir, 'examples');
        template(starters, 'blank', { description: 'Nothing.', tag: 'Starter' });
        template(examples, 'blank', { description: 'Shadowed.' });
        template(examples, 'bistro', { description: 'A street.' });
        mkdirSync(path.join(examples, 'not-a-project'));
        const found = await listTemplates([{ root: starters, kind: 'starter' }, { root: examples, kind: 'example' }, { root: path.join(dir, 'missing'), kind: 'example' }]);
        expect(found.map((t) => [path.basename(t.dir), t.kind, t.description])).toEqual([['blank', 'starter', 'Nothing.'], ['bistro', 'example', 'A street.']]);
    });

    it('lists a project whose manifest cannot be read, by its folder\'s name', async () => {
        const root = path.join(dir, 'starters');
        template(root, 'broken', '{ not json');
        expect((await listTemplates([{ root, kind: 'starter' }])).map((t) => t.name)).toEqual(['broken']);
    });
});

describe('creating a project', () => {
    it('copies the template, names the manifest, and writes the files every project has', async () => {
        const t = template(path.join(dir, 'starters'), 'blank', {});
        const root = await createFromTemplate(t, path.join(dir, 'games'), 'my-game', 'My Game');
        expect(root).toBe(path.join(dir, 'games', 'my-game'));
        expect(JSON.parse(readFileSync(path.join(root, 'project.esproject'), 'utf8')).name).toBe('My Game');
        expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name).toBe('my-game');
        expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('dist-*/');
        expect(existsSync(path.join(root, 'src/main.ts'))).toBe(true);
    });

    it('names the project after its folder unless told otherwise, and leaves transient state behind', async () => {
        const t = template(path.join(dir, 'starters'), 'blank', {});
        mkdirSync(path.join(t, '.esengine'));
        mkdirSync(path.join(t, 'node_modules'));
        const root = await createFromTemplate(t, path.join(dir, 'games'), 'plain');
        expect(JSON.parse(readFileSync(path.join(root, 'project.esproject'), 'utf8')).name).toBe('plain');
        expect(existsSync(path.join(root, '.esengine'))).toBe(false);
        expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
    });

    it('refuses a folder that is already there', async () => {
        const t = template(path.join(dir, 'starters'), 'blank', {});
        await createFromTemplate(t, path.join(dir, 'games'), 'taken');
        await expect(createFromTemplate(t, path.join(dir, 'games'), 'taken')).rejects.toThrow(/already exists/);
    });
});

describe('package names', () => {
    it('are npm-legal whatever the project is called', () => {
        expect(npmPackageName('My Game')).toBe('my-game');
        expect(npmPackageName('星邻')).toBe('estella-game');
    });
});
