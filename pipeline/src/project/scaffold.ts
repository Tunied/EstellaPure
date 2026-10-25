// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Making a new project out of a template: the files every project gets, and the copy.
 *
 *        One implementation for the editor's New Project gallery and the command line's `create`, because two would
 *        disagree about what a fresh project holds. The scaffold files are generated at creation rather than kept in
 *        each template, because there are forty-odd templates (the blank starters and every example) and a copy in
 *        each is a copy that drifts: the blank one's `.gitignore` listed `dist/` while every export writes
 *        `dist-<platform>/`, so a packaged game landed in git.
 *
 *        `package.json` is here because a project's scripts are bundled with esbuild, which resolves npm dependencies
 *        out of the project's own `node_modules`: `npm install <a-library>` works and the library ships with the game,
 *        on every target. Without a package.json that starts with an `npm init` nobody would guess is a prerequisite.
 *
 *        Pure Node (fs), no electron, so it runs under the command line and under test.
 */
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_MANIFEST_FILE, isTransientProjectPath, parseManifest, type TemplateEntry } from './format';

/**
 * An npm-legal package name from a project's display name: "My Game" is a fine project name and an illegal package name.
 * A name with nothing legal in it still yields an installable one.
 */
export function npmPackageName(displayName: string): string {
    const slug = displayName
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '')
        .slice(0, 214);
    return slug || 'estella-game';
}

export const PROJECT_GITIGNORE = `node_modules/

# Export output — the Package dialog writes dist-<platform>/ per target.
dist/
dist-*/

# Editor-managed staging: the SDK types mirror, the play-realm build and the
# workspace are regenerated every time the editor opens the project. What the
# project itself keeps there (its plugins and packaging profiles) is versioned
# with it, so only the generated parts are left out.
.esengine/*
!.esengine/plugins/
.esengine/plugins/.types/
!.esengine/platforms/

.vscode/
.idea/
.DS_Store
Thumbs.db
`;

/**
 * Write the scaffold into an already-created project directory.
 *
 * Existing files are left alone: a template that ships its own on purpose keeps
 * it, and running this over a project twice changes nothing.
 */
export async function scaffoldProjectFiles(dest: string, name: string): Promise<void> {
    const packageJson = path.join(dest, 'package.json');
    if (!existsSync(packageJson)) {
        // `private` so an accidental `npm publish` cannot reach the registry; `type: module` to match the tsconfig's ESM.
        // No dependencies or scripts: the editor builds the project, and npm is here so installing a library works.
        await writeFile(packageJson, `${JSON.stringify({
            name: npmPackageName(name),
            version: '0.0.0',
            private: true,
            type: 'module',
        }, null, 2)}\n`);
    }
    const gitignore = path.join(dest, '.gitignore');
    if (!existsSync(gitignore)) await writeFile(gitignore, PROJECT_GITIGNORE);
}

/** A directory of templates and the gallery group its entries belong to. */
export interface TemplateRoot {
    root: string;
    kind: TemplateEntry['kind'];
}

/**
 * Every project directly under the roots, in the roots' order. A name a root listed first is not listed again by a later one, so an
 * example never shadows the starter of the same name. An entry whose manifest cannot be read is still listed, by its folder's name.
 */
export async function listTemplates(roots: readonly TemplateRoot[]): Promise<TemplateEntry[]> {
    const out: TemplateEntry[] = [];
    const seen = new Set<string>();
    for (const { root, kind } of roots) {
        if (!existsSync(root)) continue;
        for (const entry of await readdir(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || seen.has(entry.name)) continue;
            const dir = path.join(root, entry.name);
            if (!existsSync(path.join(dir, PROJECT_MANIFEST_FILE))) continue;
            seen.add(entry.name);
            let name = entry.name, description: string | undefined, tag: string | undefined;
            try {
                const m = parseManifest(JSON.parse(await readFile(path.join(dir, PROJECT_MANIFEST_FILE), 'utf8')));
                name = m.name;
                description = m.description;
                tag = m.tag;
            } catch {
                // listed by its folder's name
            }
            out.push({ name, dir, kind, description, tag });
        }
    }
    return out;
}

/**
 * Copies a template into the folder `<location>/<name>`, stamps the manifest with `displayName` (the folder's name unless said) and writes the
 * scaffold; returns the new root.
 * Transient state (`.esengine` staging, node_modules and the like) stays behind.
 */
export async function createFromTemplate(templateDir: string, location: string, name: string, displayName = name): Promise<string> {
    const dest = path.join(location, name);
    if (existsSync(dest)) throw new Error(`a folder already exists at ${dest}`);
    await cp(templateDir, dest, {
        recursive: true,
        filter: (src) => !isTransientProjectPath(path.relative(templateDir, src)),
    });
    const manifestPath = path.join(dest, PROJECT_MANIFEST_FILE);
    const m = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    m.name = displayName;
    await writeFile(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
    await scaffoldProjectFiles(dest, displayName);
    return dest;
}
