import {test,expect} from '@playwright/test';
import {cpuFixture,cpuFixtureAvailable} from '../../../tools/cpu_test_support.mjs';

test('opt-in real CPU R50 committed check-in reaches existing kiosk UI',async({page})=>{
  test.skip(!cpuFixtureAvailable,'Requires local traceable baseline ONNX and hash-pinned public-domain fixtures');
  test.setTimeout(180000);
  const f=await cpuFixture();
  try {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await f.call('/api/users',{body:{user_code:'CPU_BROWSER',full_name:'Public domain CPU smoke'}});
    await f.start();await page.goto(f.backend.url+'/kiosk.html');
    await f.enroll('CPU_BROWSER');
    await expect(page.locator('#person')).toHaveText('Public domain CPU smoke',{timeout:60000});
    await expect(page.locator('#title')).toHaveText('Đã lưu điểm danh đến');
    expect((await f.call('/api/access-events')).body.data).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {await f.dispose();}
});

test('member registration directs R50 capture, explicitly saves and shows the active profile without MBF writes',async({page})=>{
  test.skip(!cpuFixtureAvailable,'Requires local R50 ONNX and hash-pinned public-domain fixtures');
  test.setTimeout(90000);
  const f=await cpuFixture();
  try {
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await f.start();await page.goto(f.backend.url+'/');
    await page.locator('#login-password').fill(f.backend.password);await page.locator('#login-form button').click();
    await expect(page.locator('#app-view')).toBeVisible();
    await page.locator('[data-tab="members"]').click();
    await page.locator('#reg-code').fill('CPU_R50_UI');await page.locator('#reg-name').fill('Public domain R50 capture');
    await page.locator('#reg-create-btn').click();await expect(page.locator('#reg-user-status')).toContainText('Đã tạo');
    await page.locator('#reg-file-input').setInputFiles({name:'synthetic-no-face.png',mimeType:'image/png',
      buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64')});
    const legacySave=page.waitForResponse(response=>response.url().endsWith('/api/users/CPU_R50_UI/face')&&response.request().method()==='POST');
    await page.locator('#reg-save-btn').click();expect((await legacySave).status()).toBe(409);
    await expect(page.locator('#reg-result')).toContainText('/r50-capture.html');
    await page.goto(f.backend.url+'/r50-capture.html');
    await page.locator('#password').fill(f.backend.password);await page.locator('#login button').click();
    await expect(page.locator('#controls')).toBeVisible();
    await expect(page.locator('#contract')).toContainText(f.contract.contract_id.slice(0,16));
    await page.locator('#member').selectOption('CPU_R50_UI');await page.locator('#frames').selectOption('3');
    await page.locator('#start').click();
    await expect(page.locator('#status')).toContainText(/queued:|capturing:/,{timeout:30000});
    await expect(page.locator('#preview')).toHaveJSProperty('naturalWidth',512,{timeout:30000});
    await page.locator('#cancel').click();await expect(page.locator('#status')).toContainText('Đã hủy');
    expect((await f.call('/api/face-data',{headers:f.backend.device})).body.data).toHaveLength(0);
    expect((await f.backend.request(`/api/cpu-test/contracts/${f.contract.contract_id}/gallery`,{headers:f.backend.device})).body.data).toHaveLength(0);
    await f.control('known');await page.locator('#start').click();
    await expect(page.locator('#status')).toContainText('ready:',{timeout:45000});
    await page.locator('#save').click();await expect(page.locator('#status')).toContainText('Cần xác nhận');
    expect((await f.backend.request(`/api/cpu-test/contracts/${f.contract.contract_id}/gallery`,{headers:f.backend.device})).body.data).toHaveLength(0);
    await page.locator('#confirm').check();await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('đã được backend lưu',{timeout:10000});
    expect((await f.backend.request(`/api/cpu-test/contracts/${f.contract.contract_id}/gallery`,{headers:f.backend.device})).body.data).toHaveLength(1);
    expect((await f.call('/api/users')).body.data.find(user=>user.user_code==='CPU_R50_UI').has_face_profile).toBe(1);
    expect((await f.call('/api/face-data',{headers:f.backend.device})).body.data).toHaveLength(0);
    await page.goto(f.backend.url+'/');await page.locator('[data-tab="members"]').click();
    await expect(page.locator('#member-table tbody tr').filter({hasText:'CPU_R50_UI'})).toContainText('Đã có');
    expect(errors).toEqual([]);
  } finally {await f.dispose();}
});
