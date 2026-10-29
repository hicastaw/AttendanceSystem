// Real Express/SQLite + Flask capture interface. No hardware/model accuracy claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,access,readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {bootBackend,root,spawnTestProcess,stopChild,withDeadline,childDiagnostics,listenHttp,closeHttpServer} from './software_test_support.mjs';

test('synthetic camera-owner -> admin capture -> atomic profile receipt -> gallery, with strict privacy and binding',async t=>{
  assert.ok(process.env.TEST_PYTHON);
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  const key=crypto.randomBytes(24).toString('hex'),runtime=path.join(directory,'capture-test.json');
  await writeFile(runtime,JSON.stringify({mode:'synthetic-capture-test',key}));
  let child,f;
  t.after(async()=>{try {if(f)await f.dispose();}finally {try {if(child)await stopChild(child);}finally {await rm(directory,{recursive:true,force:true});}}});
  child=spawnTestProcess(process.env.TEST_PYTHON,['-B',path.join(root,'tools/synthetic_capture_worker.py'),'--runtime',runtime],
    {cwd:directory,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']},[key]);
  const port=await withDeadline(new Promise((resolve,reject)=>{
    let output='';child.stdout.on('data',buffer=>{output+=buffer;const match=output.match(/"port":\s*(\d+)/);if(match)resolve(Number(match[1]));});
    child.once('error',reject);child.once('close',()=>reject(new Error(childDiagnostics(child))));
  }),10000,'synthetic camera-owner startup');
  f=await bootBackend({extra:{EDGE_DEVICE_KEY:key,WORKER_BASE_URL:`http://127.0.0.1:${port}`}});
  const call=(route,options={})=>f.request(route,{...options,headers:{...f.admin,...options.headers}});
  for(const user_code of ['CAPTURE_A','CAPTURE_B'])assert.equal((await call('/api/users',{body:{user_code,full_name:'Synthetic capture'}})).status,201);
  const base='/api/users/CAPTURE_A/capture';
  assert.equal((await f.request(base,{body:{}})).status,401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/preview.jpg`,{signal:AbortSignal.timeout(2000)})).status,401);
  const start=await call(base,{body:{frames:3}});assert.equal(start.status,201);
  const id=start.body.data.session_id;
  assert.equal((await call(base,{body:{frames:3}})).status,409);
  let ready;
  await withDeadline((async()=>{for(;;){ready=await call(base+'/'+id);assert.equal(ready.status,200);
    assert.ok(!('embedding' in ready.body.data));if(ready.body.data.state==='ready')break;await new Promise(r=>setTimeout(r,100));}})(),8000,'synthetic multiframe samples');
  assert.equal((await call(base+'/'+id+'/commit',{body:{}})).status,400);
  assert.equal((await call('/api/users/CAPTURE_B/capture/'+id+'/commit',{body:{confirm_same_member:true}})).status,503);
  const [first,repeat]=await Promise.all([call(base+'/'+id+'/commit',{body:{confirm_same_member:true}}),call(base+'/'+id+'/commit',{body:{confirm_same_member:true}})]);
  assert.equal(first.status,200);assert.equal(repeat.status,200);
  assert.equal((await call(base+'/'+id+'/commit',{body:{confirm_same_member:true}})).body.already_saved,true);
  const profiles=await f.request('/api/face-data',{headers:{'X-Device-Key':key}});
  assert.equal(profiles.body.data.length,1);assert.equal(profiles.body.data[0].user_code,'CAPTURE_A');
  assert.equal((await call('/api/access-events')).body.data.length,0);
});

test('production configuration fails closed before DB creation and malformed login payload is rejected',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  try {
    for(const [extra,pattern] of [[{PORT:'invalid'},/PORT/],[{NODE_ENV:'production',ADMIN_PASSWORD:'weak'},/ADMIN_PASSWORD/],
      [{NODE_ENV:'production',EDGE_DEVICE_KEY:'change-me-example'},/EDGE_DEVICE_KEY/],
      [{NODE_ENV:'production',ADMIN_TOKEN_TTL_SECONDS:'NaN'},/ADMIN_TOKEN_TTL_SECONDS/]]){
      await assert.rejects(bootBackend({directory,extra}),pattern);
      await assert.rejects(access(path.join(directory,'test.db')),{code:'ENOENT'});
    }
  } finally {await rm(directory,{recursive:true,force:true});}
  const f=await bootBackend();
  try {assert.equal((await f.request('/api/auth/login',{body:{password:{}}})).status,400);}
  finally {await f.dispose();}
});

test('capture proxy never follows redirects or sends embeddings to the browser',async()=>{
  let redirected=0;
  const target=http.createServer((_req,res)=>{redirected++;res.end('{}');});await listenHttp(target);
  const peer=http.createServer((_req,res)=>{res.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/collect`});res.end();});
  await listenHttp(peer);let f;
  try {
    f=await bootBackend({extra:{WORKER_BASE_URL:`http://127.0.0.1:${peer.address().port}`}});
    await f.request('/api/users',{headers:f.admin,body:{user_code:'PROXY_TEST',full_name:'Synthetic'}});
    assert.equal((await f.request('/api/users/PROXY_TEST/capture',{headers:f.admin,body:{}})).status,503);
    assert.equal(redirected,0);
    assert.equal((await f.request('/api/face-data',{headers:f.device})).body.data.length,0);
  } finally {if(f)await f.dispose();await closeHttpServer(peer);await closeHttpServer(target);}
});

test('system-ready separates DB liveness from fresh authenticated pipeline progress',async()=>{
  const f=await bootBackend();
  try {
    assert.equal((await f.request('/api/ready')).status,200);
    assert.equal((await f.request('/api/system-ready')).status,503);
    const manifest=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8'));
    const body={mode:'production',embedding_contract:manifest.legacy,state:'idle',camera_ok:true,model_ok:true,pipeline_ready:true,frame_age_seconds:.1};
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body})).status,200);
    assert.equal((await f.request('/api/system-ready')).status,200);
    await f.request('/api/worker-state',{headers:f.device,body:{...body,frame_age_seconds:6}});
    assert.equal((await f.request('/api/system-ready')).status,503);
    assert.equal((await f.request('/api/kiosk-state')).body.state,'camera_unavailable');
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body:{...body,pipeline_ready:'yes'}})).status,400);
  } finally {await f.dispose();}
});

const publisherCode = `
import json,os,sys
sys.path.insert(0,os.environ['STATUS_EDGE_PATH'])
from worker_status import WorkerStatus
health=dict(camera_opened=True,model_loaded=True,ready=True,frame_age_seconds=.1,frame_fresh=True,storage_ok=True,error=None)
def create():
    return WorkerStatus(os.environ['STATUS_BACKEND'],os.environ['STATUS_DEVICE_KEY'],json.loads(os.environ['STATUS_CONTRACT']),health=lambda:dict(health))
publisher=create()
try:
    for line in sys.stdin:
        command=json.loads(line)
        if command.get('stop'):break
        if command.get('restart'):
            publisher.stop();publisher=create()
        health.update(command.get('health',{}))
        for update in command.get('updates',[]):publisher.update(**update)
        ok=publisher.publish()
        print(json.dumps(dict(ok=ok,source=publisher.source,sequence=publisher.sequence)),flush=True)
finally:publisher.stop()
`;

test('event survives evaluation until SQL confirmation; ordered delivery, rejection and restart remain safe',async t=>{
  assert.ok(process.env.TEST_PYTHON,'TEST_PYTHON must select the native isolated interpreter');
  const backend=await bootBackend();let child,output;
  t.after(async()=>{
    try {if(child)await stopChild(child,{graceful:JSON.stringify({stop:true})+'\n'});}
    finally {output?.close();await backend.dispose();}
  });
  const contract=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).legacy;
  child=spawnTestProcess(process.env.TEST_PYTHON,['-B','-u','-c',publisherCode],{
    cwd:root,env:{...process.env,STATUS_EDGE_PATH:path.join(root,'AIOT/edge'),
      STATUS_BACKEND:backend.url,STATUS_DEVICE_KEY:backend.key,STATUS_CONTRACT:JSON.stringify(contract)},
    stdio:['pipe','pipe','pipe'],
  },[backend.key]);
  output=createInterface({input:child.stdout});
  const lines=output[Symbol.asyncIterator]();
  const send=async command=>{
    child.stdin.write(JSON.stringify(command)+'\n');
    const next=await withDeadline(lines.next(),5000,'Python status publication');
    assert.equal(next.done,false);const reply=JSON.parse(next.value);assert.equal(reply.ok,true);return reply;
  };
  const state=async()=>(await backend.request('/api/kiosk-state')).body;
  const post=body=>backend.request('/api/worker-state',{body,headers:backend.device});
  const raw=(source,sequence,event)=>({mode:'production',embedding_contract:contract,
    status_source:source,status_sequence:sequence,state:'pending',event_id:event,
    camera_ok:true,model_ok:true,pipeline_ready:true,frame_age_seconds:.1});
  for(const code of ['STATUS_A','STATUS_B'])assert.equal((await backend.request('/api/users',{
    headers:backend.admin,body:{user_code:code,full_name:'Synthetic '+code}})).status,201);
  const a=crypto.randomUUID(),b=crypto.randomUUID();
  const event=(id,code)=>({event_id:id,user_code:code,device_id:'STATUS_TEST_DEVICE',event_type:'check_in',
    timestamp:'2026-10-29T08:00:00+07:00',confidence:95});
  const pending=await send({updates:[{state:'pending',event_id:a},{state:'evaluating'}]});
  let value=await state();
  assert.equal(value.state,'pending');assert.equal(value.attendance,undefined,'no optimistic success before SQL commit');
  assert.equal((await backend.request('/api/access-events',{headers:backend.device,body:event(a,'STATUS_A')})).status,200);
  value=await state();assert.equal(value.state,'confirmed');assert.equal(value.attendance.event_id,a);
  let sequence=value.sequence;
  // Repeated evaluations between heartbeats must not replace the committed result.
  for(let i=0;i<3;i++){
    await send({updates:[{state:'evaluating'}]});value=await state();
    assert.equal(value.state,'confirmed');assert.equal(value.attendance.event_id,a);
    assert.ok(value.sequence>sequence);sequence=value.sequence;
  }
  await send({updates:[{state:'pending',event_id:b},{state:'evaluating'}]});
  value=await state();assert.equal(value.state,'pending');assert.equal(value.attendance,undefined,'new uncommitted event cannot reuse A confirmation');
  assert.equal((await backend.request('/api/access-events',{headers:backend.device,body:event(b,'STATUS_B')})).status,200);
  value=await state();assert.equal(value.state,'confirmed');assert.equal(value.attendance.event_id,b);sequence=value.sequence;
  const stale=await post(raw(pending.source,pending.sequence,a));
  assert.equal(stale.body.ignored,true);value=await state();
  assert.equal(value.sequence,sequence);assert.equal(value.attendance.event_id,b);
  assert.equal((await post(raw(pending.source,pending.sequence,b))).body.ignored,true);
  for(const rejection of [{state:'unknown'},{state:'evaluating',clear_event:true},{state:'enrollment'}]){
    await send({updates:[{state:'pending',event_id:b},rejection]});value=await state();
    assert.equal(value.state,rejection.state);assert.equal(value.attendance,undefined);
  }
  await send({updates:[{state:'pending',event_id:b}],health:{ready:false,frame_fresh:false,frame_age_seconds:6}});
  value=await state();assert.equal(value.state,'camera_unavailable');assert.equal(value.attendance,undefined);
  assert.equal((await backend.request('/api/system-ready')).status,503);
  await send({health:{ready:true,frame_fresh:true,frame_age_seconds:.1},updates:[{state:'evaluating'}]});
  assert.equal((await state()).attendance,undefined,'health recovery cannot resurrect a previous identity');
  const restarted=await send({restart:true});assert.notEqual(restarted.source,pending.source);
  value=await state();assert.equal(value.state,'idle');assert.equal(value.attendance,undefined);sequence=value.sequence;
  assert.equal((await post(raw(pending.source,999,a))).body.ignored,true,'late old-process request must not undo restart');
  assert.equal((await state()).sequence,sequence);
  await send({updates:[{state:'pending',event_id:b},{state:'evaluating'}]});
  assert.equal((await state()).attendance.event_id,b);
  assert.equal((await backend.request('/api/access-events',{headers:backend.admin})).body.data.length,2);
});

test('heartbeat ordering metadata is validated while existing unsequenced callers remain compatible',async t=>{
  const backend=await bootBackend();t.after(()=>backend.dispose());
  const contract=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).legacy;
  const body={mode:'production',embedding_contract:contract,state:'idle',camera_ok:true,model_ok:true,
    pipeline_ready:true,frame_age_seconds:.1};
  const post=body=>backend.request('/api/worker-state',{headers:backend.device,body});
  assert.equal((await backend.request('/api/worker-state',{body})).status,401);
  assert.equal((await post(body)).status,200);
  for(const extra of [{status_source:crypto.randomUUID()},{status_sequence:1},
    {status_source:'bad',status_sequence:1},{status_source:crypto.randomUUID(),status_sequence:0},
    {status_source:crypto.randomUUID(),status_sequence:1.5}])assert.equal((await post({...body,...extra})).status,400);
  assert.equal((await post({...body,status_source:crypto.randomUUID(),status_sequence:1})).status,200);
});
