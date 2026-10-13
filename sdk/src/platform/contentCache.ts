// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PlatformAdapter } from './types';
import { cacheEntryName } from './cacheEntryName';
import { contentHashHex } from '../asset/contentHash';
import { encodeUtf8, decodeUtf8 } from '../util/utf8';

const INDEX_KEY = 'estella:content-cache:index:v1';
const INDEX_NAME = cacheEntryName(INDEX_KEY);
export type CacheProtection = 'current' | 'pending' | 'rollback' | 'retained';
export interface CacheVersion {
    revision: string;
    reason: CacheProtection | null;
    keys: string[];
}
interface Entry {
    name: string;
    key?: string;
    hash?: string;
    size: number;
    lastAccess: number;
}
interface Index {
    schema: 1;
    entries: Entry[];
    owners: Record<string, CacheVersion[]>;
}
export interface ContentCacheEntry extends Entry {
    versions: string[];
    protection: string[];
}
export interface ContentCacheReport {
    /** The Assets service issuing this report, when supplied by that service. */
    owner?: string;
    capability: 'managed' | 'storage-only' | 'unavailable';
    /** Resource bytes only; index bytes are reported separately. Null is unknown. */
    usedBytes: number | null;
    indexBytes: number | null;
    protectedBytes: number | null;
    reclaimableBytes: number | null;
    entries: ContentCacheEntry[];
    versions: { owner: string; revision: string; reason: CacheProtection | null; missing: number; retained: boolean }[];
}
export interface CacheCleanupPreview {
    report: ContentCacheReport;
    budgetBytes: number;
    candidates: string[];
    releaseBytes: number;
    remainingBytes: number | null;
    budgetMet: boolean | null;
}
export interface CacheCleanupResult extends CacheCleanupPreview {
    removed: string[];
    failed: string[];
    /** Cleanup can free a full disk even when updating its index is refused.
     * The next scan reconciles those successful deletions. */
    indexPersisted?: boolean;
}

/** One coordinator per adapter: byte IO, index changes and eviction share a
 * queue. A cleaner cannot unlink a read/write in flight. Unknown legacy files
 * stay protected until a verified write establishes their resource identity. */
export class ContentCache {
    private chain_: Promise<unknown> = Promise.resolve();
    private index_: Index | null = null;
    private indexBytes_ = 0;
    constructor(private readonly platform_: PlatformAdapter) {}

    capability(): ContentCacheReport['capability'] {
        const p = this.platform_;
        if (!p.readCacheFile || !p.writeCacheFile || p.hasCacheStorage?.() === false) return 'unavailable';
        return p.listCacheFiles && p.removeCacheFile && p.canManageCache?.() !== false ? 'managed' : 'storage-only';
    }

    private run_<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.chain_.then(fn);
        this.chain_ = result.catch(() => {});
        return result;
    }

    private async load_(): Promise<Index> {
        if (this.index_) return this.index_;
        const bytes = await this.platform_.readCacheFile!(INDEX_KEY);
        if (bytes) {
            try {
                const parsed = JSON.parse(decodeUtf8(new Uint8Array(bytes))) as Index;
                if (parsed.schema !== 1 || !Array.isArray(parsed.entries) || !parsed.owners
                    || !parsed.entries.every(e => /^[0-9a-f]{16}(?:\.\d+\.tmp)?$/.test(e.name)
                        && Number.isFinite(e.size) && e.size >= 0 && Number.isFinite(e.lastAccess)
                        && (e.key === undefined || (typeof e.key === 'string' && cacheEntryName(e.key) === e.name)))
                    || !Object.values(parsed.owners).every(v => Array.isArray(v) && v.every(x =>
                        typeof x.revision === 'string' && Array.isArray(x.keys) && x.keys.every(k => typeof k === 'string')
                        && [null, 'current', 'pending', 'rollback', 'retained'].includes(x.reason)))) throw Error('invalid index');
                this.index_ = parsed;
                this.indexBytes_ = bytes.byteLength;
                return parsed;
            } catch { /* Crash/corruption: rescan conservatively; never infer ownership. */ }
        }
        return this.index_ = { schema: 1, entries: [], owners: {} };
    }

    private async save_(): Promise<void> {
        const bytes = encodeUtf8(JSON.stringify(this.index_));
        await this.platform_.writeCacheFile!(INDEX_KEY, bytes.buffer as ArrayBuffer);
        this.indexBytes_ = bytes.byteLength;
    }

    async read(key: string): Promise<ArrayBuffer | null> {
        if (this.capability() !== 'managed') return this.platform_.readCacheFile!(key);
        return this.run_(async () => {
            const index = await this.load_();
            const bytes = await this.platform_.readCacheFile!(key);
            const entry = index.entries.find(e => e.name === cacheEntryName(key));
            if (bytes && entry) {
                entry.lastAccess = Date.now();
                // An access-time write failure must not prevent an offline read.
                await this.save_().catch(() => {});
            }
            return bytes;
        });
    }

    async write(key: string, bytes: ArrayBuffer): Promise<void> {
        if (this.capability() !== 'managed') return this.platform_.writeCacheFile!(key, bytes);
        return this.run_(async () => {
            const index = await this.load_();
            await this.platform_.writeCacheFile!(key, bytes);
            const entry: Entry = { name: cacheEntryName(key), key, hash: contentHashHex(new Uint8Array(bytes)),
                size: bytes.byteLength, lastAccess: Date.now() };
            index.entries = index.entries.filter(e => e.name !== entry.name);
            index.entries.push(entry);
            await this.save_();
        });
    }

    /** Replaces this application's protected versions, preserving historical
     * ownership and other applications sharing the directory. Persists before
     * an updater starts downloading or switches its active manifest. */
    async protect(owner: string, versions: CacheVersion[]): Promise<void> {
        if (this.capability() !== 'managed') return;
        const merged = new Map<string, CacheVersion>();
        const ranks = [null, 'retained', 'rollback', 'pending', 'current'];
        for (const version of versions) {
            const prev = merged.get(version.revision);
            merged.set(version.revision, { revision: version.revision,
                reason: prev && ranks.indexOf(prev.reason) > ranks.indexOf(version.reason) ? prev.reason : version.reason,
                keys: [...new Set([...(prev?.keys ?? []), ...version.keys])] });
        }
        const snapshot = [...merged.values()];
        return this.run_(async () => {
            const index = await this.load_();
            const previous = index.owners[owner] ?? [];
            index.owners[owner] = [...previous.filter(v => !snapshot.some(n => n.revision === v.revision))
                .map(v => ({ ...v, reason: null })), ...snapshot];
            await this.save_();
        });
    }

    private async scan_(repair = false): Promise<void> {
        const index = await this.load_();
        const files = await this.platform_.listCacheFiles!();
        const known = new Map(index.entries.map(e => [e.name, e]));
        index.entries = files.filter(f => f.name !== INDEX_NAME).map(f => ({ ...known.get(f.name), ...f,
            lastAccess: Math.max(known.get(f.name)?.lastAccess ?? 0, f.lastAccess) }));
        this.indexBytes_ = files.find(f => f.name === INDEX_NAME)?.size ?? 0;
        if (repair) {
            // A surviving manifest gives an old file a resource identity even
            // when its index was lost. Infer only exact URL-name matches; saves,
            // orphan files and interrupted temporaries remain unindexed/pinned.
            const referenced = new Map<string, string>();
            for (const versions of Object.values(index.owners)) for (const version of versions)
                for (const key of version.keys) referenced.set(cacheEntryName(key), key);
            for (const entry of index.entries) {
                const key = referenced.get(entry.name);
                if (entry.key || !key) continue;
                const bytes = await this.platform_.readCacheFile!(key).catch(() => null);
                if (!bytes) continue;
                entry.key = key;
                entry.hash = contentHashHex(new Uint8Array(bytes));
                entry.size = bytes.byteLength;
            }
        }
    }

    /** Explicit retention lives under its own owner, so advancing the automatic
     * current/rollback pair cannot silently release a developer's retained build. */
    async retainVersion(owner: string, revision: string, retain = true): Promise<void> {
        if (this.capability() !== 'managed') throw Error('cache management unavailable');
        return this.run_(async () => {
            const index = await this.load_();
            const retainedOwner = `retained:${owner}`;
            const retained = index.owners[retainedOwner] ?? [];
            const version = index.owners[owner]?.find(v => v.revision === revision);
            if (!version) throw Error('unknown cache version');
            index.owners[retainedOwner] = retained.filter(v => v.revision !== revision);
            if (retain) index.owners[retainedOwner].push({ ...version, keys: [...version.keys], reason: 'retained' });
            await this.save_();
        });
    }

    private report_(): ContentCacheReport {
        const capability = this.capability();
        if (capability !== 'managed') return { capability, usedBytes: null, indexBytes: null,
            protectedBytes: null, reclaimableBytes: null, entries: [], versions: [] };
        const index = this.index_!;
        // Invert version references once. Looking up every URL for every file
        // makes a modest cache report block the editor for seconds (E × R).
        const names = new Set(index.entries.map(e => e.name));
        const ownership = new Map<string, { versions: Set<string>; protection: Set<string> }>();
        const versionReports: ContentCacheReport['versions'] = [];
        for (const [owner, refs] of Object.entries(index.owners)) {
            const retainedVersions = new Set(index.owners[`retained:${owner}`]?.map(v => v.revision) ?? []);
            for (const version of refs) {
                let missing = 0;
                for (const key of version.keys) {
                    const name = cacheEntryName(key);
                    if (!names.has(name)) missing++;
                    let refsForFile = ownership.get(name);
                    if (!refsForFile) {
                        refsForFile = { versions: new Set(), protection: new Set() };
                        ownership.set(name, refsForFile);
                    }
                    refsForFile.versions.add(version.revision);
                    if (version.reason) refsForFile.protection.add(`${owner}:${version.reason}`);
                }
                if (!owner.startsWith('retained:')) {
                    const retained = retainedVersions.has(version.revision);
                    versionReports.push({ owner, revision: version.revision,
                        reason: version.reason ?? (retained ? 'retained' : null), retained, missing });
                }
            }
        }
        const entries = index.entries.map(e => {
            const refs = ownership.get(e.name);
            return { ...e, versions: [...(refs?.versions ?? [])],
                protection: [...(e.key ? [] : ['unindexed']), ...(refs?.protection ?? [])] };
        });
        const usedBytes = entries.reduce((n, e) => n + e.size, 0);
        const protectedBytes = entries.reduce((n, e) => n + (e.protection.length ? e.size : 0), 0);
        return { capability, usedBytes, indexBytes: this.indexBytes_, protectedBytes,
            reclaimableBytes: usedBytes - protectedBytes, entries,
            versions: versionReports };
    }

    async report(rescan = false): Promise<ContentCacheReport> {
        if (this.capability() !== 'managed') return this.report_();
        return this.run_(async () => {
            await this.scan_(rescan);
            if (rescan) await this.save_();
            return this.report_();
        });
    }

    private preview_(budgetBytes: number): CacheCleanupPreview {
        const report = this.report_();
        let remainingBytes = report.usedBytes;
        const candidates: string[] = [];
        let releaseBytes = 0;
        if (remainingBytes !== null) for (const e of [...report.entries]
            .filter(e => e.protection.length === 0).sort((a, b) => a.lastAccess - b.lastAccess || a.name.localeCompare(b.name))) {
            if (remainingBytes <= budgetBytes) break;
            candidates.push(e.name);
            releaseBytes += e.size;
            remainingBytes -= e.size;
        }
        return { report, budgetBytes, candidates, releaseBytes, remainingBytes,
            budgetMet: remainingBytes === null ? null : remainingBytes <= budgetBytes };
    }

    /** Re-evaluates protection at execution; never trusts a stale UI preview.
     * Serial deletion yields every batch and reports only successful unlinks. */
    async cleanup(budgetBytes: number, execute = false): Promise<CacheCleanupResult> {
        if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw Error('cache budget must be a non-negative safe integer');
        return this.run_(async () => {
            if (this.capability() === 'managed') await this.scan_();
            const preview = this.preview_(budgetBytes);
            const removed: string[] = [], failed: string[] = [];
            if (!execute || preview.report.capability !== 'managed') return { ...preview, removed, failed };
            let released = 0;
            for (const name of preview.candidates) {
                try {
                    await this.platform_.removeCacheFile!(name);
                    released += this.index_!.entries.find(e => e.name === name)!.size;
                    this.index_!.entries = this.index_!.entries.filter(e => e.name !== name);
                    removed.push(name);
                } catch { failed.push(name); }
                if ((removed.length + failed.length) % 16 === 0) await new Promise(r => setTimeout(r, 0));
            }
            // If interrupted, a later scan reconciles the on-disk truth.
            const indexPersisted = await this.save_().then(() => true, () => false);
            const report = this.report_();
            return { ...preview, report, releaseBytes: released, remainingBytes: report.usedBytes,
                budgetMet: report.usedBytes! <= budgetBytes, removed, failed, indexPersisted };
        });
    }
}

const caches = new WeakMap<PlatformAdapter, ContentCache>();
export function contentCacheFor(platform: PlatformAdapter): ContentCache {
    let cache = caches.get(platform);
    if (!cache) { cache = new ContentCache(platform); caches.set(platform, cache); }
    return cache;
}
