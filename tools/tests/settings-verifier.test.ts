// SPDX-License-Identifier: Apache-2.0
import {expect, it} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

it.each(['pass', 'killed', 'wrong-label', 'gpu-once', 'gpu-then-wrong-label'])('settings restart diagnostics preserve %s evidence', async mode => {
  const temp=mkdtempSync(path.join(os.tmpdir(),'estella-settings-contract-'));
  try {
    const entry=path.join(temp,'settings.mjs'), log=path.join(temp,'logs','restarts.log');
    const compiled=await build({entryPoints:['tools/verify-settings.mjs'],outfile:entry,
      bundle:true,platform:'node',format:'esm',metafile:true,plugins:[{
        name:'fixture-only-launcher',setup(builder){
          builder.onResolve({filter:/electronRun\.mjs$/},()=>({path:'run',namespace:'fixture'}));
          builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
            let launch=0; const profiles=new Map();
            export function runElectron(args) {
              const globalStep=launch++, mode=${JSON.stringify(mode)};
              const profile=args.find(arg=>arg.startsWith('--user-data-dir='));
              const step=profiles.get(profile)??0;profiles.set(profile,step+1);
              if(mode==='killed')return {status:null,signal:'SIGKILL',stdout:'boot trace before termination',stderr:'renderer diagnostic'};
              const labels=['Master 66%','Master 33%','Master 0%','Master 0%'];
              const at={MasterLabel:{text:(mode==='wrong-label'||mode==='gpu-then-wrong-label'&&globalStep>0)?'Master 100%':labels[step]},Bar0:{h:step<2?40:6}};
              if(mode.startsWith('gpu-')&&globalStep===0)return {status:1,signal:null,stdout:'probe: '+JSON.stringify({at})+'\\n[ERROR] GPU device lost: context-lost\\n',stderr:''};
              return {status:0,signal:null,stdout:'probe: '+JSON.stringify({at})+'\\n',stderr:'',args};
            }
          `,loader:'js'}));
        },
      }]});
    expect(Object.keys(compiled.metafile!.inputs).some(file=>file.endsWith('/lib/electronRun.mjs'))).toBe(false);
    const spec={control:{x:.2,y:.5},unlock:{x:.01,y:.01},label:'MasterLabel',
      expected:['Master 66%','Master 33%','Master 0%'],bars:['Bar0'],floor:6,w:800,h:600};
    const run=spawnSync(process.execPath,[entry,'--dir',temp,'--spec',JSON.stringify(spec),'--log',log],{encoding:'utf8'});
    expect(run.status).toBe(mode==='pass'||mode==='gpu-once'?0:1);
    const records=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const launches=records.filter(record=>record.kind==='launch');
    expect(launches).toHaveLength(mode==='gpu-once'?5:mode==='gpu-then-wrong-label'?2:mode==='pass'?4:1);
    expect(launches[0].step).toBe(0);
    if(mode==='killed'){
      expect(launches[0]).toMatchObject({status:null,signal:'SIGKILL',stdout:'boot trace before termination',stderr:'renderer diagnostic'});
      expect(run.stderr).toContain('settings restart 0 failed: status=none signal=SIGKILL');
    } else if(mode==='wrong-label'||mode==='gpu-then-wrong-label'){
      expect(run.stderr).toContain('settings label was Master 100%, expected Master 66%');
      expect(launches.at(-1).stdout).toContain('Master 100%');
    } else {
      expect(records.at(-1).kind).toBe('complete');
      expect(launches.filter(record=>record.status===0).map(record=>record.restart)).toEqual([false,false,false,true]);
    }
    if(mode.startsWith('gpu-')){
      const attempts=records.filter(record=>record.kind==='attempt');
      expect(attempts).toHaveLength(2);
      expect(new Set(attempts.map(record=>record.profile)).size).toBe(2);
      expect(launches[0].screenshot).not.toBe(launches[1].screenshot);
      expect(launches[0].status).toBe(1);
    }
  } finally {
    if(path.dirname(temp)!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('estella-settings-contract-'))throw Error('Unexpected fixture path');
    rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
});
