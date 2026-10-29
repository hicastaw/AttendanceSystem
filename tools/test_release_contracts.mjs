// API/config/startup/shutdown regressions. Temp databases and synthetic metadata only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {bootBackend,root,waitForChild,closeHttpServer,listenHttp} from './software_test_support.mjs';
const require=createRequire(path.join(root,'AIOT/server/package.json'));
const Database=require('better-sqlite3');

test('invalid APP_MODE fails before creating a database and future schema is preserved',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));
  try {
    await assert.rejects(bootBackend({directory,extra:{APP_MODE:'invalid'}}),/APP_MODE/);
    const target=path.join(directory,'test.db');await assert.rejects(access(target),{code:'ENOENT'});
    let db=new Database(target);db.pragma('user_version = 99');db.exec('CREATE TABLE sentinel(value TEXT);INSERT INTO sentinel VALUES (\'synthetic\')');db.close();
    await assert.rejects(bootBackend({directory}),/Unsupported backend schema version/);
    db=new Database(target,{readonly:true});
    try {assert.equal(db.pragma('user_version',{simple:true}),99);assert.equal(db.prepare('SELECT value FROM sentinel').get().value,'synthetic');}
    finally {db.close();}
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('API guards and malformed payload errors return JSON without exposing credentials',async()=>{
  const f=await bootBackend();
  try {
    for(const route of ['/api/users','/api/access-events','/api/scheduled-events','/api/face-data','/api/attendance-policy?day=2026-10-18'])
      assert.equal((await f.request(route)).status,401,route);
    const malformed=await fetch(f.url+'/api/access-events',{method:'POST',headers:{'Content-Type':'application/json',...f.device},body:'{',signal:AbortSignal.timeout(3000)});
    assert.equal(malformed.status,400);assert.match(malformed.headers.get('content-type'),/application\/json/);
    const body=await malformed.text();assert.ok(!body.includes(f.key));assert.ok(!body.includes(f.password));
    assert.equal((await f.request('/api/attendance-policy?day=invalid',{headers:f.device})).status,400);
    assert.equal((await f.request('/api/users/UNKNOWN',{method:'PATCH',headers:f.admin,body:{status:'inactive'}})).status,404);
  } finally {await f.dispose();}
});

test('occupied port startup fails boundedly without terminating another listener',async()=>{
  const server=http.createServer((_req,res)=>res.end('owned-synthetic-listener'));
  await listenHttp(server);
  try {
    const port=server.address().port;
    await assert.rejects(bootBackend({extra:{PORT:String(port)}}),/EADDRINUSE/);
    const response=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)});
    assert.equal(await response.text(),'owned-synthetic-listener');
  } finally {await closeHttpServer(server);}
});

test('production shutdown handlers close HTTP and preserve committed synthetic records',async()=>{
  for(const signal of ['SIGTERM','SIGINT']) {
    const script=`await import(${JSON.stringify(pathToFileURL(path.join(root,'AIOT/server/src/index.js')).href)});
      process.on('message',m=>{if(m?.type==='synthetic-shutdown')process.emit(m.signal);});`;
    const f=await bootBackend({serverArgs:['--input-type=module','-e',script]});
    try {
      assert.equal((await f.request('/api/users',{headers:f.admin,body:{user_code:'SHUTDOWN01',full_name:'Synthetic shutdown'}})).status,201);
      f.child.send({type:'synthetic-shutdown',signal});
      assert.equal(await waitForChild(f.child,{label:signal+' handler'}),0);
      await assert.rejects(fetch(f.url+'/api/health',{signal:AbortSignal.timeout(1000)}));
      const db=new Database(path.join(f.directory,'test.db'),{readonly:true});
      try {assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);}
      finally {db.close();}
    } finally {await f.dispose();}
  }
});

test('upload guards reject unauthenticated, wrong-MIME, unexpected-field and oversized synthetic payloads before AI',async()=>{
  let aiRequests=0;
  const peer=http.createServer((_req,res)=>{aiRequests++;res.end('{}');});
  await listenHttp(peer);
  let f;
  try {
    f=await bootBackend({extra:{AI_SERVICE_URL:`http://127.0.0.1:${peer.address().port}`}});
    for(const [type,size,field,authorized,expected] of [
      ['text/plain',1,'face_image',false,401],
      ['text/plain',1,'face_image',true,400],
      ['image/png',1,'wrong_field',true,400],
      ['image/png',10*1024*1024+1,'face_image',true,413],
    ]) {
      const form=new FormData();form.set(field,new Blob([new Uint8Array(size)],{type}),'synthetic.bin');
      const response=await fetch(f.url+'/api/users/SYNTHETIC/face',{method:'POST',body:form,
        headers:authorized?f.admin:{},signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,expected);
      assert.match(response.headers.get('content-type'),/application\/json/);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('access-control-allow-origin'),null);
      const text=await response.text();assert.ok(!text.includes(f.key));assert.ok(!text.includes(f.password));
    }
    assert.equal(aiRequests,0);
    const fields=new FormData();fields.set('items[4294967294]','synthetic');fields.set('items[name]','synthetic');
    const rejected=await fetch(f.url+'/api/users/SYNTHETIC/face',{method:'POST',body:fields,headers:f.admin,signal:AbortSignal.timeout(3000)});
    assert.equal(rejected.status,400);await rejected.arrayBuffer();
    assert.equal((await f.request('/api/health')).status,200,'malformed multipart must not crash or hang backend');
    assert.deepEqual((await f.request('/api/users',{headers:f.admin})).body.data,[]);
  } finally {if(f)await f.dispose();await closeHttpServer(peer);}
});
