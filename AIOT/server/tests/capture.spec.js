import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {root,bootBackend,spawnTestProcess,stopChild,withDeadline,childDiagnostics} from '../../../tools/software_test_support.mjs';
let directory,child,f,key;
test.beforeAll(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'aiot-software-test-'));key=crypto.randomBytes(24).toString('hex');
  const runtime=path.join(directory,'capture-test.json');await writeFile(runtime,JSON.stringify({mode:'synthetic-capture-test',key}));
  child=spawnTestProcess(process.env.TEST_PYTHON,['-B',path.join(root,'tools/synthetic_capture_worker.py'),'--runtime',runtime],
    {cwd:directory,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']},[key]);
  const port=await withDeadline(new Promise((resolve,reject)=>{
    let output='';child.stdout.on('data',buffer=>{output+=buffer;const match=output.match(/"port":\s*(\d+)/);if(match)resolve(Number(match[1]));});
    child.once('error',reject);child.once('close',()=>reject(new Error(childDiagnostics(child))));
  }),12000,'browser synthetic worker');
  f=await bootBackend({extra:{EDGE_DEVICE_KEY:key,WORKER_BASE_URL:`http://127.0.0.1:${port}`}});
  await f.request('/api/users',{headers:f.admin,body:{user_code:'BROWSER_CAPTURE',full_name:'<img src=x onerror="window.xss=true"> Synthetic'}});
});
test.afterAll(async()=>{try{await f?.dispose();}finally{try{if(child)await stopChild(child);}finally{if(directory)await rm(directory,{recursive:true,force:true});}}});
test('admin camera capture: private preview, explicit confirmation, persisted result and safe text',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.url+'/capture.html');
  await page.locator('#password').fill(f.password);await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();
  expect(await page.locator('#member option').textContent()).toContain('<img');
  await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText('ready:',{timeout:10000});
  await expect(page.locator('#preview')).toHaveJSProperty('naturalWidth',112);
  await page.locator('#save').click();await expect(page.locator('#status')).toContainText('Cần xác nhận');
  expect((await f.request('/api/face-data',{headers:{'X-Device-Key':key}})).body.data.length).toBe(0);
  await page.locator('#confirm').check();await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('đã được backend lưu xác nhận');
  expect((await f.request('/api/face-data',{headers:{'X-Device-Key':key}})).body.data.length).toBe(1);
  expect(await page.evaluate(()=>window.xss)).toBeUndefined();expect(errors).toEqual([]);
  await page.locator('#start').click();
  await expect(page.locator('#member')).toBeDisabled();
  await page.route('**/capture/*',route=>route.request().method()==='DELETE'?route.abort():route.continue());
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('Mẫu vẫn tự hết hạn');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#preview')).not.toHaveAttribute('src',/.+/);
  await page.locator('#logout').click();await expect(page.locator('#controls')).toBeHidden();
});
