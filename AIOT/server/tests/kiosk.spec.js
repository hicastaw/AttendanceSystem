import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import {bootBackend,root} from '../../../tools/software_test_support.mjs';
const contract=JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).mock;
let f;
const name='<img src=x onerror="window.xss=true"> Thành viên mô phỏng với họ tên tiếng Việt rất dài';
test.beforeAll(async()=> {
  f=await bootBackend({mode:'mock'});
  await f.request('/api/users',{headers:f.admin,body:{user_code:'TEST001',full_name:name}});
  await f.request('/api/users/TEST001/mock-face',{headers:f.admin,method:'POST'});
});
test.afterAll(async()=> {await f?.dispose();});
async function state(value){await f.request('/api/worker-state',{headers:f.device,body:{mode:'mock',embedding_contract:contract,
  state:value,camera_ok:true,model_ok:true}});}
test('1024x600 kiosk: live Python recognition, persisted success, XSS, unavailable, timeout and reconnect',async({page,context})=> {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.url+'/kiosk.html');
  await expect(page.locator('#mode')).toContainText('MÔ PHỎNG');
  await expect(page.locator('#title')).toHaveText('Thiết bị chưa kết nối');
  for(const [value,text] of [['idle','Sẵn sàng'],['evaluating','Đang nhận diện'],['unknown','Chưa nhận diện được'],
    ['camera_unavailable','Camera chưa sẵn sàng'],['model_unavailable','Model chưa sẵn sàng'],['storage_error','Chưa lưu được điểm danh']]) {
    await state(value);await expect(page.locator('#title')).toHaveText(text);
  }
  const runtime=path.join(f.directory,'browser-runtime.json');
  await writeFile(runtime,JSON.stringify({mode:'mock',url:f.url,key:f.key}));
  const python=process.env.TEST_PYTHON;expect(python).toBeTruthy();
  const child=spawn(python,[path.join(root,'tools/simulate_recognition.py'),'--runtime',runtime,'--code','TEST001','--timestamp','2026-10-14T08:00:00+07:00'],{stdio:'pipe'});
  let output='';child.stderr.on('data',b=>output+=b);
  const ended=new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error(output)));child.once('error',reject);});
  await expect(page.locator('#title')).toHaveText('Đã lưu điểm danh đến');
  await ended;
  await expect(page.locator('#person')).toHaveText(name);
  expect(await page.locator('#person img').count()).toBe(0);
  expect(await page.evaluate(()=>window.xss)).toBeUndefined();
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
    targets:[...document.querySelectorAll('button,a')].map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(1024);expect(dimensions.scrollHeight).toBeLessThanOrEqual(600);
  for(const target of dimensions.targets){expect(target.w).toBeGreaterThanOrEqual(48);expect(target.h).toBeGreaterThanOrEqual(48);}
  await page.screenshot({path:path.join(root,'.venv/kiosk-1024x600.png')});
  // Never retain a stale success indefinitely after the worker exits.
  await expect(page.locator('#title')).toHaveText('Thiết bị chưa kết nối',{timeout:15000});
  await context.setOffline(true);await expect(page.locator('#title')).toHaveText('Mất kết nối dịch vụ');
  await context.setOffline(false);await state('idle');await page.locator('#retry').click();
  await expect(page.locator('#title')).toHaveText('Sẵn sàng');
  expect(errors).toEqual([]);
});
test('admin history renders text safely; mock enrollment UI; responsive kiosk',async({page})=> {
  // Ensure TEST001 has an access event logged so test is isolated and independent
  const events = await f.request('/api/access-events', {headers: f.admin});
  if (!events.body.data.find(e => e.user_code === 'TEST001')) {
    await f.request('/api/access-events', {
      headers: f.device,
      body: {
        event_id: crypto.randomUUID(),
        device_id: 'MOCK_DEVICE',
        user_code: 'TEST001',
        event_type: 'check_in',
        timestamp: new Date().toISOString()
      }
    });
  }

  await page.goto(f.url+'/');
  await page.locator('#login-password').fill(f.password);
  await page.locator('#login-form button').click();
  await page.locator('[data-tab="logs"]').click();
  await expect(page.locator('#log-table tbody')).toContainText(name);
  expect(await page.locator('#log-table tbody img').count()).toBe(0);
  await page.locator('[data-tab="members"]').click();
  await page.locator('#reg-code').fill('TEST002');await page.locator('#reg-name').fill('Synthetic enrollment');
  await page.locator('#reg-create-btn').click();
  await expect(page.locator('#reg-user-status')).toContainText('Đã tạo');
  await page.getByRole('button',{name:'Đăng ký hồ sơ MÔ PHỎNG cho mã đã chọn'}).click();
  await expect(page.locator('#reg-result')).toContainText('không phải khuôn mặt thật');
  await page.locator('[data-tab="members"]').click();
  const row=page.locator('#member-table tbody tr').filter({hasText:'TEST002'});
  await expect(row).toContainText('Đã có');
  await row.getByRole('button',{name:'Ngừng hoạt động'}).click();
  await expect(row).toContainText('Đã ngừng');
  const gallery=await f.request('/api/face-data',{headers:f.device});
  expect(gallery.body.data.map(user=>user.user_code)).not.toContain('TEST002');
  await page.setViewportSize({width:390,height:844});await page.goto(f.url+'/kiosk.html');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
