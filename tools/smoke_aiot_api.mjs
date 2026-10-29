// Uses an isolated temporary DB and random credentials. Never loads server/.env.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'aiot-api-smoke-'));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const password = crypto.randomBytes(24).toString('hex');
const key = crypto.randomBytes(24).toString('hex');
const server = spawn(process.execPath, [path.join(root, 'AIOT/server/src/index.js')], {
  cwd: temporary, env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: password,
    EDGE_DEVICE_KEY: key, DB_PATH: path.join(temporary, 'attendance.db'),
    DB_DIR: temporary, AI_SERVICE_URL: 'http://127.0.0.1:1' }, stdio: 'pipe',
});
let serverOutput = '';
server.on('error', error => { serverOutput += String(error); });
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  return { status: response.status, body: await response.json() };
}
const jsonOptions = (body, headers = {}) => ({method:'POST', headers:{'Content-Type':'application/json',...headers}, body:JSON.stringify(body)});
async function outboxPhase(python, phase, expectedExit,
  script = 'smoke_outbox_delivery.py', artifact = 'edge-outbox-smoke.db') {
  const child = spawn(python, [path.join(root, 'tools', script), phase,
    `http://127.0.0.1:${port}`, path.join(temporary, artifact)], {
    cwd: temporary, env: {...process.env, OUTBOX_SMOKE_KEY:key, PYTHONNOUSERSITE:'1'}, stdio:'pipe',
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const code = await new Promise((resolve,reject) => {
      child.once('error',reject);
      child.once('exit',resolve);
    });
    assert.equal(code,expectedExit,output);
    console.log(output.trim());
  } finally { clearTimeout(timer); }
}
try {
  let ready = false;
  let lastFailure = '';
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { ready = (await request('/api/health')).status === 200; } catch (error) { lastFailure = String(error.cause || error); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `${serverOutput}\n${lastFailure}`);
  assert.equal((await request('/api/users')).status, 401);
  assert.equal((await request('/api/face-data')).status, 401);
  const login = await request('/api/auth/login', jsonOptions({password}));
  assert.equal(login.status, 200);
  const admin = {Authorization:`Bearer ${login.body.data.token}`};
  assert.equal((await request('/api/users', jsonOptions({user_code:'TEST001',full_name:'Synthetic User'},admin))).status, 201);
  assert.equal((await request('/api/users', jsonOptions({user_code:'TEST001',full_name:'Synthetic User'},admin))).status, 409);
  const device = {'X-Device-Key':key};
  const event = {event_id:crypto.randomUUID(),device_id:'SMOKE',user_code:'TEST001',event_type:'check_in',timestamp:'2026-10-09T08:00:00+07:00',confidence:90};
  assert.equal((await request('/api/access-events',jsonOptions(event,device))).body.duplicate,false);
  assert.equal((await request('/api/access-events',jsonOptions(event,device))).body.duplicate,true);
  assert.equal((await request('/api/access-events',{headers:admin})).body.data.length,1);
  assert.equal((await request('/api/last-state',{headers:device})).body.data.TEST001,'check_in');
  assert.equal((await request('/api/face-data',{headers:device})).body.data.length,0);
  assert.equal((await request('/api/access-events',jsonOptions({...event,event_type:'bad'},device))).status,400);
  console.log('PASS: health, auth, user creation/duplicate, event idempotency, history, last-state, empty face-data, validation. No AI/enrollment hardware tested.');
  const flag = process.argv.indexOf('--outbox-python');
  if (flag !== -1) {
    assert.ok(process.argv[flag+1], 'Provide the isolated venv python.exe path');
    await outboxPhase(process.argv[flag+1],'lost-ack',23);
    const before = (await request('/api/access-events',{headers:admin})).body.data;
    assert.equal(before.length,2);  // one original smoke event + one real outbox event
    await outboxPhase(process.argv[flag+1],'replay',0);
    const after = (await request('/api/access-events',{headers:admin})).body.data;
    assert.equal(after.length,2);   // replay did not create a third row
    assert.equal(after.filter(row => row.device_id === 'OUTBOX_SMOKE').length,1);
    assert.equal((await request('/api/last-state',{headers:device})).body.data.TEST001,'check_out');
    console.log('PASS: real edge sender -> temporary backend DB, lost ACK, abrupt process exit, restart replay, exactly ONE backend row for outbox UUID. Not HIL.');
  }
  const galleryFlag = process.argv.indexOf('--gallery-python');
  const eventFlag = process.argv.indexOf('--event-python');
  if (eventFlag !== -1) {
    const python = process.argv[eventFlag+1]; assert.ok(python,'Provide isolated Python');
    const call = (route,body,method='POST')=>request(`/api${route}`,{...jsonOptions(body,admin),method});
    assert.equal((await request('/api/scheduled-events')).status,401);
    assert.equal((await request('/api/attendance-policy?day=2026-10-12')).status,401);
    assert.equal((await request('/api/attendance-policy?day=2026-02-30',{headers:device})).status,400);
    const schedules=(await request('/api/scheduled-events',{headers:admin})).body.data;
    assert.equal(schedules.length,2);
    const phase = name=>outboxPhase(python,name,0,'smoke_event_attendance.py','event-attendance-smoke.db');
    await phase('morning');await phase('restart');await phase('fresh-ledger');await phase('afternoon');await phase('outside');
    const records=(await request('/api/access-events',{headers:admin})).body.data.filter(r=>r.device_id==='EVENT_SMOKE');
    assert.equal(records.length,3);
    assert.equal(records.filter(r=>r.occurrence_key==='default-morning:2026-10-12').length,1);
    assert.equal(records.filter(r=>r.occurrence_key==='default-afternoon:2026-10-12').length,1);
    assert.equal(records.find(r=>r.event_time==='2026-10-12T18:00:00+07:00').scheduled_event_id,null);
    const base={name:'Meeting',start_time:'19:00',end_time:'20:00',weekdays:[],date:'2026-10-12',active:true};
    assert.equal((await call('/scheduled-events',{...base,start_time:'08:00',end_time:'09:00'})).status,400);
    assert.equal((await call('/scheduled-events',{...base,date:'2026-02-30'})).status,400);
    assert.equal((await call('/scheduled-events',{...base,start_time:'22:00',end_time:'01:00'})).status,400);
    const created=await call('/scheduled-events',base);assert.equal(created.status,201);
    const id=created.body.data.schedule_id;
    assert.equal((await call('/scheduled-events',base)).status,400); // overlapping one-off
    const delayed={event_id:crypto.randomUUID(),device_id:'EVENT_API_SMOKE',user_code:'TEST001',event_type:'check_in',timestamp:'2026-10-12T19:15:00+07:00',confidence:80};
    const response=await request('/api/access-events',jsonOptions(delayed,device));
    assert.equal(response.body.attendance_context.scheduled_event_id,id);
    assert.equal((await call(`/scheduled-events/${id}`,{active:false},'PATCH')).status,200);
    const replay=await request('/api/access-events',jsonOptions(delayed,device));
    assert.equal(replay.body.duplicate,true);assert.deepEqual(replay.body.attendance_context,response.body.attendance_context);
    assert.equal((await request('/api/access-events',jsonOptions({...delayed,timestamp:'2026-10-12T19:16:00+07:00'},device))).status,409);
    for (const timestamp of ['2026-10-12T12:00:00+07:00','2026-10-11T08:00:00+07:00','2026-10-12T19:30:00+07:00']) {
      const r=await request('/api/access-events',jsonOptions({...delayed,event_id:crypto.randomUUID(),timestamp},device));
      assert.equal(r.status,200);assert.equal(r.body.attendance_context.occurrence_key,null);
    }
    const utc=await request('/api/access-events',jsonOptions({...delayed,event_id:crypto.randomUUID(),timestamp:'2026-10-13T00:00:00Z'},device));
    assert.equal(utc.body.attendance_context.occurrence_key,'default-morning:2026-10-13');
    const invalid=await request('/api/access-events',jsonOptions({...delayed,event_id:crypto.randomUUID(),timestamp:'2026-10-12T08:00:00'},device));
    assert.equal(invalid.status,400);
    const page=await fetch(`http://127.0.0.1:${port}/index.html`);assert.equal(page.status,200);
    const markup=await page.text();
    assert.ok(markup.includes('event-form') && markup.includes('Đặt sự kiện'));
    console.log('PASS: event calendar API, overlap/boundaries/UTC7/outside/date scheduling, immutable replay, real check-in sender/new-process/fresh-ledger sync. UI HTML served; not browser/HIL.');
  }
  if (galleryFlag !== -1) {
    const python = process.argv[galleryFlag+1];
    assert.ok(python, 'Provide isolated venv python.exe');
    // TEST FIXTURE ONLY: never opens the production DB. Insert numeric synthetic
    // embeddings directly, since enrollment hardware/images are outside this smoke.
    const require = createRequire(path.join(root, 'AIOT/server/package.json'));
    const Database = require('better-sqlite3');
    const fixturePath = path.join(temporary,'attendance.db');
    assert.equal(path.dirname(path.resolve(fixturePath)), path.resolve(temporary));
    for (let i=2; i<=30; i++) {
      const code = `TEST${String(i).padStart(3,'0')}`;
      assert.equal((await request('/api/users',jsonOptions({user_code:code,full_name:`Synthetic member ${i}`},admin))).status,201);
    }
    const fixture = new Database(fixturePath);
    try {
      fixture.transaction(() => {
        const insert = fixture.prepare('INSERT INTO face_profiles(user_id,embedding) VALUES (?,?)');
        const users = fixture.prepare('SELECT user_id FROM users ORDER BY user_code').all();
        assert.equal(users.length,30);
        users.forEach((user,i) => {
          const vector = Array(512).fill(0); vector[i]=1;
          insert.run(user.user_id,JSON.stringify(vector));
        });
      })();
      const galleryPhase = phase => outboxPhase(python,phase,0,'smoke_member_gallery.py','member-gallery-smoke.json');
      await galleryPhase('full');
      assert.equal(fixture.prepare("UPDATE users SET status='inactive' WHERE user_code='TEST001'").run().changes,1);
      await galleryPhase('removed');
      fixture.prepare("UPDATE users SET status='inactive'").run();
      await galleryPhase('empty');
      await galleryPhase('offline-restart');
      console.log('PASS: gallery real API filter active, 30 -> 29 -> 0, revision/cache/restart, synthetic fixtures only. Not enrollment/HIL.');
    } finally { fixture.close(); }
  }
} finally {
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit',resolve));
    server.kill();
    await stopped;
  }
  await rm(temporary,{recursive:true,force:true});
}
