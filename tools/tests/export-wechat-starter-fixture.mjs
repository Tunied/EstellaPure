// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {runTool} from '../lib/runTool.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1];
if(!args.includes('--wasm')||!args.includes('--out'))throw Error('Expected --wasm and --out');
const temp=await fs.mkdtemp(path.join(root,'output','wechat-fixture-'));
try{
 await fs.cp(path.join(root,'templates/wechat-minigame'),temp,{recursive:true,filter:src=>!path.relative(path.join(root,'templates/wechat-minigame'),src).split(path.sep).some(part=>['.esengine','node_modules','dist'].includes(part))});
 const config=path.join(temp,'src/config.ts');await fs.writeFile(config,(await fs.readFile(config,'utf8')).replace("REWARDED_AD_UNIT_ID = ''","REWARDED_AD_UNIT_ID = 'local-mock-reward-unit'"));
 const main=path.join(temp,'src/main.ts'),source=await fs.readFile(main,'utf8'),marker="world.insert(replay.entity, Name, { value: 'Replay' }); refresh();";
 if(!source.includes(marker))throw Error('Starter fixture hook changed');
 await fs.writeFile(main,source.replace(marker,marker+"\n(globalThis as any).__wxStarterProbe = () => ({ credits: state.credits, message: state.message, busy: state.busy, selected: selected.size });"));
 const result=runTool(process.execPath,[path.join(root,'pipeline/bin/estella.mjs'),'export',temp,'--profile','wechat','--wasm',path.resolve(flag('--wasm')),'--out',path.resolve(flag('--out')),'--json',path.resolve(flag('--out'))+'.json'],{cwd:root,stdio:'inherit'});
 if(result.status!==0)throw Error('Fixture export failed');
}finally{if(!temp.startsWith(path.join(root,'output')+path.sep))throw Error('Unexpected cleanup target');await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
