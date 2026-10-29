import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {bootBackend,root} from '../../../tools/software_test_support.mjs';

const contract = JSON.parse(await readFile(path.join(root,'AIOT/embedding-contract.json'),'utf8')).mock;
let f;

test.beforeAll(async () => {
  f = await bootBackend({mode:'mock'});
  await f.request('/api/users',{headers:f.admin,body:{user_code:'FE_ALICE',full_name:'Alice Nguyen'}});
  await f.request('/api/users/FE_ALICE/mock-face',{headers:f.admin,method:'POST'});
  await f.request('/api/users',{headers:f.admin,body:{user_code:'FE_BOB',full_name:'Bob Tran'}});
  await f.request('/api/users/FE_BOB/mock-face',{headers:f.admin,method:'POST'});
});

test.afterAll(async () => {
  await f?.dispose();
});

async function setWorkerState(stateValue, extra = {}) {
  await f.request('/api/worker-state', {
    headers: f.device,
    body: {
      mode: 'mock',
      embedding_contract: contract,
      state: stateValue,
      camera_ok: true,
      model_ok: true,
      ...extra,
    }
  });
}

test('kiosk multi-viewport responsiveness and zero overflow', async ({page}) => {
  await setWorkerState('idle');

  // 1. 1024x600 (Physical Pi touch screen native)
  await page.setViewportSize({width: 1024, height: 600});
  await page.goto(f.url + '/kiosk.html');
  await expect(page.locator('#title')).toHaveText('Sẵn sàng');

  let scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  let scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollW).toBeLessThanOrEqual(1024);
  expect(scrollH).toBeLessThanOrEqual(600);
  await page.screenshot({path: path.join(root, '.venv/kiosk-idle-1024x600.png')});

  // Check touch targets >= 48px
  const targets = await page.evaluate(() => {
    return [...document.querySelectorAll('button, a')].map(el => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, text: el.textContent.trim(), w: rect.width, h: rect.height };
    });
  });
  for (const t of targets) {
    expect(t.w, `Target ${t.text} width`).toBeGreaterThanOrEqual(48);
    expect(t.h, `Target ${t.text} height`).toBeGreaterThanOrEqual(48);
  }

  // 2. 1920x1080 (Large monitor / TV display)
  await page.setViewportSize({width: 1920, height: 1080});
  await page.goto(f.url + '/kiosk.html');
  scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollW).toBeLessThanOrEqual(1920);
  expect(scrollH).toBeLessThanOrEqual(1080);

  // 3. 390x844 (Mobile portrait display)
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(f.url + '/kiosk.html');
  scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(390);
  await page.screenshot({path: path.join(root, '.venv/kiosk-mobile-390x844.png')});
});

test('kiosk auto-reset privacy and repeat polling protection', async ({page}) => {
  await page.setViewportSize({width: 1024, height: 600});
  await page.goto(f.url + '/kiosk.html');

  // Evaluating state activates radar scanning effect
  await setWorkerState('evaluating');
  await expect(page.locator('#title')).toHaveText('Đang nhận diện');
  await expect(page.locator('body')).toHaveAttribute('data-evaluating', 'true');
  await page.screenshot({path: path.join(root, '.venv/kiosk-evaluating-1024x600.png')});

  // Trigger attendance event directly into backend SQLite
  const eventId = '11111111-2222-3333-4444-555555555555';
  const postRes = await f.request('/api/access-events', {
    headers: f.device,
    body: {
      event_id: eventId,
      device_id: 'MOCK_DEVICE',
      user_code: 'FE_ALICE',
      event_type: 'check_in',
      timestamp: '2026-10-20T08:30:00+07:00',
      confidence: 91.5,
    }
  });
  expect([200, 201]).toContain(postRes.status);

  // Worker publishes pending with that event_id -> backend transitions to confirmed
  await setWorkerState('pending', { event_id: eventId });
  await expect(page.locator('#title')).toHaveText('Đã lưu điểm danh đến');
  await expect(page.locator('#person')).toHaveText('Alice Nguyen');
  await expect(page.locator('#result')).toHaveAttribute('data-resetting', 'true');
  await page.screenshot({path: path.join(root, '.venv/kiosk-confirmed-1024x600.png')});

  // After 3.8s auto-reset timeout, person text should be cleared for privacy
  await expect(page.locator('#person')).toHaveText('', { timeout: 6000 });
  await expect(page.locator('#result')).toHaveAttribute('data-resetting', 'false');

  // Ensure title still indicates confirmed until worker updates state
  await expect(page.locator('#title')).toHaveText('Đã lưu điểm danh đến');

  // When worker returns to idle, title updates to Sẵn sàng
  await setWorkerState('idle');
  await expect(page.locator('#title')).toHaveText('Sẵn sàng');
  await expect(page.locator('body')).toHaveAttribute('data-evaluating', 'false');
});

test('admin dashboard navigation, member search filter, and sticky tables', async ({page}) => {
  await page.setViewportSize({width: 1024, height: 600});
  await page.goto(f.url + '/');

  // Login
  await page.locator('#login-password').fill(f.password);
  await page.locator('#login-form button').click();
  await expect(page.locator('#app-view')).toBeVisible();

  // Check header navigation links exist for the 3-page MVP
  await expect(page.locator('header a[href="/lab-kiosk.html"]')).toBeVisible();
  await expect(page.locator('header a[href="/r50-capture.html"]')).toBeVisible();

  // Go to members tab
  await page.locator('[data-tab="members"]').click();
  await expect(page.locator('#member-table tbody tr')).toHaveCount(2);

  // Search filter for Alice
  await page.locator('#member-search').fill('ALICE');
  await expect(page.locator('#member-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#member-table tbody')).toContainText('Alice Nguyen');
  await expect(page.locator('#member-table tbody')).not.toContainText('Bob Tran');

  // Search filter for Bob
  await page.locator('#member-search').fill('BOB');
  await expect(page.locator('#member-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#member-table tbody')).toContainText('Bob Tran');
  await expect(page.locator('#member-table tbody')).not.toContainText('Alice Nguyen');

  // Clear search filter -> both return
  await page.locator('#member-search').fill('');
  await expect(page.locator('#member-table tbody tr')).toHaveCount(2);

  // Check table has sticky header
  const isSticky = await page.evaluate(() => {
    const th = document.querySelector('#member-table th');
    return window.getComputedStyle(th).position === 'sticky';
  });
  expect(isSticky).toBe(true);
  await page.screenshot({path: path.join(root, '.venv/admin-members-1024x600.png')});

  // Navigate to R50 capture page
  await page.locator('header a[href="/r50-capture.html"]').click();
  await expect(page).toHaveURL(f.url + '/r50-capture.html');
  await expect(page.locator('h1')).toContainText('Đăng ký R50 thử nghiệm');
  await page.screenshot({path: path.join(root, '.venv/r50-capture-1024x600.png')});

  // Navigate back to Admin
  await page.locator('a[href="/"]').first().click();
  await expect(page).toHaveURL(f.url + '/');
});
