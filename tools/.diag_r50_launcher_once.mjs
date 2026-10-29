import {spawn} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const toolsDir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(toolsDir,'..');
const original=path.join(toolsDir,'run_r50_laptop_test.mjs');
const diagnostic=path.join(toolsDir,'.diag_run_r50_laptop_test.mjs');
const source=await readFile(original,'utf8');
const anchor='process.exitCode=exitCode;';
if(!source.includes(anchor))throw new Error('diagnostic anchor missing');
const probe=`${anchor}\n  setTimeout(()=>console.error('POST_CLEANUP_HANDLES '+JSON.stringify({handles:process._getActiveHandles().map(h=>({type:h.constructor?.name,fd:h.fd,readable:h.readable,writable:h.writable,connecting:h.connecting})),resources:process.getActiveResourcesInfo(),stdin:{destroyed:process.stdin.destroyed,readable:process.stdin.readable,paused:process.stdin.isPaused(),listeners:process.stdin.listenerCount('data')}})),750);`;
await writeFile(diagnostic,source.replace(anchor,probe));
const python=path.join(root,'.venv','laptop-r50-manual','Scripts','python.exe');
const child=spawn(process.execPath,[diagnostic,'--python',python,'--threads','4'],{cwd:root,stdio:['pipe','pipe','pipe']});
let output='',errors='',sent=false,exit=null;
child.stdout.on('data',b=>{output+=b.toString();if(!sent&&output.includes('R50 EXPERIMENTAL LAPTOP TEST')){sent=true;child.stdin.write('stop\n');}});
child.stderr.on('data',b=>{errors+=b.toString();});
child.on('exit',(code,signal)=>{exit={code,signal};});
try {
  const startupEnd=Date.now()+60000;
  while(!sent&&Date.now()<startupEnd)await new Promise(r=>setTimeout(r,100));
  if(!sent)throw new Error('fixture launcher did not reach readiness: '+errors.slice(-2000));
  const stopEnd=Date.now()+12000;
  while(!exit&&Date.now()<stopEnd)await new Promise(r=>setTimeout(r,100));
  const handleLine=errors.split(/\r?\n/).find(line=>line.startsWith('POST_CLEANUP_HANDLES '))||null;
  const runMatch=output.match(/remove the named temp run: ([^\r\n]+)/);
  const portMatch=output.match(/Worker diagnostics: http:\/\/127\.0\.0\.1:(\d+)/);
  const directory=runMatch?.[1];
  let portClosed=null;
  if(portMatch)try{await fetch(`http://127.0.0.1:${portMatch[1]}/cpu-test-diagnostics`,{signal:AbortSignal.timeout(700)});portClosed=false;}catch{portClosed=true;}
  process.stdout.write(JSON.stringify({startup:'PASS',stopWritten:sent,launcherExit:exit,activeHandleDiagnostic:handleLine,portClosed,tempRunRemoved:directory? !existsSync(directory):null})+'\n');
  if(!exit){child.kill();process.exitCode=1;}
  if(!exit||!handleLine||!portClosed||!directory||existsSync(directory))process.exitCode=1;
} finally {
  if(!exit){child.kill();await new Promise(r=>child.once('exit',r));}
  await rm(diagnostic,{force:true});
}
