// Only isolated mock directories, synthetic HTTP peers and generated credentials.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,spawnTestProcess,waitForChild,stopChild,listenHttp,closeHttpServer,childDiagnostics,withDeadline,bootBackend} from './software_test_support.mjs';
import {checkServerDependencies} from './r50_dependency_check.mjs';

test('R50 dependency preflight explains missing dotenv before native/model/camera startup',()=>{
  let loaded=false;
  assert.throws(()=>checkServerDependencies({
    resolve:name=>{if(name==='dotenv')throw new Error('synthetic missing package');return name;},
    load:()=>{loaded=true;throw new Error('must not load native dependency');},
  }),error=>/dotenv/.test(error.message)&&/npm.cmd ci --prefix AIOT\/server/.test(error.message));
  assert.equal(loaded,false);
});

test('R50 dependency preflight reports SQLite native ABI failure',()=>{
  assert.throws(()=>checkServerDependencies({resolve:name=>name,load:()=>{throw new Error('synthetic NODE_MODULE_VERSION mismatch');}}),
    /SQLite native dependency cannot load.*NODE_MODULE_VERSION mismatch/);
});

test('R50 check-deps works from outside the repo without Python or camera access',async()=>{
  const child=spawnTestProcess(process.execPath,[path.join(root,'tools/run_r50_laptop_test.mjs'),'--check-deps'],
    {cwd:os.tmpdir(),env:{...process.env,TEST_PYTHON:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',value=>{output+=value;});
  try {
    assert.equal(await waitForChild(child,{timeoutMs:5000}),0,childDiagnostics(child));
    const result=JSON.parse(output);assert.equal(result.status,'PASS');assert.equal(result.sqlite,'ok');
    assert.equal(result.scope,'node-runtime-dependencies');
  } finally {await stopChild(child);}
});

async function mockFixture(t,extra=[],prelude='') {
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  let child;
  t.after(async()=>{try {if(child)await stopChild(child,{graceful:'stop\n'});}finally {await rm(directory,{recursive:true,force:true});}});
  return {directory,start(port,options=extra){
    const entry=path.join(root,'tools/run_mock.mjs');
    const args=['--data-dir',directory,'--port',String(port),...options];
    const command=prelude?['--input-type=module','-e',`${prelude};process.argv=[process.execPath,${JSON.stringify(entry)},...${JSON.stringify(args)}];await import(${JSON.stringify(pathToFileURL(entry).href)})`]:[entry,...args];
    child=spawnTestProcess(process.execPath,command,
      {cwd:directory,env:{...process.env,DOTENV_CONFIG_PATH:path.join(directory,'absent.env')},stdio:['pipe','pipe','pipe']});
    return child;
  }};
}

test('mock launcher never probes or seeds an occupied port and exits nonzero',async t=>{
  let requests=0;
  const peer=http.createServer((_req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.end('{}');});
  await listenHttp(peer);t.after(()=>closeHttpServer(peer));
  const f=await mockFixture(t,['--manual']);
  const child=f.start(peer.address().port);
  assert.notEqual(await waitForChild(child,{timeoutMs:12000,label:'occupied mock port'}),0);
  assert.equal(requests,0,'must confirm ownership via child IPC before making HTTP requests');
  assert.match(childDiagnostics(child),/EADDRINUSE|before listening/);
  assert.ok(peer.listening,'must not terminate the existing listener');
});

test('mock HTTP deadline aborts a stalled request and cleans its own backend',async t=>{
  const probe=http.createServer();await listenHttp(probe);
  const port=probe.address().port;await closeHttpServer(probe);
  // Inject a synthetic never-responding fetch, not an alternative runtime policy.
  const prelude=`globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>{
    options?.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  })`;
  const f=await mockFixture(t,['--manual'],prelude);const child=f.start(port);
  assert.notEqual(await waitForChild(child,{timeoutMs:12000,label:'stalled mock HTTP'}),0);
  assert.match(childDiagnostics(child),/Mock request \/api\/ready failed: TimeoutError/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}));
});

test('mock startup validates persisted credentials before starting or rewriting runtime',async t=>{
  const f=await mockFixture(t,['--manual']);
  const file=path.join(f.directory,'mock-runtime.json');
  const original=JSON.stringify({mode:'mock',password:'change-me-test',key:'change-me-key'});
  await writeFile(file,original);
  const child=f.start(3301);
  assert.notEqual(await waitForChild(child,{timeoutMs:5000}),0);
  assert.equal(await readFile(file,'utf8'),original);
  assert.match(childDiagnostics(child),/credentials/);
});

test('missing mock worker executable stops its owned backend and releases the listener',async t=>{
  const probe=http.createServer();await listenHttp(probe);
  const port=probe.address().port;await closeHttpServer(probe);
  const f=await mockFixture(t);
  const child=f.start(port,['--python',path.join(f.directory,'missing-python.exe')]);
  assert.notEqual(await waitForChild(child,{timeoutMs:12000,label:'missing worker cleanup'}),0);
  assert.match(childDiagnostics(child),/ENOENT/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}));
});

test('manual mock stop closes owned backend without leaking the local password in failure diagnostics',async t=>{
  const probe=http.createServer();await listenHttp(probe);
  const port=probe.address().port;await closeHttpServer(probe);
  const f=await mockFixture(t,['--manual']);const child=f.start(port);
  await withDeadline(new Promise((resolve,reject)=>{
    child.stdout.on('data',()=>{if(childDiagnostics(child).includes('Synthetic data only.'))resolve();});
    child.once('close',()=>reject(new Error('mock stopped before seeding: '+childDiagnostics(child))));
  }),10000,'manual mock startup');
  const runtime=JSON.parse(await readFile(path.join(f.directory,'mock-runtime.json'),'utf8'));
  assert.ok(!childDiagnostics(child).includes(runtime.password));
  child.stdin.write('stop\n');
  assert.equal(await waitForChild(child,{timeoutMs:5000,label:'manual mock stop'}),0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}));
});

test('stop requested during mock startup cancels cleanly and leaves no listener',async t=>{
  const probe=http.createServer();await listenHttp(probe);
  const port=probe.address().port;await closeHttpServer(probe);
  const f=await mockFixture(t,['--manual']);const child=f.start(port);
  child.stdin.write('stop\n');
  assert.equal(await waitForChild(child,{timeoutMs:5000,label:'startup cancellation'}),0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}));
});

test('documented CPU entrypoint starts with real models, integrates invalid upload safely and releases its port',async t=>{
  assert.ok(process.env.TEST_PYTHON,'TEST_PYTHON must point to the CPU/test environment');
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  const child=spawnTestProcess(process.env.TEST_PYTHON,['-B','-m','uvicorn','main:app','--app-dir',path.join(root,'AIOT/server/ai'),
    '--host','127.0.0.1','--port','0','--workers','1'],{cwd:directory,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{try {await stopChild(child);}finally {await rm(directory,{recursive:true,force:true});}});
  const url=await withDeadline(new Promise((resolve,reject)=>{
    child.stderr.on('data',()=>{
      const match=childDiagnostics(child).match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match)resolve(match[0]);
    });
    child.once('error',reject);
    child.once('close',()=>reject(new Error('CPU service failed to start: '+childDiagnostics(child))));
  }),15000,'CPU enrollment startup');
  const health=await fetch(url+'/',{signal:AbortSignal.timeout(3000)});
  assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
  const f=await bootBackend({extra:{AI_SERVICE_URL:url}});
  try {
    assert.equal((await f.request('/api/ready')).status,200);
    assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'CPU_TEST',full_name:'Synthetic CPU test'}})).status,201);
    const form=new FormData();form.set('face_image',new Blob(['synthetic invalid image'],{type:'image/png'}),'synthetic.png');
    const response=await fetch(f.url+'/api/users/CPU_TEST/face',{method:'POST',headers:f.admin,body:form,signal:AbortSignal.timeout(5000)});
    // Current backend contract: failed AI validation transport returns generic 503, no profile saved.
    assert.equal(response.status,503);await response.arrayBuffer();
    assert.equal((await f.request('/api/face-data',{headers:f.device})).body.data.length,0);
  } finally {await f.dispose();}
  await stopChild(child);
  await assert.rejects(fetch(url+'/',{signal:AbortSignal.timeout(1000)}));
});
