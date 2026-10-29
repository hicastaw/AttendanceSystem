// Isolated API + real-ONNX fixture coverage; never opens a physical camera.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {bootBackend,root} from './software_test_support.mjs';
import {cpuFixture,cpuFixtureAvailable,until} from './cpu_test_support.mjs';
import {localCheckinDate,weekRange} from '../AIOT/server/src/lab-attendance-store.js';
const require=createRequire(path.join(root,'AIOT/server/package.json')),Database=require('better-sqlite3');

test('member creation returns canonical Unicode identity, explicit errors, and unenrolled state',async()=>{
  const b=await bootBackend();
  try {
    assert.equal((await b.request('/api/users',{body:{user_code:'NEW',full_name:'Synthetic'}})).status,401);
    for(const body of [{user_code:'',full_name:'Name'},{user_code:'CODE',full_name:'  '},{user_code:'bad/code',full_name:'Name'}])
      assert.equal((await b.request('/api/users',{headers:b.admin,body})).status,400);
    const created=await b.request('/api/users',{headers:b.admin,body:{user_code:'  lab_01 ',full_name:'  Nguyễn   Văn An  '}});
    assert.equal(created.status,201);
    assert.equal(created.body.data.user_code,'LAB_01');
    assert.equal(created.body.data.full_name,'Nguyễn Văn An');
    assert.equal(created.body.data.has_face_profile,0);
    const duplicate=await b.request('/api/users',{headers:b.admin,body:{user_code:'lab_01',full_name:'Must not overwrite'}});
    assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'duplicate_member_code');
    const member=(await b.request('/api/users',{headers:b.admin})).body.data[0];
    assert.equal(member.full_name,'Nguyễn Văn An');assert.equal(member.has_face_profile,0);
  } finally {await b.dispose();}
});

test('one camera image and one JPEG/PNG upload share durable R50 receipts, restart recognition, daily dedup and statistics',
  {skip:!cpuFixtureAvailable,timeout:120000},async t=>{
    const f=await cpuFixture({purpose:'isolated-r50-laptop-test'});t.after(()=>f.dispose());
    const b=f.backend,call=f.call;
    const created=await call('/api/users',{body:{user_code:'ONE_IMAGE',full_name:'Synthetic public-domain subject'}});
    assert.equal(created.body.data.has_face_profile,0);
    await call('/api/users',{body:{user_code:'WRONG_MEMBER',full_name:'Synthetic binding check'}});
    const base=f.base('ONE_IMAGE');await f.start();
    const waitReady=async sid=>until(async()=>{
      const response=await call(base+'/'+sid);assert.equal(response.status,200);
      assert.equal('embedding' in response.body.data,false);
      if(response.body.data.state==='rejected')throw Error('Unexpected fixture rejection: '+response.body.data.reason);
      return response.body.data.state==='ready'&&response.body.data;
    },'one-image ready',f.enrollmentTimeoutMs);
    const blank=async()=>{await f.control('blank');await until(async()=>(await f.diagnostics()).detected_faces===0,'blank live input',15000);};
    assert.equal((await b.request(base,{body:{frames:1}})).status,401);
    assert.equal((await call(base.replace('/ONE_IMAGE/','//'),{body:{frames:1}})).status,400);
    await call('/api/users/WRONG_MEMBER',{method:'PATCH',body:{status:'inactive'}});
    const inactive=await call(f.base('WRONG_MEMBER'),{body:{frames:1}});
    assert.equal(inactive.status,409);assert.equal(inactive.body.code,'member_inactive');
    await call('/api/users/WRONG_MEMBER',{method:'PATCH',body:{status:'active'}});
    await f.control('known');
    const camera=await call(base,{body:{source:'camera'}});assert.equal(camera.status,201);
    const cameraId=camera.body.data.session_id;const ready=await waitReady(cameraId);
    assert.deepEqual([ready.source,ready.required,ready.samples],['camera',1,1]);
    assert.equal((await b.request(base+'/'+cameraId+'/preview')).status,401);
    const preview=await fetch(b.url+base+'/'+cameraId+'/preview',{headers:b.admin});assert.equal(preview.status,200);
    assert.match(preview.headers.get('content-type'),/image\/jpeg/);assert.equal(new Uint8Array(await preview.arrayBuffer())[0],255);
    assert.equal((await call(f.base('WRONG_MEMBER')+'/'+cameraId+'/preview')).status,409);
    await blank();
    assert.equal((await call(base+'/'+cameraId+'/commit',{body:{confirm_same_member:false}})).status,400);
    const commits=await Promise.all([1,2].map(()=>call(base+'/'+cameraId+'/commit',{body:{confirm_same_member:true}})));
    assert.deepEqual(commits.map(v=>v.status),[200,200]);
    assert.equal(commits.filter(v=>v.body.already_saved===false).length,1);
    assert.equal(commits[0].body.data.receipt.session_id,cameraId);
    const db=new Database(path.join(f.directory,'test.db'));
    const counts=()=>({profiles:db.prepare('SELECT count(*) n FROM candidate_profiles').get().n,
      receipts:db.prepare('SELECT count(*) n FROM candidate_capture_receipts').get().n,
      attendance:db.prepare('SELECT count(*) n FROM lab_daily_checkins').get().n});
    try {
      assert.deepEqual(counts(),{profiles:1,receipts:1,attendance:0});
      await f.control('known-variant');
      await until(async()=>(await b.request('/api/kiosk-state')).body.state==='confirmed','one-camera recognition',f.enrollmentTimeoutMs);
      assert.equal(counts().attendance,1);
      await blank();
      const generated=spawnSync(process.env.TEST_PYTHON,['-B','-c',
        "import sys,io,json,base64,cv2,numpy as np; from PIL import Image; from pathlib import Path; raw=(Path(sys.argv[1])/'astronaut.png').read_bytes(); im=cv2.imdecode(np.frombuffer(raw,np.uint8),1); out=io.BytesIO(); Image.open(io.BytesIO(raw)).convert('RGB').save(out,format='JPEG',quality=95); enc=lambda x:base64.b64encode(x).decode(); png=lambda x:cv2.imencode('.png',x)[1].tobytes(); wide=io.BytesIO(); Image.new('RGB',(4097,1)).save(wide,format='PNG'); print(json.dumps(dict(png=enc(raw),jpeg=enc(out.getvalue()),blank=enc(png(np.zeros_like(im))),multiple=enc(png(np.concatenate([im,im],axis=1))),blur=enc(png(cv2.GaussianBlur(im,(45,45),20))),wide=enc(wide.getvalue()))))",
        process.env.CPU_R50_FIXTURES],{encoding:'utf8',maxBuffer:12*1024*1024});
      assert.equal(generated.status,0,'RAM fixture encoding failed');
      const images=Object.fromEntries(Object.entries(JSON.parse(generated.stdout)).map(([key,value])=>[key,Buffer.from(value,'base64')]));
      const upload=async(data,type='image/png',headers=b.admin,files=1)=>{
        const form=new FormData();for(let i=0;i<files;i++)form.append('face_image',new Blob([data],{type}),'untrusted-name.'+(type==='image/png'?'png':'jpg'));
        const response=await fetch(b.url+base,{method:'POST',headers,body:form,signal:AbortSignal.timeout(12000)});
        return {status:response.status,body:await response.json()};
      };
      assert.equal((await upload(images.png,'image/png',{})).status,401);
      for(const [data,type,status] of [[Buffer.from('bad'),'image/png',400],[images.png,'image/jpeg',415],
        [Buffer.from('gif'),'image/gif',415],[Buffer.alloc(5*1024*1024+1),'image/jpeg',413],[images.wide,'image/png',413]]) {
        assert.equal((await upload(data,type)).status,status);
        assert.deepEqual(counts(),{profiles:1,receipts:1,attendance:1});
      }
      assert.equal((await upload(images.png,'image/png',b.admin,2)).status,400);
      for(const [key,reasons] of [['blank',['no_face']],['multiple',['multiple_faces']],['blur',['image_blurry','no_face']]]) {
        const rejected=await upload(images[key]);assert.equal(rejected.status,201);
        const sid=rejected.body.data.session_id;
        const terminal=await until(async()=>{const v=(await call(base+'/'+sid)).body.data;return v.state==='rejected'&&v;},'upload '+key+' rejection',15000);
        assert.ok(reasons.includes(terminal.reason),terminal.reason);assert.equal(counts().receipts,1);
        assert.equal((await call(base+'/'+sid,{method:'DELETE'})).body.data.confirmed,true);
      }
      const before=db.prepare('SELECT embedding FROM candidate_profiles').get().embedding;
      const failing=await upload(images.png);assert.equal(failing.status,201);await waitReady(failing.body.data.session_id);
      db.exec("CREATE TRIGGER synthetic_one_image_failure BEFORE UPDATE ON candidate_profiles BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
      const failed=await call(base+'/'+failing.body.data.session_id+'/commit',{body:{confirm_same_member:true}});assert.equal(failed.status,503);
      db.exec('DROP TRIGGER synthetic_one_image_failure');assert.equal(db.prepare('SELECT embedding FROM candidate_profiles').get().embedding,before);
      assert.equal((await call(base+'/'+failing.body.data.session_id)).status,404);
      for(const [key,mime] of [['png','image/png'],['jpeg','image/jpeg']]) {
        const response=await upload(images[key],mime);assert.equal(response.status,201);
        const sid=response.body.data.session_id;const result=await waitReady(sid);
        assert.deepEqual([result.source,result.required,result.samples],['upload',1,1]);
        assert.equal(counts().attendance,1,'uploading the photograph must not emit attendance');
        assert.equal((await call(base+'/'+sid+'/commit',{body:{confirm_same_member:true}})).status,200);
        assert.equal((await call(base+'/'+sid+'/commit',{body:{confirm_same_member:true}})).body.already_saved,true);
      }
      assert.deepEqual(counts(),{profiles:1,receipts:3,attendance:1});
      const previousSequence=(await b.request('/api/kiosk-state')).body.sequence;
      await f.stop();await f.start();await f.control('known-variant');
      await until(async()=>{const state=(await b.request('/api/kiosk-state')).body;return state.sequence>previousSequence&&state.state==='confirmed';},'uploaded profile restart recognition',f.enrollmentTimeoutMs);
      for(const scenario of ['unknown','multiple']) {
        const oldSequence=(await b.request('/api/kiosk-state')).body.sequence;
        await f.control(scenario);await until(async()=>{const d=await f.diagnostics();return d.detected_faces===(scenario==='multiple'?2:1);},scenario+' actual detection',15000);
        await until(async()=>{const state=(await b.request('/api/kiosk-state')).body;return state.sequence>oldSequence&&state.state===(scenario==='multiple'?'evaluating':'unknown');},scenario+' rejection state',15000);
        assert.equal(counts().attendance,1);
      }
      const row=db.prepare('SELECT event_time FROM lab_daily_checkins').get();const date=localCheckinDate(row.event_time);
      const summary=await call(`/api/lab-attendance?week=${weekRange(date).start}&month=${date.slice(0,7)}`);
      const member=summary.body.data.find(v=>v.user_code==='ONE_IMAGE');assert.deepEqual([member.week_days,member.month_days],[1,1]);
      assert.equal(db.prepare('SELECT count(*) n FROM face_profiles').get().n,0);
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
      const cache=JSON.parse(await readFile(path.join(f.directory,'gallery.json'),'utf8'));assert.deepEqual(cache.contract,f.contract);
      assert.equal((await readdir(f.directory)).some(name=>/\.(png|jpe?g)$/i.test(name)),false,'raw images must not be persisted in the run');
      t.diagnostic('One-image camera + PNG/JPEG upload, receipts, restart recognition, daily ledger and statistics verified; no physical camera.');
    } finally {db.close();}
  });
