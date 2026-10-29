import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {root,bootBackend,childDiagnostics,listenHttp,closeHttpServer} from './software_test_support.mjs';
import {migrateVersionedGallery,saveCandidate,candidateGallery} from '../AIOT/server/src/versioned-gallery.js';
import {cpuFixture,cpuFixtureAvailable,until} from './cpu_test_support.mjs';
import {localCheckinDate,weekRange} from '../AIOT/server/src/lab-attendance-store.js';

const require=createRequire(path.join(root,'AIOT/server/package.json')),Database=require('better-sqlite3');
function contract(version='v1') {
  return {schema:2,mode:'experimental-cpu-only',production_approved:false,dimension:512,model_id:'synthetic-not-r50',model_version:version,
    contract_id:crypto.createHash('sha256').update(version).digest('hex'),detector_sha256:'1'.repeat(64),recognizer_sha256:'2'.repeat(64),
    preprocess_id:'synthetic-test-only',alignment_id:'five-point-test-only',numeric_mode:'ort-f32-default-v1'};
}
async function marker(directory,contracts) {
  const file=path.join(directory,'cpu-test-run.json');
  await writeFile(file,JSON.stringify({schema:1,purpose:'isolated-cpu-test',run_id:crypto.randomUUID(),contracts,
    active_contract_id:contracts[0].contract_id,test_matching:{threshold:.6,minimum_margin:.05}}));
  return file;
}
async function failingLegacyAi() {
  let calls=0;
  const server=createServer((req,res)=>{calls++;req.resume();res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');});
  await listenHttp(server);
  return {url:`http://127.0.0.1:${server.address().port}`,get calls(){return calls;},dispose:()=>closeHttpServer(server)};
}
function syntheticImageForm() {
  const form=new FormData();form.append('face_image',new Blob(['synthetic non-biometric upload'],{type:'image/jpeg'}),'synthetic.jpg');return form;
}

test('additive multi-contract migration, transactional rollback and version selection preserve MBF byte-for-byte',()=>{
  const db=new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    db.exec("CREATE TABLE users(user_id INTEGER PRIMARY KEY,user_code TEXT,full_name TEXT,status TEXT); INSERT INTO users VALUES (1,'SYNTH','Synthetic','active'); CREATE TABLE face_profiles(user_id INTEGER PRIMARY KEY,embedding TEXT,embedding_contract TEXT); INSERT INTO face_profiles VALUES (1,'legacy-vector-bytes','legacy-contract-bytes');");
    const before=db.prepare('SELECT * FROM face_profiles').all(),a=contract(),b=contract('v2');
    const registry=new Map([[a.contract_id,a],[b.contract_id,b]]);
    migrateVersionedGallery(db,registry);migrateVersionedGallery(db,registry);
    const args={userId:1,contractId:a.contract_id,sessionId:'a'.repeat(32),embedding:[1,...Array(511).fill(0)]};
    assert.throws(db.transaction(()=>{saveCandidate(db,args);throw new Error('simulated commit failure');}),/simulated/);
    assert.equal(candidateGallery(db,a.contract_id).length,0);
    assert.equal(db.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,0);
    assert.equal(saveCandidate(db,args),true);assert.equal(saveCandidate(db,args),false);
    assert.throws(()=>saveCandidate(db,{...args,contractId:b.contract_id}),/binding/);
    const v1=candidateGallery(db,a.contract_id);
    saveCandidate(db,{...args,contractId:b.contract_id,sessionId:'b'.repeat(32),embedding:[0,1,...Array(510).fill(0)]});
    assert.notDeepEqual(candidateGallery(db,b.contract_id),v1);
    assert.deepEqual(candidateGallery(db,a.contract_id),v1); // rollback by explicit old contract selection, no conversion
    assert.deepEqual(db.prepare('SELECT * FROM face_profiles').all(),before);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  } finally {db.close();}
});

test('candidate endpoints disabled by default; MBF heartbeat semantics unchanged',async()=>{
  const f=await bootBackend();
  try {
    assert.equal((await f.request('/api/cpu-test/scope',{headers:f.device})).status,404);
    assert.equal((await f.request('/api/cpu-test/contracts/'+contract().contract_id+'/gallery',{headers:f.device})).status,404);
    const db=new Database(path.join(f.directory,'test.db'),{readonly:true});
    try {assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='candidate_profiles'").get().n,0);}
    finally {db.close();}
  } finally {await f.dispose();}
});

test('member profile status follows the active candidate contract without counting legacy or inactive contracts',async()=>{
  for(const purpose of ['isolated-cpu-test','isolated-r50-laptop-test']) {
    const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-')),a=contract(),b=contract('v2');
    let f;
    try {
      const file=await marker(directory,[a,b]);
      const run=JSON.parse(await readFile(file,'utf8'));run.purpose=purpose;
      await writeFile(file,JSON.stringify(run));
      f=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:file}});
      for(const user_code of ['ACTIVE_CANDIDATE','OTHER_CONTRACT','LEGACY_ONLY','NO_PROFILE']) {
        assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code,full_name:'Synthetic profile status'}})).status,201);
      }
      const db=new Database(path.join(directory,'test.db'));
      try {
        db.pragma('foreign_keys=ON');
        const userId=code=>db.prepare('SELECT user_id FROM users WHERE user_code=?').get(code).user_id;
        const embedding=[1,...Array(511).fill(0)];
        saveCandidate(db,{userId:userId('ACTIVE_CANDIDATE'),contractId:a.contract_id,sessionId:'c'.repeat(32),embedding});
        saveCandidate(db,{userId:userId('OTHER_CONTRACT'),contractId:b.contract_id,sessionId:'d'.repeat(32),embedding});
        const legacy=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).legacy;
        db.prepare('INSERT INTO face_profiles(user_id,embedding,embedding_contract) VALUES (?,?,?)')
          .run(userId('LEGACY_ONLY'),JSON.stringify(embedding),JSON.stringify(legacy));
        assert.equal(candidateGallery(db,a.contract_id).length,1);
      } finally {db.close();}
      assert.equal((await f.request('/api/users')).status,401);
      const listed=await f.request('/api/users',{headers:f.admin});
      assert.equal(listed.status,200);
      const rows=new Map(listed.body.data.map(row=>[row.user_code,row]));
      assert.equal(rows.get('ACTIVE_CANDIDATE').has_face_profile,1,purpose+': saved active candidate must be visible');
      for(const code of ['OTHER_CONTRACT','LEGACY_ONLY','NO_PROFILE']) {
        assert.equal(rows.get(code).has_face_profile,0,purpose+': incompatible or missing profile must not count');
      }
      for(const row of rows.values())assert.equal(row.face_updated_at,null);
    } finally {if(f)await f.stop();await rm(directory,{recursive:true,force:true});}
  }
});

test('member profile status retains legacy profiles outside candidate runs',async()=>{
  const f=await bootBackend();
  try {
    assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'LEGACY_STATUS',full_name:'Synthetic legacy status'}})).status,201);
    const db=new Database(path.join(f.directory,'test.db'));
    try {
      const user=db.prepare("SELECT user_id FROM users WHERE user_code='LEGACY_STATUS'").get();
      const legacy=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).legacy;
      db.prepare('INSERT INTO face_profiles(user_id,embedding,embedding_contract,updated_at) VALUES (?,?,?,?)')
        .run(user.user_id,JSON.stringify([1,...Array(511).fill(0)]),JSON.stringify(legacy),'2026-10-27T00:00:00');
    } finally {db.close();}
    const listed=await f.request('/api/users',{headers:f.admin});
    assert.equal(listed.status,200);
    assert.equal(listed.body.data[0].has_face_profile,1);
    assert.equal(listed.body.data[0].face_updated_at,'2026-10-27T00:00:00');
  } finally {await f.dispose();}
});

test('single-image enrollment in candidate runs directs admins to R50 capture without calling legacy AI or persisting profiles',async()=>{
  const ai=await failingLegacyAi();
  try {
    for(const purpose of ['isolated-r50-laptop-test','isolated-cpu-test']) {
      const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
      let f;
      try {
        const file=await marker(directory,[contract()]);
        const run=JSON.parse(await readFile(file,'utf8'));run.purpose=purpose;
        await writeFile(file,JSON.stringify(run));
        f=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:file,AI_SERVICE_URL:ai.url}});
        assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'SYNTH_UPLOAD',full_name:'Synthetic upload member'}})).status,201);
        const upload=headers=>fetch(f.url+'/api/users/SYNTH_UPLOAD/face',{method:'POST',headers,body:syntheticImageForm(),signal:AbortSignal.timeout(5000)});
        assert.equal((await upload({})).status,401);
        const response=await upload(f.admin),body=await response.json();
        assert.equal(response.status,409,purpose+': single-image upload must identify the R50 capture path');
        assert.equal(body.status,'error');assert.match(body.message,/\/r50-capture\.html/);
        assert.equal(ai.calls,0,'candidate enrollment must never call the legacy model');
        const db=new Database(path.join(directory,'test.db'),{readonly:true});
        try {
          for(const table of ['face_profiles','candidate_profiles','candidate_capture_receipts'])
            assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
        } finally {db.close();}
      } finally {if(f)await f.stop();await rm(directory,{recursive:true,force:true});}
    }
  } finally {await ai.dispose();}
});

test('single-image enrollment retains the legacy AI route outside candidate runs',async()=>{
  const ai=await failingLegacyAi();let f;
  try {
    f=await bootBackend({extra:{AI_SERVICE_URL:ai.url}});
    assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'LEGACY_UPLOAD',full_name:'Synthetic legacy upload'}})).status,201);
    const response=await fetch(f.url+'/api/users/LEGACY_UPLOAD/face',{method:'POST',headers:f.admin,body:syntheticImageForm(),signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,503);assert.equal(ai.calls,1);
    const db=new Database(path.join(f.directory,'test.db'),{readonly:true});
    try {assert.equal(db.prepare('SELECT count(*) n FROM face_profiles').get().n,0);}finally {db.close();}
  } finally {try {if(f)await f.dispose();}finally {await ai.dispose();}}
});

test('scoped contract APIs require auth, reject MBF/mismatches and refuse adopting/reusing a non-test DB',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-')),a=contract(),b=contract('v2');
  let f;
  try {
    const file=await marker(directory,[a,b]);
    f=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:file}});
    assert.equal((await f.request('/api/cpu-test/scope')).status,401);
    assert.deepEqual((await f.request('/api/cpu-test/scope',{headers:f.device})).body.embedding_contract,a);
    const gallery='/api/cpu-test/contracts/'+a.contract_id+'/gallery';
    assert.equal((await f.request(gallery)).status,401);
    assert.equal((await f.request(gallery,{headers:f.device})).status,200);
    assert.equal((await f.request(gallery.replace(a.contract_id,'f'.repeat(64)),{headers:f.device})).status,404);
    await f.request('/api/users',{headers:f.admin,body:{user_code:'SYNTH',full_name:'Synthetic'}});
    const capture=`/api/cpu-test/contracts/${a.contract_id}/users/SYNTH/capture`;
    assert.equal((await f.request(capture,{body:{frames:3}})).status,401);
    assert.equal((await f.request(capture,{headers:f.admin,body:{frames:2}})).status,400);
    assert.equal((await f.request(capture.replace(a.contract_id,b.contract_id),{headers:f.admin,body:{frames:3}})).status,409);
    const legacy=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).legacy;
    const heartbeat={mode:'production',embedding_contract:legacy,state:'idle',camera_ok:true,model_ok:true,pipeline_ready:true,frame_age_seconds:0};
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body:heartbeat})).status,400);
    assert.equal((await f.request('/api/worker-state',{headers:f.device,body:{...heartbeat,embedding_contract:a}})).status,200);
    assert.equal((await f.request('/api/system-ready')).status,200);
    await f.stop();f=null;
    await assert.rejects(bootBackend({directory}),/isolation mismatch/);
    await marker(directory,[a,b]);
    await assert.rejects(bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:file}}),/isolation mismatch/);
  } finally {if(f)await f.stop();await rm(directory,{recursive:true,force:true});}
  const normal=await bootBackend();
  try {
    await normal.stop();const file=await marker(normal.directory,[a]);
    await assert.rejects(bootBackend({directory:normal.directory,extra:{AIOT_CPU_TEST_RUN:file}}),/isolation mismatch/);
  } finally {await normal.dispose();}
});

test('isolated R50 cancellation cleans a disconnected Start and DELETE is confirmed, repeatable, and recoverable',
  {timeout:30000},async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
    const candidate=contract('f3-cancellation-test');
    const runFile=await marker(directory,[candidate]);
    const run=JSON.parse(await readFile(runFile,'utf8'));
    let backend,workerServer,active=null,postCount=0,deleteCount=0,failDelete=false,hangDelete=false;
    let announceStart,releaseStart;
    const startArrived=new Promise(resolve=>{announceStart=resolve;});
    const startGate=new Promise(resolve=>{releaseStart=resolve;});
    let delayNextStart=true;
    try {
      workerServer=createServer((req,res)=>{
        req.resume();
        const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
        if(req.method==='POST'&&req.url==='/capture-sessions') {
          postCount++;
          const value={session_id:String(postCount).padStart(32,'0'),user_code:'F3_DISCONNECT',embedding_contract:candidate,
            state:'queued',samples:0,required:3,remaining_seconds:180};
          if(delayNextStart) {
            delayNextStart=false;announceStart();
            void startGate.then(()=>{active=value;send(201,value);});
          } else {active=value;send(201,value);}
          return;
        }
        const match=req.url.match(/^\/capture-sessions\/([a-f0-9]{32})$/);
        if(!match)return send(404,{error:'not found'});
        if(req.method==='GET')return active?.session_id===match[1]?send(200,active):send(404,{error:'Capture expired or unavailable'});
        if(req.method==='DELETE') {
          deleteCount++;
          if(failDelete)return send(503,{error:'synthetic worker unavailable'});
          if(hangDelete)return;
          if(active?.session_id!==match[1])return send(404,{error:'Capture expired or unavailable'});
          active=null;return send(200,{status:'cancelled'});
        }
        return send(405,{error:'method not allowed'});
      });
      await listenHttp(workerServer);
      backend=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:runFile}});
      await backend.request('/api/users',{headers:backend.admin,body:{user_code:'F3_DISCONNECT',full_name:'Synthetic cancellation subject'}});
      const discoveryPath=path.join(directory,'cpu-worker-port.json');
      await writeFile(discoveryPath,JSON.stringify({run_id:run.run_id,port:workerServer.address().port}));
      const base=`/api/cpu-test/contracts/${candidate.contract_id}/users/F3_DISCONNECT/capture`;

      const controller=new AbortController();
      const pendingStart=fetch(backend.url+base,{method:'POST',headers:{...backend.admin,'Content-Type':'application/json'},
        body:JSON.stringify({frames:3}),signal:controller.signal}).then(response=>response, error=>error);
      await startArrived;
      controller.abort();
      const aborted=await pendingStart;
      assert.equal(aborted.name,'AbortError','the simulated browser leaves before receiving a session id');
      releaseStart();
      await until(async()=>active===null&&deleteCount===1,'server cleanup after client disconnect',5000);

      const started=await backend.request(base,{headers:backend.admin,body:{frames:3}});
      assert.equal(started.status,201);
      const session=started.body.data.session_id;
      assert.equal(active.session_id,session);
      const unauthenticated=await backend.request(base+'/'+session,{method:'DELETE'});
      assert.equal(unauthenticated.status,401);
      assert.equal(active.session_id,session,'unauthenticated DELETE must not cancel the session');

      const cancelled=await backend.request(base+'/'+session,{headers:backend.admin,method:'DELETE'});
      assert.equal(cancelled.status,200);
      assert.deepEqual(cancelled.body,{status:'success',data:{cancellation:'cancelled',confirmed:true}});
      assert.equal(active,null);
      const repeated=await backend.request(base+'/'+session,{headers:backend.admin,method:'DELETE'});
      assert.equal(repeated.status,200);
      assert.deepEqual(repeated.body,{status:'success',data:{cancellation:'already_absent',confirmed:true}});

      const recoveryStart=await backend.request(base,{headers:backend.admin,body:{frames:3}});
      assert.equal(recoveryStart.status,201);
      const recoverySession=recoveryStart.body.data.session_id;
      failDelete=true;
      const unavailable=await backend.request(base+'/'+recoverySession,{headers:backend.admin,method:'DELETE'});
      assert.equal(unavailable.status,503);
      assert.deepEqual(unavailable.body,{status:'error',data:{cancellation:'unconfirmed',confirmed:false,recovery_deadline_seconds:180}});
      assert.equal(active.session_id,recoverySession,'503 must not claim that cancellation succeeded');
      failDelete=false;
      hangDelete=true;
      const hangStarted=Date.now();
      const hungResponse=await fetch(backend.url+base+'/'+recoverySession,{method:'DELETE',headers:backend.admin,signal:AbortSignal.timeout(12000)});
      const hung={status:hungResponse.status,body:await hungResponse.json()};
      const hangElapsed=Date.now()-hangStarted;
      assert.equal(hung.status,503);
      assert.deepEqual(hung.body,{status:'error',data:{cancellation:'unconfirmed',confirmed:false,recovery_deadline_seconds:180}});
      assert.ok(hangElapsed>=4500&&hangElapsed<7500,`worker DELETE hang should be bounded by its 5s timeout; got ${hangElapsed}ms`);
      assert.equal(active.session_id,recoverySession,'a timed-out DELETE must leave cleanup unconfirmed');
      hangDelete=false;
      const recovered=await backend.request(base+'/'+recoverySession,{headers:backend.admin,method:'DELETE'});
      assert.equal(recovered.status,200);
      assert.deepEqual(recovered.body,{status:'success',data:{cancellation:'cancelled',confirmed:true}});
      assert.equal(active,null);
    } finally {
      if(backend)await backend.dispose();
      if(workerServer)await closeHttpServer(workerServer);
    }
  });

test('real CPU ONNX -> 3-frame enrollment -> gallery -> main worker -> durable ACK -> SQLite -> kiosk, restart/unknown/multiple/error',
  {skip:!cpuFixtureAvailable,timeout:90000},async t=>{
    const f=await cpuFixture({purpose:'isolated-r50-laptop-test'});t.after(()=>f.dispose());
    const b=f.backend,call=f.call;
    assert.equal((await call('/api/cpu-test/admin-scope')).body.scope,'isolated-r50-laptop-test');
    await call('/api/users',{body:{user_code:'CPU_FIXTURE_A',full_name:'Public domain smoke subject'}});
    await call('/api/users',{body:{user_code:'CPU_FIXTURE_B',full_name:'Synthetic wrong binding'}});
    await f.start();
    const placement=(await f.diagnostics()).cpu_placement;
    assert.ok(placement.process_id>0);
    assert.ok(['applied','already_applied','unchanged','fallback','not_applicable'].includes(placement.status));
    if(['applied','already_applied'].includes(placement.status))assert.ok(placement.logical_processors.length>0);
    t.diagnostic('Actual worker CPU placement: '+JSON.stringify(placement));
    const wrong={user_code:'CPU_FIXTURE_A',embedding_contract:{...f.contract,numeric_mode:'wrong'},frames:3};
    assert.equal((await fetch(f.workerUrl+'/capture-sessions',{method:'POST',headers:{...b.device,'Content-Type':'application/json'},body:JSON.stringify(wrong),signal:AbortSignal.timeout(3000)})).status,400);
    await f.control('known');
    const failedStart=await call(f.base('CPU_FIXTURE_A'),{body:{frames:3}});
    assert.equal(failedStart.status,201);
    const failedSession=failedStart.body.data.session_id;
    const failedCaptureAt=Date.now();
    await until(async()=>{
      const result=await call(f.base('CPU_FIXTURE_A')+'/'+failedSession);
      if(result.status===200)assert.equal('embedding' in result.body.data,false);
      return result.status===200&&result.body.data.state==='ready';
    },'R50 enrollment ready before injected storage failure',f.enrollmentTimeoutMs).catch(async error=>{
      const status=await call(f.base('CPU_FIXTURE_A')+'/'+failedSession).catch(value=>({error:String(value)}));
      const diagnostics=await f.diagnostics().catch(value=>({error:String(value)}));
      throw new Error(`${error.message}; status=${JSON.stringify(status)}; diagnostics=${JSON.stringify(diagnostics)}; ${childDiagnostics(f.child)}`);
    });
    t.diagnostic('3/3 capture before injected storage failure ms='+String(Date.now()-failedCaptureAt));
    const failureDb=new Database(path.join(f.directory,'test.db'));
    try {
      failureDb.exec("CREATE TRIGGER synthetic_candidate_gallery_failure BEFORE INSERT ON candidate_profiles BEGIN SELECT RAISE(ABORT,'synthetic gallery failure'); END");
      const failedCommit=await call(f.base('CPU_FIXTURE_A')+'/'+failedSession+'/commit',{body:{confirm_same_member:true}});
      assert.equal(failedCommit.status,503);
      assert.equal(failedCommit.body.status,'error');
      assert.equal(failureDb.prepare('SELECT count(*) n FROM candidate_profiles').get().n,0);
      assert.equal(failureDb.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,0);
      const released=await fetch(f.workerUrl+'/capture-sessions/'+failedSession,{headers:b.device,signal:AbortSignal.timeout(3000)});
      assert.equal(released.status,404,'failed gallery persistence must release camera enrollment mode');
      failureDb.exec('DROP TRIGGER synthetic_candidate_gallery_failure');
    } finally {failureDb.close();}
    await f.control('known');
    const enrollment=await call(f.base('CPU_FIXTURE_A'),{body:{frames:3}});
    assert.equal(enrollment.status,201);
    const session=enrollment.body.data.session_id;
    const captureAt=Date.now();
    await until(async()=>{
      const result=await call(f.base('CPU_FIXTURE_A')+'/'+session);
      if(result.status===200)assert.equal('embedding' in result.body.data,false);
      return result.status===200&&result.body.data.state==='ready';
    },'R50 enrollment ready before concurrent commit',f.enrollmentTimeoutMs);
    t.diagnostic('3/3 capture before candidate HTTP commit ms='+String(Date.now()-captureAt));
    const commitPath=f.base('CPU_FIXTURE_A')+'/'+session+'/commit';
    const concurrent=await Promise.all([
      call(commitPath,{body:{confirm_same_member:true}}),
      call(commitPath,{body:{confirm_same_member:true}}),
    ]);
    assert.deepEqual(concurrent.map(result=>result.status),[200,200]);
    assert.equal(concurrent.filter(result=>result.body.already_saved===false).length,1);
    assert.equal(concurrent.filter(result=>result.body.already_saved===true).length,1);
    assert.equal((await call(commitPath,{body:{confirm_same_member:true}})).body.already_saved,true);
    assert.equal((await call(f.base('CPU_FIXTURE_B')+'/'+session+'/commit',{body:{confirm_same_member:true}})).status,409);
    assert.equal((await b.request('/api/face-data',{headers:b.device})).body.data.length,0); // MBF untouched
    const gallery=await b.request(`/api/cpu-test/contracts/${f.contract.contract_id}/gallery`,{headers:b.device});
    assert.equal(gallery.body.data.length,1);assert.deepEqual(gallery.body.embedding_contract,f.contract);
    const state=()=>b.request('/api/kiosk-state');
    let lastState;
    const confirmed=await until(async()=>{const value=(await state()).body;lastState=value;return value.state==='confirmed'&&value;},'committed CPU recognition',f.enrollmentTimeoutMs)
      .catch(error=>{throw new Error(error.message+'; '+JSON.stringify(lastState)+'; '+childDiagnostics(f.child));});
    assert.equal(confirmed.attendance.user_code,'CPU_FIXTURE_A');
    async function steadyConfirmed(first,label) {
      let previous=first.sequence,observed=0;
      await until(async()=>{
        const value=(await state()).body;
        if(value.sequence>previous) {
          assert.equal(value.state,'confirmed',label+': evaluation replaced a committed result');
          assert.equal(value.attendance.event_id,first.attendance.event_id);
          previous=value.sequence;observed++;
        }
        return observed>=3;
      },label,10000);
      t.diagnostic(label+': 3 fresh heartbeats retained the committed event through real ONNX inference');
    }
    await steadyConfirmed(confirmed,'Committed status before restart');
    const cache=JSON.parse(await readFile(path.join(f.directory,'gallery.json'),'utf8'));
    assert.deepEqual(cache.contract,f.contract);assert.equal(cache.data.length,1);
    assert.equal(cache.data[0].user_code,'CPU_FIXTURE_A');
    t.diagnostic('CPU stage sample, not benchmark: '+JSON.stringify(await f.diagnostics()));
    const rows=await until(async()=>{const rows=await f.outboxRows();return rows.length && rows.every(r=>r.status==='acked') && rows;},'durable outbox ACK',f.enrollmentTimeoutMs);
    const id=rows[0].event_id;
    const timestamp=confirmed.attendance.event_time;
    const repeated=await b.request('/api/access-events',{body:{event_id:crypto.randomUUID(),device_id:'R50_TEST_DEVICE',
      user_code:'CPU_FIXTURE_A',event_type:'check_in',timestamp,confidence:93.5},headers:b.device});
    assert.equal(repeated.status,200);assert.equal(repeated.body.duplicate,true);
    assert.equal(repeated.body.attendance_result,'ALREADY_CHECKED_IN');
    const localDate=localCheckinDate(timestamp),week=weekRange(localDate);
    const attendance=await call(`/api/lab-attendance?week=${week.start}&month=${localDate.slice(0,7)}`);
    assert.equal(attendance.status,200);assert.equal(attendance.body.timezone,'Asia/Ho_Chi_Minh');
    const summary=attendance.body.data.find(row=>row.user_code==='CPU_FIXTURE_A');
    assert.deepEqual([summary.week_days,summary.month_days,summary.month_dates],[1,1,[localDate]]);
    const db=new Database(path.join(f.directory,'test.db'),{readonly:true});
    try {
      assert.equal(db.prepare('SELECT count(*) n FROM access_events').get().n,1);
      assert.equal(db.prepare('SELECT event_id FROM access_events WHERE event_id=?').get(id).event_id,confirmed.attendance.event_id);
      assert.equal(db.prepare('SELECT count(*) n FROM face_profiles').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,1);
      const profile=db.prepare('SELECT user_id,contract_id,embedding FROM candidate_profiles').get();
      const receipt=db.prepare('SELECT user_id,contract_id FROM candidate_capture_receipts WHERE session_id=?').get(session);
      assert.deepEqual(receipt,{user_id:profile.user_id,contract_id:f.contract.contract_id});
      assert.equal(profile.contract_id,f.contract.contract_id);
      assert.equal(JSON.parse(profile.embedding).length,512);
      assert.equal(db.prepare('SELECT count(*) n FROM lab_daily_checkins').get().n,1);
    } finally {db.close();}
    await f.stop();const lastSequence=(await state()).body.sequence,restartAt=Date.now();await f.start();
    const afterRestart=await until(async()=>{
      const value=(await state()).body;
      return value.sequence>lastSequence && value.state==='confirmed' && value;
    },'fresh recognition after actual worker restart',f.enrollmentTimeoutMs);
    assert.equal(afterRestart.attendance.user_code,'CPU_FIXTURE_A');
    assert.equal(afterRestart.attendance.event_id,id);
    await steadyConfirmed(afterRestart,'Committed status after restart');
    const reloaded=JSON.parse(await readFile(path.join(f.directory,'gallery.json'),'utf8'));
    assert.deepEqual(reloaded.contract,f.contract);assert.equal(reloaded.gallery_version,cache.gallery_version);
    assert.equal(reloaded.data.length,1);
    t.diagnostic('Worker restart through fresh recognition ms='+String(Date.now()-restartAt));
    assert.deepEqual(await f.outboxRows(),rows);
    await f.control('unknown');await until(async()=>((await state()).body.state==='unknown' && (await f.diagnostics()).detected_faces===1),'actually detected unknown identity',f.enrollmentTimeoutMs);
    await f.control('multiple');await until(async()=>((await state()).body.state==='evaluating' && (await f.diagnostics()).detected_faces===2),'actual multiple detected faces',f.enrollmentTimeoutMs);
    await f.control('blank');await until(async()=>((await state()).body.state==='idle' && (await f.diagnostics()).detected_faces===0),'no face',f.enrollmentTimeoutMs);
    assert.equal((await call('/api/access-events')).body.data.length,1);
    await f.control('camera-error');await until(async()=>((await state()).body.state==='camera_unavailable'),'camera failure notification',f.enrollmentTimeoutMs);
    assert.deepEqual(await f.outboxRows(),rows);
  });
