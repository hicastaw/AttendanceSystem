// Fault-injection tests for the test harness itself. Synthetic services/temp DBs only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readdir,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bootBackend,spawnTestProcess,waitForChild,stopChild,childDiagnostics,closeHttpServer,listenHttp,withDeadline} from './software_test_support.mjs';

test('boot failure before listen cleans owned temp directory and reports redacted diagnostics',async()=>{
  let directory;
  await assert.rejects(bootBackend({serverArgs:['-e',
    "console.error('FIXTURE_DIRECTORY='+process.cwd());console.error(JSON.stringify({password:process.env.ADMIN_PASSWORD,key:process.env.EDGE_DEVICE_KEY}));process.exit(17)"]}),
    error=>{
      directory=error.message.match(/FIXTURE_DIRECTORY=([^\r\n]+)/)?.[1];
      return Boolean(directory) && /listen IPC/.test(error.message) && /REDACTED/.test(error.message) && /17/.test(error.message);
    });
  await assert.rejects(access(directory),{code:'ENOENT'});
});

test('failed fixture login closes child listener and preserves caller-owned directory',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  try {
    const script=`const http=require('node:http');const fs=require('node:fs');
      const s=http.createServer((req,res)=>{req.resume();res.setHeader('Content-Type','application/json');
        res.end(req.url==='/api/ready'?'{}':'{"status":"error"}');});
      s.listen(0,'127.0.0.1',()=>{fs.writeFileSync('port.txt',String(s.address().port));process.send({type:'aiot-listening',port:s.address().port});});`;
    await assert.rejects(bootBackend({directory,serverArgs:['-e',script]}),/admin login/);
    const {readFile}=await import('node:fs/promises');
    const port=await readFile(path.join(directory,'port.txt'),'utf8');
    await assert.rejects(fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)}));
    assert.ok((await readdir(directory)).includes('port.txt'));
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('startup IPC deadline and child timeout are bounded and spawn errors are captured',async()=>{
  await assert.rejects(bootBackend({startupTimeoutMs:200,serverArgs:['-e','setInterval(()=>{},1000)']}),/timed out/);
  const hanging=spawnTestProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'pipe'});
  try {await assert.rejects(waitForChild(hanging,{timeoutMs:100}),/timed out/);}
  finally {await stopChild(hanging);}
  const missing=spawnTestProcess(path.join(os.tmpdir(),'does-not-exist-aiot-fixture'),[],{stdio:'pipe'});
  try {await assert.rejects(waitForChild(missing),/ENOENT/);}finally{await stopChild(missing);}
});

test('HTTP fixture cleanup closes active connections rather than waiting forever',async(t)=>{
  let received;
  const accepted=new Promise(resolve=>{received=resolve;});
  const server=http.createServer(()=>received());
  t.after(()=>closeHttpServer(server));
  await listenHttp(server);
  const pending=fetch(`http://127.0.0.1:${server.address().port}`,{signal:AbortSignal.timeout(1500)});
  const rejected=assert.rejects(pending);
  await withDeadline(accepted,1000,'hung upload accepted');
  await closeHttpServer(server);
  await rejected;
  assert.equal(server.listening,false);
});

test('simultaneous backends get independent OS-assigned ports and isolated temporary databases',async()=>{
  const fixtures=[];
  try {
    // allSettled retains successful fixtures even if another startup fails.
    const results=await Promise.allSettled([bootBackend(),bootBackend(),bootBackend()]);
    for(const result of results)if(result.status==='fulfilled')fixtures.push(result.value);
    for(const result of results)if(result.status==='rejected')throw result.reason;
    assert.equal(new Set(fixtures.map(f=>f.url)).size,3);
    assert.equal(new Set(fixtures.map(f=>f.directory)).size,3);
    for(const fixture of fixtures)assert.equal((await fixture.request('/api/ready')).status,200);
  } finally {await Promise.all(fixtures.map(f=>f.dispose()));}
});

test('child diagnostics redact exact generated secrets and named JSON credentials',async()=>{
  const secret='synthetic-fixture-private-value';
  const child=spawnTestProcess(process.execPath,['-e',`console.error(${JSON.stringify(secret)});console.error('{"token":"synthetic-token"}')`],{stdio:'pipe'},[secret]);
  try {
    assert.equal(await waitForChild(child),0);
    const diagnostic=childDiagnostics(child);
    assert.ok(!diagnostic.includes(secret));assert.ok(!diagnostic.includes('synthetic-token'));
    assert.match(diagnostic,/REDACTED/);
  } finally {await stopChild(child);}
});
