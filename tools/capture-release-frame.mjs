// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runElectron} from './lib/electronRun.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]??'out/release-site-frame');
const subject=path.join(out,'game');
mkdirSync(out,{recursive:true});
const exported=spawnSync(process.execPath,['pipeline/bin/estella.mjs','export','examples/celestial-heights',
    '--platform','web','--out',subject],{cwd:root,encoding:'utf8'});
if(exported.status!==0)throw Error(`Site subject export failed: ${exported.stderr}`);
const frame=path.join(out,'celestial-heights-frame.png');
const capture=runElectron(['tools/launchers/launch-export.mjs','--dir',subject,'--w','1280','--h','720',
    '--settle','60','--timeout','120000','--out',frame],{cwd:root,encoding:'utf8'});
if(capture.status!==0)throw Error(`Site subject capture failed: ${capture.stdout}\n${capture.stderr}`);
const provenance={schema:1,project:'examples/celestial-heights',version:JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,
    gitSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sha256:createHash('sha256').update(readFileSync(frame)).digest('hex'),capture:'exported Web game, hidden Electron, 60 settled frames',width:1280,height:720};
writeFileSync(path.join(out,'hero-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify(provenance));
