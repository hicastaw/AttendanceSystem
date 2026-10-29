// Explicit opt-in: only the dedicated synthetic Docker smoke project is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const compose=fileURLToPath(new URL('../deploy/r50-docker/compose.yaml',import.meta.url));
const project='attendance-r50-smoke',url='http://localhost:3080';
const enabled=process.env.AIOT_TEST_DOCKER_DEMO==='1';
const require=createRequire(new URL('../AIOT/server/package.json',import.meta.url));
async function until(check,label,seconds=40){
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  throw new Error(label+' timed out');
}
function docker(args){return execFileSync('docker',['compose','-p',project,'-f',compose,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function credentials(){return JSON.parse(docker(['exec','-T','demo','node','-e',"process.stdout.write(require('fs').readFileSync('/tmp/aiot-software-test-docker/demo-credentials.json','utf8'))"]));}

test('Docker real R50/SCRFD negative browser input, enrollment rejection, durable daily data and restart',
  {skip:!enabled,timeout:180000},async()=>{
  await until(async()=>{const r=await fetch(url+'/api/ready');return r.ok;},'Docker backend');
  let secrets=credentials(),token;
  async function call(route,{body,device=false,method=body===undefined?'GET':'POST'}={}){
    const response=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(device?{'X-Device-Key':secrets.key}:{Authorization:`Bearer ${token||''}`})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    let value;try{value=await response.json();}catch{value={};}return {status:response.status,body:value};
  }
  async function login(){const result=await call('/api/auth/login',{body:{password:secrets.password}});assert.equal(result.status,200);token=result.body.data.token;}
  await login();
  const scope=await call('/api/cpu-test/admin-scope');assert.equal(scope.body.production_activated,false);
  const contract=scope.body.embedding_contract;assert.equal(contract.recognizer_sha256,'8bd26c17e760e4c88872be2208330d409a406e85413735188ad4e8bce2d44d8a');
  const {chromium}=require('@playwright/test');
  const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try {
    const context=await browser.newContext({permissions:['camera']});const page=await context.newPage();
    await page.goto(url);await page.locator('#password').fill(secrets.password);await page.locator('#login button').click();
    await page.locator('#start').click();
    await until(async()=>/Đã gửi [1-9]/.test(await page.locator('#sent').textContent()),'Synthetic browser upload');
    await until(async()=>{const value=await call('/api/cpu-test/camera/diagnostics');return value.body.data?.detection_frames>=4&&value.body.data.detected_faces===0;},'Actual SCRFD on synthetic video');
    assert.equal((await call('/api/access-events')).body.data.length,0,'synthetic webcam has no face and must not create attendance');
    assert.equal((await call('/api/users',{body:{user_code:'DOCKER_SMOKE',full_name:'Synthetic Docker member'}})).status,201);
    const capture=`/api/cpu-test/contracts/${contract.contract_id}/users/DOCKER_SMOKE/capture`;
    const started=await call(capture,{body:{frames:3}});assert.equal(started.status,201);
    const session=started.body.data.session_id;
    await until(async()=>{const value=await call('/api/cpu-test/camera/diagnostics');return value.body.data?.detection_frames>=8;},'No-face enrollment inference');
    const result=await call(capture+'/'+session);assert.equal(result.body.data.samples,0);assert.notEqual(result.body.data.state,'ready');
    assert.equal((await call(capture+'/'+session+'/commit',{body:{confirm_same_member:true}})).status,409);
    await call(capture+'/'+session,{method:'DELETE'});
    await page.locator('#stop').click();
    await until(async()=>!(await call('/api/system-ready')).body.pipeline_ready,'Stopped browser invalidates pipeline readiness',10);
  } finally {await browser.close();}
  const event={event_id:crypto.randomUUID(),device_id:'DOCKER_SYNTHETIC',user_code:'DOCKER_SMOKE',event_type:'check_in',timestamp:new Date().toISOString(),confidence:90};
  const saved=await call('/api/access-events',{body:event,device:true});assert.equal(saved.status,200);assert.equal(saved.body.duplicate,false);
  docker(['restart','demo']);
  await until(async()=>{const response=await fetch(url+'/api/ready');return response.ok;},'Docker restart');
  secrets=credentials();await login();
  const history=await call('/api/access-events');assert.equal(history.body.data.length,1);assert.equal(history.body.data[0].event_id,event.event_id);
  const duplicate=await call('/api/access-events',{body:{...event,event_id:crypto.randomUUID()},device:true});assert.equal(duplicate.body.duplicate,true);
  assert.equal((await call('/api/access-events')).body.data.length,1);
  console.log('Docker smoke: real model load + fake-browser NO_FACE; rejected enrollment; synthetic API daily dedup and restart persisted. No human face/camera used.');
});
