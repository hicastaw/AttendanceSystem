import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from '../AIOT/server/node_modules/better-sqlite3/lib/index.js';
import {bootBackend} from './software_test_support.mjs';
import {localCheckinDate,weekRange,monthRange} from '../AIOT/server/src/lab-attendance-store.js';

test('Vietnam local-day boundaries, Monday week and leap month are explicit',()=>{
  assert.equal(localCheckinDate('2026-10-26T16:59:59Z'),'2026-10-26');
  assert.equal(localCheckinDate('2026-10-26T17:00:00Z'),'2026-10-27');
  assert.deepEqual(weekRange('2026-10-28'),{start:'2026-10-26',end:'2026-11-02'});
  assert.deepEqual(monthRange('2024-02'),{start:'2024-02-01',end:'2024-03-01'});
  assert.equal(localCheckinDate('2026-10-26T17:00:00'),'2026-10-26','legacy naive timestamps are treated as Vietnam-local wall time');
});

test('isolated R50 run enforces one daily check-in and reports committed member-days',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  const runPath=path.join(directory,'cpu-test-run.json');
  const runId=crypto.randomUUID();
  const contract={schema:2,mode:'experimental-cpu-only',production_approved:false,dimension:512,
    contract_id:crypto.randomBytes(32).toString('hex'),detector_sha256:crypto.randomBytes(32).toString('hex'),
    recognizer_sha256:crypto.randomBytes(32).toString('hex'),model_id:'test-model',model_version:'test-version',
    preprocess_id:'test-preprocess',alignment_id:'test-alignment',numeric_mode:'ort-f32-default-v1'};
  await writeFile(runPath,JSON.stringify({schema:1,purpose:'isolated-r50-laptop-test',run_id:runId,
    contracts:[contract],active_contract_id:contract.contract_id}));
  const legacyDb=new Database(path.join(directory,'test.db'));
  legacyDb.exec(await readFile(new URL('../AIOT/server/src/schema.sql',import.meta.url),'utf8'));
  legacyDb.exec(`CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE event_receipts(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,
      attendance_event_id TEXT NOT NULL REFERENCES access_events(event_id));`);
  legacyDb.prepare('INSERT INTO app_metadata VALUES (?,?)').run('runtime_mode','production');
  legacyDb.prepare('INSERT INTO app_metadata VALUES (?,?)').run('cpu_test_run',runId);
  legacyDb.pragma('user_version=1');
  const legacyUser=legacyDb.prepare('INSERT INTO users(user_code,full_name) VALUES (?,?)').run('LEGACY001','Prior member').lastInsertRowid;
  const legacyEvent=legacyDb.prepare(`INSERT INTO access_events(event_id,user_id,device_id,event_type,event_time)
    VALUES (?,?,?,'check_in',?)`);
  legacyEvent.run(crypto.randomUUID(),legacyUser,'LEGACY_DEVICE','2026-10-26T09:00:00+07:00');
  legacyEvent.run(crypto.randomUUID(),legacyUser,'LEGACY_DEVICE','2026-10-26T10:00:00+07:00');
  legacyDb.prepare(`INSERT INTO access_events(event_id,user_id,device_id,event_type,event_time)
    VALUES (?,?,?,'check_out',?)`).run(crypto.randomUUID(),legacyUser,'LEGACY_DEVICE','2026-10-26T11:00:00+07:00');
  legacyDb.close();
  let backend;
  try {
    backend=await bootBackend({directory,extra:{AIOT_CPU_TEST_RUN:runPath}});
    const headers={...backend.device};
    for(const [user_code,full_name] of [['LAB001','Lab Member One'],['LAB002','Lab Member Two'],['LAB000','No Attendance']]) {
      assert.equal((await backend.request('/api/users',{body:{user_code,full_name},headers:backend.admin})).status,201);
    }
    const event=(user_code,timestamp,event_id=crypto.randomUUID(),event_type='check_in')=>({
      event_id,device_id:'R50_TEST_DEVICE',user_code,event_type,timestamp,confidence:93.5,
    });
    const first=event('LAB001','2026-10-26T16:59:59Z');
    const saved=await backend.request('/api/access-events',{body:first,headers});
    assert.equal(saved.status,200);assert.equal(saved.body.duplicate,false);assert.equal(saved.body.attendance_result,'CHECK_IN_SUCCESS');
    const duplicate=await backend.request('/api/access-events',{body:event('LAB001','2026-10-26T16:30:00Z'),headers});
    assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.attendance_result,'ALREADY_CHECKED_IN');
    const workerState=await backend.request('/api/worker-state',{body:{mode:'production',embedding_contract:contract,
      state:'pending',event_id:duplicate.body.data.event_id,camera_ok:true,model_ok:true,pipeline_ready:true,frame_age_seconds:0},headers});
    assert.equal(workerState.status,200);
    const kiosk=await backend.request('/api/kiosk-state');
    assert.equal(kiosk.body.state,'confirmed');assert.equal(kiosk.body.attendance_result,'ALREADY_CHECKED_IN');
    const replay=await backend.request('/api/access-events',{body:first,headers});
    assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);
    const nextDay=await backend.request('/api/access-events',{body:event('LAB001','2026-10-27T17:00:00Z'),headers});
    assert.equal(nextDay.status,200);assert.equal(nextDay.body.duplicate,false);
    const checkout=await backend.request('/api/access-events',{body:event('LAB001','2026-10-26T17:30:00Z',crypto.randomUUID(),'check_out'),headers});
    assert.equal(checkout.status,200);assert.equal(checkout.body.attendance_result,undefined);
    const concurrent=await Promise.all([
      backend.request('/api/access-events',{body:event('LAB002','2026-10-26T17:00:00Z'),headers}),
      backend.request('/api/access-events',{body:event('LAB002','2026-10-26T18:00:00Z'),headers}),
    ]);
    assert.ok(concurrent.every(result=>result.status===200));
    assert.equal(concurrent.filter(result=>result.body.duplicate===false).length,1);
    assert.equal(concurrent.filter(result=>result.body.duplicate===true).length,1);
    assert.equal((await backend.request('/api/lab-attendance?week=2026-10-26&month=2026-10')).status,401);
    const report=await backend.request('/api/lab-attendance?week=2026-10-26&month=2026-10',{headers:backend.admin});
    assert.equal(report.status,200);assert.equal(report.body.timezone,'Asia/Ho_Chi_Minh');
    const [one,two,zero,legacy]=report.body.data;
    assert.deepEqual([one.user_code,one.week_days,one.month_days,one.month_dates],['LAB000',0,0,[]]);
    assert.deepEqual([two.user_code,two.week_days,two.month_days,two.month_dates],['LAB001',2,2,['2026-10-26','2026-10-28']]);
    assert.deepEqual([zero.user_code,zero.week_days,zero.month_days,zero.month_dates],['LAB002',1,1,['2026-10-27']]);
    assert.deepEqual([legacy.user_code,legacy.week_days,legacy.month_days,legacy.month_dates],['LEGACY001',1,1,['2026-10-26']],
      'legacy duplicate check-in history is preserved and backfilled as one daily presence');
    const events=await backend.request('/api/access-events',{headers:backend.admin});
    assert.equal(events.body.data.length,7,'duplicates add receipts while earlier check-in/checkout rows remain intact');
    assert.equal((await backend.request('/api/cpu-test/camera/diagnostics')).status,401);
    assert.equal((await backend.request('/api/cpu-test/camera/diagnostics',{headers:backend.admin})).status,503,
      'camera diagnostics fail closed when the single worker is unavailable');
    await backend.dispose();backend=null;
    backend=await bootBackend();
    assert.equal((await backend.request('/api/lab-attendance?week=2026-10-26&month=2026-10')).status,404,
      'daily tracker is hidden outside an isolated R50 run');
  } finally {
    if(backend)await backend.dispose();
    else await (await import('node:fs/promises')).rm(directory,{recursive:true,force:true});
  }
});

