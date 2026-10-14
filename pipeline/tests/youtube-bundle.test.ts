// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkYouTubeFiles, checkYouTubeBundle } from '../src/export/youtubeBundle';
const MiB=1024*1024;
it('applies strict total and per-file boundaries independently of initial estimate',()=>{
    expect(checkYouTubeFiles([{path:'game.wasm',bytes:30*MiB-1}],0).errors).toEqual([]);
    expect(checkYouTubeFiles([{path:'game.wasm',bytes:30*MiB}],0).errors).toContain('YouTube: game.wasm must be less than 30 MiB.');
    const files=Array.from({length:10},(_,i)=>({path:`chunk-${i}.bin`,bytes:25*MiB}));
    expect(checkYouTubeFiles(files,0).errors).toEqual(['YouTube: total bundle must be less than 250 MiB.']);
    files[0].bytes--;expect(checkYouTubeFiles(files,0).errors).toEqual([]);
});
it('checks every filename and the inclusive file-count ceiling',()=>{
    const files=Array.from({length:8000},(_,i)=>({path:`assets/${i}.bin`,bytes:0}));
    expect(checkYouTubeFiles(files,0).errors).toEqual([]);
    files.push({path:'assets/bad name.bin',bytes:0});
    const result=checkYouTubeFiles(files,0);expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('8001');expect(result.errors[1]).toContain('bad name.bin');
});
it('does not mistake stored initial estimates or startup samples for certification',()=>{
    const result=checkYouTubeFiles([{path:'game.js',bytes:512*1024}],30*MiB);
    expect(result.errors).toEqual([]);expect(result.warnings).toHaveLength(3);
    expect(result.warnings[1]).toContain('compressed transfer through gameReady');
    expect(result.warnings[2]).toContain('peak');
});
it('walks nested output files and rejects links rather than silently excluding them',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'youtube-bundle-'));
    try {
        await mkdir(path.join(root,'assets'));await writeFile(path.join(root,'assets','bad name.bin'),'test');
        expect((await checkYouTubeBundle(root,0)).errors[0]).toContain('assets/bad name.bin');
        await symlink(path.join(root,'assets'),path.join(root,'linked'),'junction');
        await expect(checkYouTubeBundle(root,0)).rejects.toThrow('unsupported filesystem entry');
    } finally {await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
