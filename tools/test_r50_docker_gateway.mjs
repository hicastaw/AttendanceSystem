import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {FrameBuffer,createGateway} from '../deploy/r50-docker/gateway.mjs';
import {listenHttp,closeHttpServer} from './software_test_support.mjs';

test('browser frame buffer expires frames, never replays a sequence and excludes a second owner',()=>{
  let now=10000;const frames=new FrameBuffer(()=>now);
  const session='a'.repeat(36),other='b'.repeat(36);
  frames.put(Buffer.from([255,216,255,217]),session,now);
  assert.equal(frames.next(0).sequence,1);assert.equal(frames.next(1),null);
  assert.throws(()=>frames.put(Buffer.from('different'),other,now),/Another browser/);
  now+=1501;assert.equal(frames.next(0),null);
  assert.throws(()=>frames.put(Buffer.from('stale'),session,10000),/stale/);
  now+=500;frames.put(Buffer.from('fresh'),other,now);assert.equal(frames.next(1).sequence,2);
});

test('Docker webcam gateway requires admin, same origin and internal key, and bounds frame data',async()=>{
  const backend=http.createServer((req,res)=>{res.writeHead(req.headers.authorization==='Bearer synthetic'?200:401,{'Content-Type':'application/json'});res.end('{}');});
  await listenHttp(backend);
  const gateway=createGateway({backendUrl:`http://127.0.0.1:${backend.address().port}`,deviceKey:'test-device-key'});
  await listenHttp(gateway);const url=`http://127.0.0.1:${gateway.address().port}`;
  const headers={Origin:url,Authorization:'Bearer synthetic','Content-Type':'image/jpeg','X-Camera-Session':'a'.repeat(36),'X-Captured-At':String(Date.now())};
  const put=extra=>fetch(url+'/__browser-camera/frame',{method:'POST',headers:{...headers,...extra},body:Buffer.from([255,216,255,217])});
  try {
    assert.equal((await put({Authorization:''})).status,401);
    assert.equal((await put({Origin:'http://untrusted.example'})).status,403);
    assert.equal((await put({'Content-Type':'text/plain'})).status,415);
    assert.equal((await put({'X-Captured-At':String(Date.now()-5000)})).status,400);
    assert.equal((await put({})).status,204);
    assert.equal((await fetch(url+'/__browser-camera/next?after=0')).status,401);
    const frame=await fetch(url+'/__browser-camera/next?after=0',{headers:{'X-Device-Key':'test-device-key'}});
    assert.equal(frame.status,200);assert.equal(frame.headers.get('x-frame-sequence'),'1');assert.equal((await frame.arrayBuffer()).byteLength,4);
    assert.equal((await fetch(url+'/__browser-camera/next?after=1',{headers:{'X-Device-Key':'test-device-key'}})).status,204);
    const large=await fetch(url+'/__browser-camera/frame',{method:'POST',headers:{...headers,'X-Captured-At':String(Date.now())},body:Buffer.alloc(512*1024+1)});
    assert.equal(large.status,413);
    assert.equal((await fetch(url+'/')).status,200);
  } finally {await closeHttpServer(gateway);await closeHttpServer(backend);}
});
