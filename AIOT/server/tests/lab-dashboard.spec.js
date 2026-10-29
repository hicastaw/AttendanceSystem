import {test,expect} from '@playwright/test';
import {bootBackend} from '../../../tools/software_test_support.mjs';

test('isolated lab dashboard displays member-days without interpreting names as markup',async({page})=>{
  const backend=await bootBackend();
  try {
    await page.route('**/api/auth/login',route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({status:'success',data:{token:'synthetic-admin-token'}})}));
    await page.route('**/api/lab-attendance?*',route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({status:'success',timezone:'Asia/Ho_Chi_Minh',week:{start:'2026-10-26',end_exclusive:'2026-11-02'},
        month:{start:'2026-10-01',end_exclusive:'2026-11-01'},data:[
          {user_id:1,user_code:'LAB_SYNTH',full_name:'<img src=x onerror=alert(1)>',status:'active',week_days:2,month_days:3,last_checkin:'2026-10-27T17:00:00Z',month_dates:['2026-10-26','2026-10-27','2026-10-28']},
        ]})}));
    await page.goto(backend.url+'/lab-dashboard.html');
    await page.locator('#password').fill('synthetic-password');await page.locator('#login-form button').click();
    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#members')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#members img')).toHaveCount(0);
    await expect(page.locator('#week-total')).toHaveText('2');
    await expect(page.locator('#month-total')).toHaveText('3');
    await expect(page.locator('#range-label')).toContainText('Asia/Ho_Chi_Minh');
  } finally {await backend.dispose();}
});

test('R50 webcam diagnostics page renders synthetic detector and stage timings',async({page})=>{
  const backend=await bootBackend();
  try {
    await page.route('**/api/auth/login',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',data:{token:'synthetic-admin-token'}})}));
    await page.route('**/api/cpu-test/camera/diagnostics',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',data:{
      scope:'isolated-r50-laptop-test',contract_id:'a'.repeat(64),detected_faces:1,detection_frames:7,
      timings_ms:{detector_ms:42.5,alignment_ms:1.25,recognition_ms:84.75},production_activated:false,
    }})}));
    await page.route('**/api/cpu-test/camera/preview',route=>route.fulfill({status:200,contentType:'image/jpeg',body:Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==','base64')}));
    await page.goto(backend.url+'/lab-camera.html');await page.locator('#password').fill('synthetic-password');await page.locator('#login-form button').click();
    await expect(page.locator('#faces')).toHaveText('1');await expect(page.locator('#detector')).toHaveText('42.5');
    await expect(page.locator('#alignment')).toHaveText('1.3');await expect(page.locator('#recognition')).toHaveText('84.8');
    await expect(page.locator('#contract')).toContainText('a'.repeat(64));await expect(page.locator('#camera-status')).toHaveText('Fresh frame');
    await expect(page.locator('#preview')).toHaveAttribute('src',/^blob:/);
  } finally {await backend.dispose();}
});
