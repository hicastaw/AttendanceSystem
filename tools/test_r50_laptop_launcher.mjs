// Lifecycle regression for the disposable native R50 laptop launcher.
// It uses only hash-pinned public-domain fixture images and a new OS-temp DB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const launcher=path.join(root,'tools','run_r50_laptop_test.mjs');
const available=Boolean(process.env.TEST_PYTHON&&process.env.CPU_R50_DESCRIPTOR&&process.env.CPU_R50_FIXTURES);
const require=createRequire(path.join(root,'AIOT','server','package.json'));
const Database=require('better-sqlite3');

async function until(check,label,timeoutMs=45000) {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end) {
    const result=await check();if(result)return result;
    await new Promise(resolve=>setTimeout(resolve,125));
  }
  throw new Error(label+' timed out');
}

async function portClosed(port,timeoutMs=2000) {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end) {
    const closed=await new Promise(resolve=>{
      const socket=net.createConnection({host:'127.0.0.1',port});
      const done=value=>{socket.destroy();resolve(value);};
      socket.once('connect',()=>done(false));
      socket.once('error',error=>done(error.code==='ECONNREFUSED'||error.code==='ECONNRESET'));
      socket.setTimeout(300);socket.once('timeout',()=>done(false));
    });
    if(closed)return true;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  return false;
}

function parseJsonLines(output,type) {
  const found=[];
  for(const line of output.split(/\r?\n/)) {
    try {const value=JSON.parse(line);if(value?.type===type)found.push(value);}catch{}
  }
  return found;
}

test('piped stop during model inspection exits and removes only its isolated run',
  {skip:!available,timeout:20000},async()=>{
    const temporaryRoot=await mkdtemp(path.join(os.tmpdir(),'r50-launcher-start-stop-'));
    const child=spawn(process.execPath,[launcher,'--python',path.resolve(process.env.TEST_PYTHON),'--fixtures',
      path.resolve(process.env.CPU_R50_FIXTURES),'--threads',process.env.CPU_R50_THREADS||'4'],
      {cwd:root,env:{...process.env,TEMP:temporaryRoot,TMP:temporaryRoot,TMPDIR:temporaryRoot},stdio:['pipe','pipe','pipe']});
    let closed=null;
    child.stdout.resume();child.stderr.resume();
    child.once('close',(code,signal)=>{closed={code,signal};});
    try {
      child.stdin.write('stop\n');
      await until(()=>closed,'launcher exit after startup stop',12000);
      assert.equal(closed.code,0,'startup stop should finish normal cleanup');
      assert.deepEqual(await readdir(temporaryRoot),[],'launcher left its isolated run after startup stop');
    } finally {
      if(!closed) {
        if(child.stdin.writable)child.stdin.write('stop\n');
        const end=Date.now()+8000;
        while(!closed&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!closed)child.kill();
      if(closed) {
        const contents=await readdir(temporaryRoot);
        if(contents.length===0)await rm(temporaryRoot,{recursive:true,force:true});
      }
    }
  });

test('native launcher restarts its owned worker on the same isolated gallery and exits cleanly',
  {skip:!available,timeout:120000},async t=>{
    const hookRoot=await mkdtemp(path.join(os.tmpdir(),'r50-worker-startup-hook-'));
    const workerStartCount=path.join(hookRoot,'worker-start-count.txt');
    const cancelWorkerStart=path.join(hookRoot,'cancel-worker-start.txt');
    const hookSource=[
      'import os, sys, time',
      'if os.path.basename(sys.argv[0] if sys.argv else "").lower() == "run_cpu_test_worker.py":',
      '    marker = os.environ.get("R50_TEST_WORKER_START_COUNT")',
      '    if marker:',
      '        try:',
      '            with open(marker, encoding="ascii") as source:',
      '                count = int(source.read())',
      '        except (OSError, ValueError):',
      '            count = 0',
      '        count += 1',
      '        with open(marker, "w", encoding="ascii") as target:',
      '            target.write(str(count))',
      '        if count == 3:',
      '            cancel = os.environ.get("R50_TEST_CANCEL_WORKER_START")',
      '            while cancel and not os.path.exists(cancel):',
      '                time.sleep(0.02)',
      '            raise SystemExit(0)',
      '',
    ].join('\n');
    await writeFile(path.join(hookRoot,'sitecustomize.py'),hookSource);
    const pythonPath=[hookRoot,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const child=spawn(process.execPath,[launcher,'--python',path.resolve(process.env.TEST_PYTHON),'--fixtures',
      path.resolve(process.env.CPU_R50_FIXTURES),'--threads',process.env.CPU_R50_THREADS||'4'],
      {cwd:root,env:{...process.env,PYTHONPATH:pythonPath,R50_TEST_WORKER_START_COUNT:workerStartCount,
        R50_TEST_CANCEL_WORKER_START:cancelWorkerStart},stdio:['pipe','pipe','pipe']});
    let output='',closed=null,restartFailureReported=false;
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{if(chunk.includes('R50 worker restart failed:'))restartFailureReported=true;});
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.once('close',(code,signal)=>{closed={code,signal};});
    const safeRequest=async(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(5000)});
    let runDirectory,backendUrl,adminToken,contractId,initialWorkerPort,initialSequence;
    try {
      await until(()=>output.includes('R50 EXPERIMENTAL LAPTOP TEST'),'launcher fixture startup',60000);
      const url=output.match(/Admin\/create member:\s*(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      const password=output.match(/Admin password:\s*([^\r\n]+)/)?.[1];
      runDirectory=output.match(/remove only this named temp run:\s*([^\r\n]+)/)?.[1];
      contractId=output.match(/Contract:\s*([a-f0-9]{64})/i)?.[1];
      assert.ok(url&&password&&runDirectory&&contractId,'launcher readiness fields missing');
      backendUrl=url;
      const workerStarts=()=>parseJsonLines(output,'cpu-worker-listening');
      const placementStarts=()=>parseJsonLines(output,'cpu-placement');
      await until(()=>workerStarts().length===1&&placementStarts().length===1,'initial worker readiness');
      initialWorkerPort=workerStarts()[0].port;
      const login=await safeRequest(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password})});
      assert.equal(login.status,200,'isolated admin login failed');
      const loginBody=await login.json();adminToken=loginBody.data?.token;
      assert.equal(typeof adminToken,'string','isolated admin token missing');
      const admin={Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'};
      const create=await safeRequest(url+'/api/users',{method:'POST',headers:admin,
        body:JSON.stringify({user_code:'R50_LAUNCHER_FIXTURE',full_name:'Synthetic launcher fixture'})});
      assert.equal(create.status,201,'synthetic member creation failed');
      const base=`/api/cpu-test/contracts/${contractId}/users/R50_LAUNCHER_FIXTURE/capture`;
      const started=await safeRequest(url+base,{method:'POST',headers:admin,body:JSON.stringify({frames:3})});
      assert.equal(started.status,201,'fixture capture session was not created');
      const session=(await started.json()).data?.session_id;
      assert.equal(typeof session,'string','capture session ID missing');
      await until(async()=>{
        const response=await safeRequest(url+base+'/'+session,{headers:admin});
        if(response.status!==200)return false;
        const body=await response.json();
        return body.data?.state==='ready';
      },'fixture enrollment reached ready');
      const commit=await safeRequest(url+base+'/'+session+'/commit',{method:'POST',headers:admin,
        body:JSON.stringify({confirm_same_member:true})});
      assert.equal(commit.status,200,'candidate commit failed');
      await until(async()=>{
        const response=await safeRequest(url+'/api/kiosk-state');
        if(!response.ok)return false;
        const state=await response.json();
        if(state.state==='confirmed'&&state.attendance?.user_code==='R50_LAUNCHER_FIXTURE')return state;
        return false;
      },'fixture recognition and check-in after candidate save');
      const dashboard=await safeRequest(url+`/api/lab-attendance?week=2026-10-26&month=2026-10`,{headers:admin});
      assert.equal(dashboard.status,200,'isolated dashboard endpoint unavailable');
      const users=await safeRequest(url+'/api/users',{headers:{Authorization:`Bearer ${adminToken}`}});
      const userRows=(await users.json()).data;
      assert.equal(userRows.find(row=>row.user_code==='R50_LAUNCHER_FIXTURE')?.has_face_profile,1,
        'committed candidate is not listed as active');
      const database=new Database(path.join(runDirectory,'test.db'),{readonly:true});
      try {
        assert.equal(database.prepare('SELECT count(*) n FROM candidate_profiles').get().n,1);
        assert.equal(database.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,1);
        assert.equal(database.prepare('SELECT count(*) n FROM face_profiles').get().n,0);
        assert.equal(database.prepare('SELECT count(*) n FROM lab_daily_checkins').get().n,1);
      } finally {database.close();}
      const galleryPath=path.join(runDirectory,'gallery.json');
      await until(async()=>{
        try {const gallery=JSON.parse(await readFile(galleryPath,'utf8'));return gallery.data?.length===1&&gallery.contract?.contract_id===contractId?gallery:false;}
        catch{return false;}
      },'matching candidate gallery cache');
      const beforeGallery=JSON.parse(await readFile(galleryPath,'utf8'));
      const stateResponse=await safeRequest(url+'/api/kiosk-state');
      initialSequence=(await stateResponse.json()).sequence;
      child.stdin.write('restart-worker\n');
      await until(()=>workerStarts().length===2&&placementStarts().length===2,'owned worker restart',25000);
      const newPort=workerStarts()[1].port;
      assert.notEqual(newPort,initialWorkerPort,'restart reused a still-bound worker port');
      assert.notEqual(placementStarts()[1].process_id,placementStarts()[0].process_id,
        'restart did not create a new Python worker');
      assert.equal(await portClosed(initialWorkerPort),true,'previous worker port remained open');
      assert.equal((await safeRequest(url+'/api/ready')).status,200,'backend was not preserved during restart');
      const afterGallery=JSON.parse(await readFile(galleryPath,'utf8'));
      assert.equal(afterGallery.gallery_version,beforeGallery.gallery_version);
      assert.equal(afterGallery.contract.contract_id,contractId);
      assert.equal(afterGallery.data.length,1);
      const afterRestart=await until(async()=>{
        const response=await safeRequest(url+'/api/kiosk-state');if(!response.ok)return false;
        const value=await response.json();
        return value.sequence>initialSequence&&value.state==='confirmed'&&
          value.attendance?.user_code==='R50_LAUNCHER_FIXTURE'?value:false;
      },'fresh recognition from the reloaded candidate gallery');
      assert.ok(afterRestart.attendance.event_id);
      const finalDb=new Database(path.join(runDirectory,'test.db'),{readonly:true});
      try {
        assert.equal(finalDb.prepare('SELECT count(*) n FROM candidate_profiles').get().n,1);
        assert.equal(finalDb.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,1);
        assert.equal(finalDb.prepare('SELECT count(*) n FROM lab_daily_checkins').get().n,1);
      } finally {finalDb.close();}
      child.stdin.write('restart-worker\n');
      await until(async()=>{
        try{return Number(await readFile(workerStartCount,'utf8'))===3;}catch{return false;}
      },'replacement worker entered the test-only startup delay',25000);
      child.stdin.write('stop\n');
      await until(()=>output.includes('R50 stop requested.'),'launcher accepted stop during replacement startup',5000);
      await writeFile(cancelWorkerStart,'cancel');
      await until(()=>closed,'launcher process exit after piped stop',10000);
      assert.equal(closed.code,0,'launcher stop returned nonzero');
      assert.equal(workerStarts().length,2,'stop during replacement startup must not launch a ready worker');
      assert.equal(placementStarts().length,2,'cancelled replacement worker must stop before model setup');
      assert.equal(restartFailureReported,false,'intentional restart cancellation was reported as failure');
      assert.equal(await portClosed(new URL(backendUrl).port),true,'backend port remained open');
      assert.equal(await portClosed(newPort),true,'restarted worker port remained open');
      assert.equal(existsSync(runDirectory),false,'named isolated temporary run was not removed');
    } finally {
      if(!closed&&child.stdin.writable)child.stdin.write('stop\n');
      if(!closed) {
        const end=Date.now()+12000;
        while(!closed&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!closed)child.kill();
      // Credentials are deliberately kept only in this process and never included in diagnostics.
      adminToken='';
      if(closed?.code===0)await rm(hookRoot,{recursive:true,force:true});
    }
  });
