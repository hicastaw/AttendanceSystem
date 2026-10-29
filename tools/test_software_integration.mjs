import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {bootBackend,root,spawnTestProcess,waitForChild,stopChild,listenHttp,closeHttpServer,childDiagnostics} from './software_test_support.mjs';
const require=createRequire(path.join(root,'AIOT/server/package.json'));
const Database=require('better-sqlite3');
const manifest=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8'));
const event=(extra={})=>({event_id:crypto.randomUUID(),device_id:'TEST_DEVICE',user_code:'TEST001',event_type:'check_in',
  timestamp:'2026-10-14T08:00:00+07:00',confidence:90,...extra});
async function member(f){assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'TEST001',full_name:'<img src=x onerror=alert(1)>'}})).status,201);}

test('strict API validation, persisted dedup receipts, DB failure and authenticated controls',async()=>{
  const f=await bootBackend();let db;
  try {
    await member(f);
    for(const body of [{user_code:'  ',full_name:'X'},{user_code:{},full_name:[]}])assert.equal((await f.request('/api/users',{headers:f.admin,body})).status,400);
    assert.equal((await f.request('/api/users/TEST001/mock-face',{headers:f.admin,method:'POST'})).status,404);
    assert.equal((await f.request('/api/worker-state',{body:{}})).status,401);
    for(const extra of [{confidence:'90'},{confidence:-1},{confidence:101},{event_id:'bad'},{timestamp:'2026-02-30T08:00:00Z'},
      {timestamp:'2026-10-14T08:00:00'},{device_id:'MOCK_bad'}])assert.equal((await f.request('/api/access-events',{headers:f.device,body:event(extra)})).status,400);
    const first=event();assert.equal((await f.request('/api/access-events',{headers:f.device,body:first})).status,200);
    const repeated=event({device_id:'SECOND_DEVICE',timestamp:'2026-10-14T08:01:00+07:00'});
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:repeated})).body.duplicate,true);
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:repeated})).body.duplicate,true);
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:{...repeated,confidence:80}})).status,409);
    assert.equal((await f.request('/api/access-events',{headers:f.admin})).body.data.length,1);
    await f.request('/api/users/TEST001',{headers:f.admin,method:'PATCH',body:{status:'inactive'}});
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:event({timestamp:'2026-10-14T13:00:00+07:00'})})).status,403);
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:first})).body.duplicate,true);
    await f.request('/api/users/TEST001',{headers:f.admin,method:'PATCH',body:{status:'active'}});
    db=new Database(path.join(f.directory,'test.db'));
    db.exec("CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON access_events BEGIN SELECT RAISE(ABORT,'synthetic failure');END");
    const failed=event({timestamp:'2026-10-14T13:00:00+07:00'});
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:failed})).status,503);
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body:{mode:'production',embedding_contract:manifest.legacy,state:'pending',event_id:failed.event_id}})).status,200);
    assert.equal((await f.request('/api/kiosk-state')).body.state,'pending');
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body:{mode:'production',embedding_contract:manifest.legacy,state:'confirmed'}})).status,400);
    db.exec('DROP TRIGGER synthetic_disk_failure');
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:failed})).status,200);
    const value=(await f.request('/api/kiosk-state')).body;
    assert.equal(value.state,'confirmed');assert.equal(value.attendance.full_name,'<img src=x onerror=alert(1)>');
    assert.equal(value.embedding,undefined);
    await f.request('/api/auth/logout',{headers:f.admin,method:'POST'});
    assert.equal((await f.request('/api/users',{headers:f.admin})).status,401);
    for(let i=0;i<12;i++)await f.request('/api/auth/login',{body:{password:'incorrect'}});
    assert.equal((await f.request('/api/auth/login',{body:{password:f.password}})).status,429);
  } finally {db?.close();await f.dispose();}
});

test('enrollment refuses incompatible models and invalid embeddings without replacing a profile',async(t)=>{
  let response={is_valid:true,embedding:Array(512).fill(0),embedding_contract:manifest.legacy};
  const ai=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});});
  t.after(()=>closeHttpServer(ai));
  await listenHttp(ai);
  const f=await bootBackend({extra:{AI_SERVICE_URL:`http://127.0.0.1:${ai.address().port}`}});
  try {
    await member(f);
    const enroll=async()=>{
      const form=new FormData();form.append('face_image',new Blob(['synthetic transport fixture'],{type:'image/png'}),'test.png');
      const response=await fetch(f.url+'/api/users/TEST001/face',{method:'POST',headers:f.admin,body:form,signal:AbortSignal.timeout(5000)});
      await response.arrayBuffer(); // Drain each response, including expected errors.
      return response;
    };
    assert.equal((await enroll()).status,503);
    response={...response,embedding:[1,...Array(511).fill(0)],embedding_contract:manifest.mock};
    assert.equal((await enroll()).status,409);
    assert.equal((await f.request('/api/face-data',{headers:f.device})).body.data.length,0);
    response.embedding_contract=manifest.legacy;
    assert.equal((await enroll()).status,200);
    const gallery=(await f.request('/api/face-data',{headers:f.device})).body;
    assert.deepEqual(gallery.embedding_contract,manifest.legacy);assert.equal(gallery.data.length,1);
    response.embedding_contract=manifest.mock;assert.equal((await enroll()).status,409);
    assert.equal((await f.request('/api/face-data',{headers:f.device})).body.data.length,1);
  } finally {await f.dispose();}
});

test('mock -> real Python decision/outbox -> SQLite -> public kiosk; restart and mode isolation',async()=>{
  const python=process.env.TEST_PYTHON;
  assert.ok(python,'Set TEST_PYTHON to the native Python with requirements installed');
  let f=await bootBackend({mode:'mock'});const directory=f.directory;
  try {
    await member(f);
    assert.equal((await f.request('/api/users/TEST001/mock-face',{headers:f.admin,method:'POST'})).status,200);
    assert.equal((await f.request('/api/access-events',{headers:f.device,body:event()})).status,400);
    const runtime=path.join(directory,'runtime.json');
    await writeFile(runtime,JSON.stringify({mode:'mock',url:f.url,key:f.key}));
    async function simulate(scenario){
      const child=spawnTestProcess(python,[path.join(root,'tools/simulate_recognition.py'),'--runtime',runtime,'--code','TEST001','--scenario',scenario,'--timestamp','2026-10-14T08:00:00+07:00'],{stdio:['ignore','pipe','pipe']},[f.key,f.password]);
      try {assert.equal(await waitForChild(child,{label:`simulate ${scenario}`}),0,childDiagnostics(child));}
      finally {await stopChild(child);}
    }
    await simulate('unknown');assert.equal((await f.request('/api/access-events',{headers:f.admin})).body.data.length,0);
    await simulate('known');assert.equal((await f.request('/api/access-events',{headers:f.admin})).body.data.length,1);
    assert.equal((await f.request('/api/kiosk-state')).body.state,'confirmed');
    await simulate('known');assert.equal((await f.request('/api/access-events',{headers:f.admin})).body.data.length,1);
    await f.stop();
    await assert.rejects(bootBackend({mode:'production',directory}),/mode mismatch/);
    f=await bootBackend({mode:'mock',directory});
    assert.equal((await f.request('/api/access-events',{headers:f.admin})).body.data.length,1);
    assert.equal((await f.request('/api/kiosk-state')).body.state,'worker_unavailable');
  } finally {await f.dispose();}
});

test('one-command mock launcher starts isolated services and stop closes its children',async()=>{
  const f=await bootBackend({mode:'mock'});await f.stop();
  const child=spawnTestProcess(process.execPath,[path.join(root,'tools/run_mock.mjs'),'--data-dir',f.directory,
    '--port',new URL(f.url).port,'--python',process.env.TEST_PYTHON],{cwd:root,stdio:'pipe'});
  let output='';
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  try {
    let ready=false,lastState;
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      try {const response=await fetch(f.url+'/api/kiosk-state',{signal:AbortSignal.timeout(500)});const state=await response.json();lastState=state;ready=state.mode==='mock' && state.state!=='worker_unavailable';}catch{}
      if(ready)break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready,'Mock launcher/worker did not become ready: '+JSON.stringify(lastState)+' '+output.replace(/Mock admin password:.*\n/g,'').slice(-2000));
    child.stdin.write('stop\n');assert.equal(await waitForChild(child,{label:'mock launcher stop'}),0,childDiagnostics(child));
    await assert.rejects(fetch(f.url+'/api/health',{signal:AbortSignal.timeout(1000)}));
  } finally {
    try {await stopChild(child,{graceful:'stop\n'});} finally {await f.dispose();}
  }
});
