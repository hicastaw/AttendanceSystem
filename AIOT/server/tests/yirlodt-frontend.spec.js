import {test, expect} from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import {bootBackend, root} from '../../../tools/software_test_support.mjs';

const screenshotDir = path.join(root, '.venv/review-screenshots');
let backend;

const VALID_JPEG_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/' +
  '2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/' +
  'wAARCAAKAAoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/' +
  '8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/' +
  '8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/' +
  '8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+f+iiigD/2Q==',
  'base64'
);

test.beforeAll(async () => {
  backend = await bootBackend();
});

test.afterAll(async () => {
  await backend?.dispose();
});

test('YIRLoDT Lab Kiosk multi-viewport responsiveness, branding, states, and discrete admin menu', async ({page}) => {
  let mockKioskState = { state: 'idle' };

  await page.route('**/api/kiosk-state', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockKioskState)
    });
  });

  // 1. Physical Pi 5 Touchscreen Viewport: 1024x600
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto(backend.url + '/lab-kiosk.html');

  // Check branding & discrete admin trigger
  await expect(page.locator('.brand-logo')).toBeVisible();
  await expect(page.locator('.pipeline-badge')).toContainText('SCRFD-10G · ARCFACE R50');
  await expect(page.locator('#clock')).toBeVisible();
  await expect(page.locator('.face-oval-guide')).toBeVisible();
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#admin-settings-btn')).toBeVisible();

  // Verify zero scrollbar/overflow on 1024x600
  const scrollDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(scrollDimensions.scrollWidth).toBeLessThanOrEqual(1024);
  expect(scrollDimensions.scrollHeight).toBeLessThanOrEqual(600);

  // Verify discrete admin dialog open & close
  await page.locator('#admin-settings-btn').click();
  await expect(page.locator('#admin-dialog')).toBeVisible();
  await expect(page.locator('#admin-dialog-title')).toContainText('Quản trị & Cài đặt');
  await expect(page.locator('#admin-dialog a[href="/"]')).toBeVisible();
  await expect(page.locator('#admin-dialog a[href="/r50-capture.html"]')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, '01_kiosk_1024x600_admin_dialog.png') });

  await page.locator('#close-dialog-btn').click();
  await expect(page.locator('#admin-dialog')).not.toBeVisible();

  await page.screenshot({ path: path.join(screenshotDir, '01_kiosk_1024x600_idle.png') });

  // 2. State: confirmed (Check-in success)
  mockKioskState = {
    state: 'confirmed',
    attendance_result: 'CHECK_IN_SUCCESS',
    attendance: {
      event_id: 'evt_001',
      user_code: 'YIR_001',
      full_name: 'Nguyễn Văn An',
      event_time: '2026-10-27T08:30:00.000Z'
    }
  };

  // Wait for polling update
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'confirmed', { timeout: 4000 });
  await expect(page.locator('#member')).toHaveText('Nguyễn Văn An');
  await expect(page.locator('#state')).toHaveText('CHECK-IN SUCCESS');
  await expect(page.locator('#confirmed-member-banner')).toBeVisible();
  await expect(page.locator('#confirmed-member-name')).toHaveText('Nguyễn Văn An');
  await page.screenshot({ path: path.join(screenshotDir, '02_kiosk_1024x600_confirmed.png') });

  // 3. State: already (Already checked in today)
  mockKioskState = {
    state: 'confirmed',
    attendance_result: 'ALREADY_CHECKED_IN',
    attendance: {
      event_id: 'evt_002',
      user_code: 'YIR_002',
      full_name: 'Trần Thị Bích',
      event_time: '2026-10-27T09:15:00.000Z'
    }
  };
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'already', { timeout: 4000 });
  await expect(page.locator('#state')).toHaveText('ALREADY CHECKED IN');
  await expect(page.locator('#member')).toHaveText('Trần Thị Bích');
  await expect(page.locator('#confirmed-member-banner')).toBeVisible();
  await expect(page.locator('#confirmed-member-name')).toHaveText('Trần Thị Bích');
  await page.screenshot({ path: path.join(screenshotDir, '03_kiosk_1024x600_already.png') });

  // 4. Full HD Presentation Viewport: 1920x1080
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.brand-slogan')).toBeVisible();
  await expect(page.locator('.brand-slogan')).toContainText('Ý tưởng hôm nay, kiến tạo ngày mai');
  await page.screenshot({ path: path.join(screenshotDir, '04_kiosk_1920x1080_desktop.png') });

  // 5. Mobile Viewport: 390x844 (zero horizontal overflow)
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(mobileDimensions.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(screenshotDir, '05_kiosk_390x844_mobile.png') });
});

test('YIRLoDT Face Attendance camera live JPEG stream, auth boundary, and error recovery', async ({page}) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.route('**/api/kiosk-state', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'idle' })
    });
  });

  let previewStatus = 200;
  await page.route('**/api/cpu-test/camera/preview', route => {
    const authHeader = route.request().headers()['authorization'] || '';
    if (!authHeader.includes('Bearer ')) {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
      return;
    }
    if (previewStatus === 200) {
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: VALID_JPEG_BUFFER
      });
    } else {
      route.fulfill({
        status: previewStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: `HTTP ${previewStatus}` })
      });
    }
  });

  // 1. Unauthenticated laptop kiosk visit (operator has not logged in)
  await page.goto(backend.url + '/lab-kiosk.html');
  await expect(page.locator('#kiosk-camera-preview')).toHaveClass(/hidden/);
  await expect(page.locator('#camera-status-text')).toContainText('Đăng nhập quản trị laptop để xem trực tiếp');
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'idle');

  // 2. Authenticated operator sets token in localStorage
  await page.evaluate(() => {
    localStorage.setItem('lab_access_token', 'synthetic-admin-token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'lab_access_token', newValue: 'synthetic-admin-token' }));
  });

  // Camera preview decodes and becomes visible
  await expect(page.locator('#kiosk-camera-preview')).not.toHaveClass(/hidden/, { timeout: 5000 });
  await expect(page.locator('#camera-status-overlay')).toHaveClass(/hidden/);
  const naturalWidth = await page.locator('#kiosk-camera-preview').evaluate(img => img.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);

  // 3. Transient 503 error handling (frame age > 5s or worker warm-up)
  previewStatus = 503;
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'lab_access_token', newValue: 'synthetic-admin-token' }));
  });
  await expect(page.locator('#camera-status-text')).toContainText('503', { timeout: 4000 });
  await expect(page.locator('#kiosk-camera-preview')).toHaveClass(/hidden/);
  // State polling is preserved
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'idle');

  // 4. Token expiration or invalid auth (401)
  previewStatus = 401;
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'lab_access_token', newValue: 'synthetic-admin-token' }));
  });
  await expect(page.locator('#camera-status-text')).toContainText('401', { timeout: 4000 });

  // 5. Pagehide cleanup
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(page.locator('#kiosk-camera-preview')).toHaveClass(/hidden/);

  // Ensure zero unhandled exceptions
  expect(errors).toEqual([]);
});

test('F1 regression: delayed Attendance JPEG response after logout never restores camera frame', async ({page}) => {
  await page.route('**/api/kiosk-state', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) });
  });

  let holdPreviewPromiseResolve;
  const holdPreviewPromise = new Promise(res => { holdPreviewPromiseResolve = res; });
  let requestCount = 0;

  await page.route('**/api/cpu-test/camera/preview', async route => {
    requestCount++;
    if (requestCount === 1) {
      await holdPreviewPromise;
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
    } else {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('lab_access_token', 'synthetic-admin-token');
  });

  await page.goto(backend.url + '/lab-kiosk.html');
  await expect(page.locator('#camera-status-overlay')).toBeVisible();

  // Simulate user logout before held request completes
  await page.evaluate(() => {
    localStorage.removeItem('lab_access_token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'lab_access_token', newValue: null }));
  });

  // Release the held preview response
  holdPreviewPromiseResolve();
  await page.waitForTimeout(600);

  // Invariant F1: camera image must NOT reappear after logout
  await expect(page.locator('#kiosk-camera-preview')).toHaveClass(/hidden/);
  await expect(page.locator('#camera-status-overlay')).toBeVisible();
  await expect(page.locator('#camera-status-text')).toContainText('Đăng nhập quản trị laptop để xem trực tiếp');
});

test('F2 regression: stalled preview response body and >5s frame age independently invalidate displayed frame', async ({page}) => {
  const stalledSockets = new Set();
  const stalledServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': '4096',
      'Cache-Control': 'no-store'
    });
    res.write(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); // start of JPEG SOI
    // intentionally do not end or push more data
  });
  stalledServer.on('connection', socket => {
    stalledSockets.add(socket);
    socket.on('close', () => stalledSockets.delete(socket));
  });
  await new Promise(r => stalledServer.listen(0, '127.0.0.1', r));
  const stalledPort = stalledServer.address().port;

  try {
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
    }));
    await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        scope: 'isolated-r50-laptop-test',
        production_activated: false,
        embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
      })
    }));
    await page.route('**/api/users', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
    }));

    let serveStalled = false;
    await page.route('**/api/cpu-test/camera/preview', async route => {
      if (serveStalled) {
        await route.continue({ url: `http://127.0.0.1:${stalledPort}/stalled.jpg` });
      } else {
        route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
      }
    });

    // --- Part A: Enrollment Preview ---
    await page.goto(backend.url + '/r50-capture.html');
    await page.locator('#password').fill('admin-pass');
    await page.locator('#login button').click();
    await expect(page.locator('#controls')).toBeVisible();

    // Normal frame displayed
    await expect(page.locator('#preview')).not.toHaveClass(/hidden/, { timeout: 4000 });
    await expect(page.locator('#preview-placeholder')).toHaveClass(/hidden/);

    // Switch to stalled response body
    serveStalled = true;

    // After timeout / 5s freshness, the frame MUST be invalidated and hidden!
    await expect(page.locator('#preview')).toHaveClass(/hidden/, { timeout: 8000 });
    await expect(page.locator('#preview-placeholder')).not.toHaveClass(/hidden/);
    await expect(page.locator('#preview-placeholder-text')).toContainText('503');

    // --- Part B: Attendance Preview ---
    await page.addInitScript(() => {
      localStorage.setItem('lab_access_token', 'synthetic-admin-token');
    });
    serveStalled = false;
    await page.goto(backend.url + '/lab-kiosk.html');

    // Initial frame appears
    await expect(page.locator('#kiosk-camera-preview')).not.toHaveClass(/hidden/, { timeout: 4000 });
    await expect(page.locator('#camera-status-overlay')).toHaveClass(/hidden/);

    // Switch to stalled body
    serveStalled = true;

    // After timeout / 5s freshness, the Attendance frame MUST be invalidated and overlay restored!
    await expect(page.locator('#kiosk-camera-preview')).toHaveClass(/hidden/, { timeout: 8000 });
    await expect(page.locator('#camera-status-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#camera-status-text')).toContainText('503');
  } finally {
    for (const socket of stalledSockets) {
      socket.destroy();
    }
    await new Promise(r => stalledServer.close(r));
  }
});

test('F3 regression: Start -> Logout -> Re-login -> Start succeeds without 409 and cleans up orphan session', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  // Track backend session state and cleanup
  let backendActiveSession = null;
  let deletedSessions = [];
  let postCount = 0;

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      postCount++;
      if (backendActiveSession) {
        // Backend raises 409 Conflict if previous session was not cancelled!
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', message: 'Camera enrollment already active' })
        });
      }
      const newSession = `session_${postCount}`;
      backendActiveSession = newSession;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: newSession, required: 3, samples: 0, state: 'queued' } })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/*', async route => {
    const url = route.request().url();
    const sessionId = url.split('/').pop();
    if (route.request().method() === 'DELETE') {
      deletedSessions.push(sessionId);
      if (backendActiveSession === sessionId) {
        backendActiveSession = null;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    } else if (route.request().method() === 'GET') {
      if (backendActiveSession === sessionId) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { session_id: sessionId, required: 3, samples: 1, state: 'capturing' } })
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'Not found' }) });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. First Start
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  expect(backendActiveSession).toBe('session_1');

  // 2. User logs out while session_1 is active
  await page.locator('#logout').click();
  await expect(page.locator('#login')).toBeVisible();

  // Invariant F3: Backend MUST have received DELETE for session_1 so backendActiveSession is cleared!
  expect(deletedSessions).toContain('session_1');
  expect(backendActiveSession).toBeNull();

  // 3. User logs back in
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#start')).toBeEnabled();

  // 4. Second Start MUST succeed with 201 (not 409!)
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  expect(backendActiveSession).toBe('session_2');
  await expect(page.locator('#status')).not.toContainText('Camera enrollment already active');
  await expect(page.locator('#status')).not.toContainText('409');
});

test('F5 regression: delayed kiosk-state response never restarts polling after pagehide', async ({page}) => {
  let kioskStateRequestCount = 0;
  let holdKioskStateResolve = null;

  await page.route('**/api/kiosk-state', async route => {
    kioskStateRequestCount++;
    if (kioskStateRequestCount === 1) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) });
    } else if (kioskStateRequestCount === 2) {
      // Hold the 2nd request in flight
      await new Promise(r => { holdKioskStateResolve = r; });
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) });
    }
  });

  await page.goto(backend.url + '/lab-kiosk.html');
  await expect(page.locator('#clock')).toBeVisible();

  // Wait until 2nd request is in flight
  await expect.poll(() => kioskStateRequestCount).toBe(2);

  // Trigger pagehide on the window while the 2nd request is in flight
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  // Release the held 2nd request
  if (holdKioskStateResolve) holdKioskStateResolve();
  await page.waitForTimeout(1500);

  // Invariant F5: kiosk-state request count MUST NOT have increased while page is hidden!
  const countAfterPagehide = kioskStateRequestCount;
  expect(countAfterPagehide).toBe(2);

  // Trigger pageshow to verify clean resume
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect.poll(() => kioskStateRequestCount).toBeGreaterThan(2);
});

test('F5 regression: rapid pagehide/pageshow and visibility transitions with delayed 1250ms kiosk-state prevent duplicate pollers and resume cleanly', async ({page}) => {
  let requestTimestamps = [];
  let serveDelayed = true;

  await page.route('**/api/kiosk-state', async route => {
    requestTimestamps.push(Date.now());
    if (serveDelayed) {
      await new Promise(r => setTimeout(r, 1250));
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) });
  });

  await page.goto(backend.url + '/lab-kiosk.html');

  // Request 1 is currently in flight (delayed by 1250ms).
  // Perform rapid transitions: pagehide -> pageshow -> visibilitychange hidden -> visibilitychange visible
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Switch to normal responses so new requests finish quickly
  serveDelayed = false;

  // Wait 3000ms for old delayed responses to finish and new generation to settle
  await page.waitForTimeout(3000);

  // Invariant F5:
  // 1. Connection indicator must show connected (Đã kết nối dịch vụ cục bộ)
  await expect(page.locator('#connection')).toContainText('Đã kết nối dịch vụ cục bộ');
  await expect(page.locator('#card')).toHaveAttribute('data-state', 'idle');

  // 2. Count requests in a 2000ms window: with 900ms interval, exactly 2 (at most 3) requests should occur
  const countBefore = requestTimestamps.length;
  await page.waitForTimeout(2000);
  const countAfter = requestTimestamps.length;
  const requestsIn2s = countAfter - countBefore;
  // If there were duplicate pollers, requestsIn2s would be >= 4. Exactly 1 poller produces 2 (or 3 boundary)
  expect(requestsIn2s).toBeLessThanOrEqual(3);
  expect(requestsIn2s).toBeGreaterThanOrEqual(1);
});

test('F3 regression: DELETE 503 and stalled cancellation do not block logout or falsely claim deletion; bounded logout completes promptly', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let deleteMode = '503'; // '503' or 'stall'
  let backendActiveSession = null;

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      if (backendActiveSession) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', message: 'Camera enrollment already active' })
        });
      }
      backendActiveSession = 'session_unconfirmed_1';
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'session_unconfirmed_1', required: 3, samples: 1, state: 'capturing' } })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    const url = route.request().url();
    if (route.request().method() === 'DELETE') {
      if (deleteMode === '503') {
        // Backend returns 503 Service Unavailable for DELETE with unconfirmed contract
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'error',
            data: { cancellation: 'unconfirmed', confirmed: false, recovery_deadline_seconds: 180 }
          })
        });
      } else if (deleteMode === 'stall') {
        // Stalled request: do not respond
        return;
      }
    }
    if (route.request().method() === 'GET') {
      if (url.endsWith('/preview')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'session_unconfirmed_1', required: 3, samples: 1, state: 'capturing' } })
      });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Start capture
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  expect(backendActiveSession).toBe('session_unconfirmed_1');

  // 2. User logs out while DELETE returns 503
  const logoutStart = Date.now();
  await page.locator('#logout').click();

  // Must return to login promptly (< 4000ms), never hanging indefinitely
  await expect(page.locator('#login')).toBeVisible({ timeout: 4000 });
  const logoutDuration = Date.now() - logoutStart;
  expect(logoutDuration).toBeLessThan(4000);

  // Invariant F3: must NOT claim the session was deleted when DELETE returned 503!
  await expect(page.locator('#status')).toContainText('Chưa thể xác nhận giải phóng phiên trên máy chủ');
  const statusText = await page.locator('#status').textContent();
  expect(statusText).not.toBe('Đã đăng xuất.');

  // Invariant F3: backend session was NOT deleted
  expect(backendActiveSession).toBe('session_unconfirmed_1');

  // 3. User logs back in and attempts Start -> backend raises 409 Conflict
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText('Camera enrollment already active');

  // 4. Test stalled DELETE timeout bound
  // Clear backend session to allow a new start
  backendActiveSession = null;
  deleteMode = 'stall';

  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  expect(backendActiveSession).toBe('session_unconfirmed_1');

  const stallLogoutStart = Date.now();
  await page.locator('#logout').click();

  // Bounded logout: 2000ms timeout on DELETE + 1500ms on auth/logout guarantees prompt return <= 4000ms
  await expect(page.locator('#login')).toBeVisible({ timeout: 4500 });
  const stallDuration = Date.now() - stallLogoutStart;
  expect(stallDuration).toBeLessThan(4500);
  expect(stallDuration).toBeGreaterThanOrEqual(1800); // verified it actually waited for the bounded timeout
  await expect(page.locator('#status')).toContainText('Chưa thể xác nhận giải phóng phiên trên máy chủ');
});

test('F3 contract regression: Cancel handles confirmed cancelled, already_absent, and 503 unconfirmed honestly', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let deleteResponseMode = 'cancelled'; // 'cancelled', 'already_absent', '503_unconfirmed'
  let sessionCounter = 0;

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      sessionCounter++;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: { session_id: `session_c_${sessionCounter}`, required: 3, samples: 1, state: 'capturing' }
        })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    const url = route.request().url();
    if (route.request().method() === 'DELETE') {
      if (deleteResponseMode === 'cancelled') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: { cancellation: 'cancelled', confirmed: true }
          })
        });
      } else if (deleteResponseMode === 'already_absent') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: { cancellation: 'already_absent', confirmed: true }
          })
        });
      } else if (deleteResponseMode === '503_unconfirmed') {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'error',
            data: { cancellation: 'unconfirmed', confirmed: false, recovery_deadline_seconds: 180 }
          })
        });
      }
    }
    if (route.request().method() === 'GET') {
      if (url.endsWith('/preview')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: { session_id: `session_c_${sessionCounter}`, required: 3, samples: 1, state: 'capturing' }
        })
      });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Test confirmed 'cancelled'
  deleteResponseMode = 'cancelled';
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toHaveText('Đã hủy phiên lấy mẫu.');
  await expect(page.locator('#start')).toBeEnabled();

  // 2. Test confirmed 'already_absent'
  deleteResponseMode = 'already_absent';
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toHaveText('Phiên lấy mẫu đã kết thúc hoặc không còn tồn tại trên máy chủ.');
  await expect(page.locator('#start')).toBeEnabled();

  // 3. Test 503 unconfirmed with recovery_deadline_seconds
  deleteResponseMode = '503_unconfirmed';
  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('Chưa thể xác nhận hủy phiên trên máy chủ (HTTP 503) · phiên sẽ tự giải phóng sau khoảng 180s.');
  const cancelText = await page.locator('#status').textContent();
  expect(cancelText).not.toBe('Đã hủy phiên lấy mẫu.');
  await expect(page.locator('#start')).toBeEnabled();
});

test('F3 regression: Pending Start during Logout races and cancels newly created session', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let backendActiveSession = null;
  let deletedSessions = [];
  let resolveDelayedStart = null;
  let postCount = 0;

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      postCount++;
      if (backendActiveSession) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'error', message: 'Camera enrollment already active' })
        });
      }
      const newSession = `session_pending_${postCount}`;
      backendActiveSession = newSession;
      if (postCount === 1) {
        // Delay first start response so it's in-flight during logout
        await new Promise(r => { resolveDelayedStart = r; });
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: newSession, required: 3, samples: 0, state: 'queued' } })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    const url = route.request().url();
    const sessionId = url.split('/').pop();
    if (route.request().method() === 'DELETE') {
      deletedSessions.push(sessionId);
      if (backendActiveSession === sessionId) {
        backendActiveSession = null;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Click Start (request is now in-flight and held)
  await page.locator('#start').click();
  await page.waitForTimeout(200);

  // 2. User clicks Logout while Start is in flight
  const logoutPromise = page.locator('#logout').click();

  // Release the in-flight start after a short delay (e.g. 300ms)
  await page.waitForTimeout(300);
  if (resolveDelayedStart) resolveDelayedStart();
  await logoutPromise;

  // Logout should complete promptly and return to login form
  await expect(page.locator('#login')).toBeVisible({ timeout: 4000 });

  // Invariant: The created session_pending_1 MUST have been cleaned up via DELETE!
  expect(deletedSessions).toContain('session_pending_1');
  expect(backendActiveSession).toBeNull();

  // 3. Re-login and Start: second Start MUST succeed with 201 (not 409!)
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  await page.locator('#start').click();
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  expect(backendActiveSession).toBe('session_pending_2');
});

test('F3 regression: Pending Start during navigation pagehide triggers keepalive DELETE cleanup', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let resolveStartPromise = null;
  let deletedSessions = [];

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(r => { resolveStartPromise = r; });
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'session_nav_1', required: 3, samples: 0, state: 'queued' } })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    const url = route.request().url();
    const sessionId = url.split('/').pop();
    if (route.request().method() === 'DELETE') {
      deletedSessions.push(sessionId);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Click Start -> request is held in-flight
  await page.locator('#start').click();
  await page.waitForTimeout(200);

  // 2. Dispatch pagehide event while Start is in-flight
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  // 3. Start response arrives shortly after pagehide
  if (resolveStartPromise) resolveStartPromise();

  // Wait for the .then callback and keepalive DELETE
  await expect.poll(() => deletedSessions).toContain('session_nav_1');
});

test('F7 regression: Save/Commit failure displays accurate non-speculative error messaging', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));
  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));
  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}] })
  }));
  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', route => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'session_ready_1', required: 3, samples: 3, state: 'ready' } })
      });
    } else {
      route.fallback();
    }
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', route => {
    const url = route.request().url();
    if (url.endsWith('/commit')) {
      // Simulate network / server unconfirmed failure
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'Internal Server Error' })
      });
    }
    if (url.endsWith('/preview')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: VALID_JPEG_BUFFER
      });
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'session_ready_1', required: 3, samples: 3, state: 'ready' } })
      });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // Start capture -> returns ready state
  await page.locator('#start').click();
  await expect(page.locator('#save')).toBeEnabled();

  // Check confirm and click save
  await page.locator('#confirm').check();
  await page.locator('#save').click();

  // Invariant F7: Error messaging must be accurate and non-speculative
  await expect(page.locator('#status')).toContainText('Chưa thể xác nhận lưu hồ sơ');
  await expect(page.locator('#error-guide-title')).toContainText('Chưa thể xác nhận lưu hồ sơ');
  await expect(page.locator('#error-guide-msg')).toContainText('Thao tác lưu chưa được máy chủ xác nhận');

  // Must NOT make speculative claims about guaranteed database failure or session release
  const errorGuideText = await page.locator('#error-guide-msg').textContent();
  expect(errorGuideText).not.toContain('đã giải phóng phiên lấy mẫu');
  expect(errorGuideText).not.toContain('Máy chủ chưa thể lưu hồ sơ vào cơ sở dữ liệu');
});

test('YIRLoDT R50 Enrollment dynamic progress bar (3, 5, 8 frames), retry and timeout recovery', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));

  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));

  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      status: 'success',
      data: [{user_code: 'YIR_042', full_name: 'Lê Hoàng Long', status: 'active'}]
    })
  }));

  let mockSessionData = {
    session_id: 'sess_test_123',
    state: 'capturing',
    samples: 2,
    required: 3,
    remaining_seconds: 22.4
  };

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', route => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      mockSessionData.required = body.frames || 3;
      mockSessionData.samples = 1;
      mockSessionData.state = 'capturing';
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({status: 'success', data: {session_id: 'sess_test_123'}})
      });
    } else {
      route.fallback();
    }
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_test_123', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({status: 'success', data: mockSessionData})
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_test_123/preview', route => {
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: VALID_JPEG_BUFFER
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/preview', route => {
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: VALID_JPEG_BUFFER
    });
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: VALID_JPEG_BUFFER
    });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();
  // Select 3 frames for multi-frame progress test
  await page.locator('#frames').selectOption('3');

  // Verify pre-Start global camera preview displays decoded image without broken placeholder
  await expect(page.locator('#preview')).not.toHaveClass(/hidden/, { timeout: 4000 });
  await expect(page.locator('#preview-status-text')).toHaveText('Camera trực tiếp sẵn sàng');
  await expect(page.locator('#preview-placeholder')).toHaveClass(/hidden/);
  const preStartWidth = await page.locator('#preview').evaluate(img => img.naturalWidth);
  expect(preStartWidth).toBeGreaterThan(0);

  // 1. Test 3 frames selection with 180-second session configuration
  mockSessionData.remaining_seconds = 175.4;
  await page.locator('#start').click();

  // Verify progress wrapper is shown and dynamic 3 segments exist
  await expect(page.locator('#progress-wrapper')).toBeVisible();
  await expect(page.locator('.segment-item')).toHaveCount(3);
  // Verify dynamic backend countdown reflects 180s deadline (e.g. 176s) without hardcoded 30s
  await expect(page.locator('#timer-badge')).toContainText('176s');
  await expect(page.locator('#status')).toContainText(/capturing:/);

  await page.screenshot({ path: path.join(screenshotDir, '07_enrollment_progress_3_frames.png') });

  // 2. Test localized error reason (stale_frame from Codex worker)
  mockSessionData.reason = 'stale_frame';
  await expect(page.locator('#status')).toContainText('Ảnh đã quá cũ, vui lòng thử lại', { timeout: 3000 });

  // 3. Test safe null remaining_seconds handling (never infer timeout on null)
  mockSessionData.reason = '';
  mockSessionData.remaining_seconds = null;
  await expect(page.locator('#timer-badge')).toHaveText('⏳ Đang lấy mẫu…', { timeout: 3000 });
  await expect(page.locator('#error-guide')).not.toBeVisible();

  // 4. Test decoupled preview resilience (HTTP 404 & HTTP 503 do NOT terminate session)
  await page.route('**/api/cpu-test/contracts/*/users/*/capture/preview', route => {
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Preview frame not ready' }) });
  });
  // Session must remain actively capturing despite preview 404
  await expect(page.locator('#status')).toContainText(/capturing:/);
  await expect(page.locator('#error-guide')).not.toBeVisible();

  // Then preview 503 (transient frame age > 5s)
  await page.route('**/api/cpu-test/contracts/*/users/*/capture/preview', route => {
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'No fresh frame' }) });
  });

  // 5. Test progress update (samples: 3/3 -> ready) while preview is 503
  mockSessionData.samples = 3;
  mockSessionData.remaining_seconds = 120.0;
  mockSessionData.state = 'ready';
  await expect(page.locator('.segment-item.completed')).toHaveCount(3, { timeout: 3000 });
  await expect(page.locator('#save')).toBeEnabled();

  // 6. Test explicit Timeout / Error guide handling without hardcoded 30s
  mockSessionData.state = 'timeout';
  mockSessionData.remaining_seconds = 0;
  await expect(page.locator('#error-guide')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#error-guide-title')).toHaveText('Đã hết thời gian lấy mẫu');
  await expect(page.locator('#retry')).toBeVisible();

  await page.screenshot({ path: path.join(screenshotDir, '07_enrollment_timeout_retry_guide.png') });

  // 6. Test HTTP 404 session missing terminates polling cleanly
  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_test_123', route => {
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Capture expired or unavailable' }) });
  });
  await page.locator('#retry').click();
  // Start new capture to trigger 404 on the polled route
  await expect(page.locator('#error-guide-title')).toHaveText('Phiên lấy mẫu đã kết thúc', { timeout: 4000 });
  await expect(page.locator('#status')).toContainText('Phiên lấy mẫu đã kết thúc hoặc không tồn tại');
});

test('YIRLoDT Lab Dashboard member search, light theme, and sticky header', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'synthetic-admin-token' } })
  }));

  await page.route('**/api/lab-attendance?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'success',
      timezone: 'Asia/Ho_Chi_Minh',
      week: { start: '2026-10-26', end_exclusive: '2026-11-02' },
      month: { start: '2026-10-01', end_exclusive: '2026-11-01' },
      data: [
        { user_id: 1, user_code: 'YIR_ALICE', full_name: 'Alice Pham', status: 'active', week_days: 3, month_days: 12, last_checkin: '2026-10-27T08:00:00Z', month_dates: ['2026-10-26', '2026-10-27'] },
        { user_id: 2, user_code: 'YIR_BOB', full_name: 'Bob Le', status: 'active', week_days: 1, month_days: 4, last_checkin: '2026-10-26T09:30:00Z', month_dates: ['2026-10-26'] },
      ]
    })
  }));

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(backend.url + '/lab-dashboard.html');

  // Login
  await page.locator('#password').fill('synthetic-password');
  await page.locator('#login-form button').click();
  await expect(page.locator('#dashboard')).toBeVisible();

  // Check light theme class and metrics
  await expect(page.locator('body')).toHaveClass(/yir-light/);
  await expect(page.locator('#member-count')).toHaveText('2');
  await expect(page.locator('#week-total')).toHaveText('4');
  await expect(page.locator('#month-total')).toHaveText('16');
  await expect(page.locator('#members tr')).toHaveCount(2);

  // Search filter
  await page.locator('#member-search').fill('ALICE');
  await expect(page.locator('#members tr')).toHaveCount(1);
  await expect(page.locator('#members')).toContainText('Alice Pham');
  await expect(page.locator('#members')).not.toContainText('Bob Le');

  await page.locator('#member-search').fill('');
  await expect(page.locator('#members tr')).toHaveCount(2);

  // Sticky header check
  const isSticky = await page.evaluate(() => {
    const th = document.querySelector('th');
    return window.getComputedStyle(th).position === 'sticky';
  });
  expect(isSticky).toBe(true);

  await page.screenshot({ path: path.join(screenshotDir, '06_dashboard_light_theme.png') });

  // 4. Client-side CSV export check (UTF-8 BOM, headers, and file download)
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^diem-danh-yirlodt-.*\.csv$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csvBuffer = Buffer.concat(chunks);
  const csvText = csvBuffer.toString('utf8');

  // Verify UTF-8 BOM: 0xEF, 0xBB, 0xBF
  expect(csvBuffer[0]).toBe(0xEF);
  expect(csvBuffer[1]).toBe(0xBB);
  expect(csvBuffer[2]).toBe(0xBF);
  expect(csvText).toContain('"Mã thành viên","Họ và tên","Trạng thái"');
  expect(csvText).toContain('"YIR_ALICE","Alice Pham"');

  // 5. Auto-refresh on month / week change
  let autoRefreshCalled = false;
  await page.route('**/api/lab-attendance?*month=2026-11*', route => {
    autoRefreshCalled = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        timezone: 'Asia/Ho_Chi_Minh',
        week: { start: '2026-11-02', end_exclusive: '2026-11-09' },
        month: { start: '2026-11-01', end_exclusive: '2026-12-01' },
        data: [
          { user_id: 1, user_code: 'YIR_ALICE', full_name: 'Alice Pham', status: 'active', week_days: 5, month_days: 20, last_checkin: '2026-11-03T08:00:00Z', month_dates: ['2026-11-02', '2026-11-03'] },
          { user_id: 2, user_code: 'YIR_BOB', full_name: 'Bob Le', status: 'active', week_days: 4, month_days: 15, last_checkin: '2026-11-03T09:30:00Z', month_dates: ['2026-11-02'] },
          { user_id: 3, user_code: '=FORMULA_INJECT', full_name: '+CmdInject', status: 'active', week_days: 1, month_days: 1, last_checkin: '2026-11-03T10:00:00Z', month_dates: ['2026-11-03'] },
        ]
      })
    });
  });

  await page.locator('#month').fill('2026-11');
  await page.locator('#month').dispatchEvent('change');
  await expect(page.locator('#member-count')).toHaveText('3', { timeout: 4000 });
  await expect(page.locator('#month-total')).toHaveText('36');
  expect(autoRefreshCalled).toBe(true);

  // Test formula injection protection on the new dataset
  const injectDownloadPromise = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const injectDownload = await injectDownloadPromise;
  const injectStream = await injectDownload.createReadStream();
  const injectChunks = [];
  for await (const chunk of injectStream) injectChunks.push(chunk);
  const injectCsv = Buffer.concat(injectChunks).toString('utf8');
  // Formula characters '=', '+' must be prepended with single quote "'"
  expect(injectCsv).toContain('"\'=FORMULA_INJECT"');
  expect(injectCsv).toContain('"\'\+CmdInject"');

  await page.screenshot({ path: path.join(screenshotDir, '08_dashboard_autorefresh_csv.png') });
});

test('YIRLoDT Admin Portal Unified Light Theme, tabs navigation, and responsiveness', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'synthetic-admin-token' } })
  }));

  await page.route('**/api/access-events*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [] })
  }));

  await page.route('**/api/lab-attendance*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      status: 'success',
      timezone: 'Asia/Ho_Chi_Minh',
      data: [
        { user_id: 1, user_code: 'YIR_001', full_name: 'Nguyễn Văn An', status: 'active', week_days: 3, month_days: 5, last_checkin: '2026-10-27T08:30:00Z', month_dates: ['2026-10-25', '2026-10-26'] }
      ]
    })
  }));

  await page.route('**/api/cpu-test/camera/diagnostics', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      status: 'success',
      data: {
        contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e',
        detected_faces: 1,
        detection_frames: 10,
        production_activated: false,
        timings_ms: { detector_ms: 35.2, alignment_ms: 1.5, recognition_ms: 70.0 }
      }
    })
  }));

  await page.route('**/api/cpu-test/camera/preview', route => route.fulfill({
    status: 200, contentType: 'image/jpeg',
    body: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64')
  }));

  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      status: 'success',
      data: [
        { user_id: 1, user_code: 'YIR_001', full_name: 'Nguyễn Văn An', status: 'active', has_face_profile: 1 },
        { user_id: 2, user_code: 'YIR_002', full_name: 'Trần Thị Bích', status: 'active', has_face_profile: 0 }
      ]
    })
  }));

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(backend.url + '/index.html');

  // Verify Login View branding & Light theme
  await expect(page.locator('.login-brand .brand-logo')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/yir-light/);
  await expect(page.locator('.slogan-tag')).toContainText('Ý tưởng hôm nay, kiến tạo ngày mai');
  await page.screenshot({ path: path.join(screenshotDir, '09_admin_login_light_theme.png') });

  // Login
  await page.locator('#login-password').fill('admin-password');
  await page.locator('#login-form button').click();
  await expect(page.locator('#app-view')).toBeVisible();

  // Verify App Header branding & Light theme background
  await expect(page.locator('header .brand-logo')).toBeVisible();
  await expect(page.locator('.admin-portal-badge')).toContainText('PORTAL QUẢN TRỊ');
  // Default active tab is now Attendance Dashboard
  await expect(page.locator('.tab-btn.active')).toHaveText('📊 Thống kê điểm danh');
  await expect(page.locator('#dash-member-count')).toHaveText('1');

  // Switch to Members tab
  await page.locator('[data-tab="members"]').click();
  await expect(page.locator('#tab-members')).toBeVisible();
  await expect(page.locator('#member-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#member-table')).toContainText('Nguyễn Văn An');
  await expect(page.locator('#member-table a[href*="r50-capture.html?user=YIR_001"]')).toBeVisible();

  await page.screenshot({ path: path.join(screenshotDir, '10_admin_portal_members_light.png') });

  // Switch to Diagnostics tab
  await page.locator('[data-tab="diagnostics"]').click();
  await expect(page.locator('#tab-diagnostics')).toBeVisible();
  await expect(page.locator('#diag-faces')).toHaveText('1');
  await expect(page.locator('#diag-status')).toHaveText('Fresh frame');

  // Mobile viewport check: 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(mobileWidth).toBeLessThanOrEqual(390);

  await page.screenshot({ path: path.join(screenshotDir, '11_admin_portal_mobile_light.png') });
});

test('YIRLoDT One-Image: Create new member, capture with one camera frame, confirm identity and save', async ({page}) => {
  let createdUsers = [];
  let capturedSession = null;
  let commitReceived = false;

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));

  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));

  await page.route('**/api/users', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: createdUsers })
      });
    } else if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      const canonical = {
        user_id: createdUsers.length + 1,
        user_code: b.user_code.trim().toUpperCase(),
        full_name: b.full_name.trim(),
        status: 'active',
        has_face_profile: 0
      };
      createdUsers.push(canonical);
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: canonical })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body.source).toBe('camera');
      expect(body.frames).toBe(1); // Exactly 1 frame!
      capturedSession = {
        session_id: 'sess_one_cam_001',
        user_code: 'LAB_99',
        source: 'camera',
        state: 'ready',
        required: 1,
        samples: 1,
        remaining_seconds: 178.5
      };
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: capturedSession })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_one_cam_001', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: capturedSession })
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_one_cam_001/preview', route => {
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: VALID_JPEG_BUFFER
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_one_cam_001/commit', async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.confirm_same_member === true) {
      commitReceived = true;
      const user = createdUsers.find(u => u.user_code === 'LAB_99');
      if (user) user.has_face_profile = 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          already_saved: false,
          data: {
            has_face_profile: 1,
            receipt: { session_id: 'sess_one_cam_001', user_code: 'LAB_99', contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' }
          }
        })
      });
    }
    return route.fulfill({ status: 400 });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Create a new member
  await page.locator('#mode-create').check();
  await expect(page.locator('#member-create-wrap')).toBeVisible();
  await page.locator('#full-name').fill('Trần Văn Bình');
  await page.locator('#user-code').fill('lab_99');
  await page.locator('#create-member-btn').click();

  // Verify created member active badge
  await expect(page.locator('#member-active-badge')).toBeVisible();
  await expect(page.locator('#member-active-text')).toHaveText('Trần Văn Bình (LAB_99)');
  await expect(page.locator('#member-profile-status')).toHaveText('Chưa có khuôn mặt');

  // 2. Start Camera Capture (1 image)
  await page.locator('#start').click();

  // Verify ready status and frozen preview
  await expect(page.locator('#status')).toContainText('Khuôn mặt đã được mô hình R50 xác thực đạt chuẩn');
  await expect(page.locator('#preview-status-text')).toContainText('Khuôn mặt hợp lệ (1/1)');

  // 3. Confirm identity is enforced before save
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Cần xác nhận đúng thành viên trước khi lưu');
  expect(commitReceived).toBe(false);

  // Check confirm and click save
  await page.locator('#confirm').check();
  await page.locator('#save').click();

  // 4. Verify durable receipt confirmation and updated profile
  await expect(page.locator('#status')).toContainText('Hồ sơ R50 đã được backend lưu theo contract thử nghiệm');
  expect(commitReceived).toBe(true);
  await expect(page.locator('#member-profile-status')).toHaveText('Đã có khuôn mặt');
});

test('YIRLoDT One-Image: Photo upload (JPEG/PNG), file validation, rejection reasons, and durable commit', async ({page}) => {
  let createdUsers = [{ user_id: 1, user_code: 'YIR_UPLOAD', full_name: 'Nguyễn Thị Hoa', status: 'active', has_face_profile: 0 }];
  let capturedSession = null;
  let commitSuccess = false;

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));

  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));

  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: createdUsers })
  }));

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let uploadAttempt = 0;
  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      uploadAttempt++;
      const headers = route.request().headers();
      expect(headers['content-type']).toContain('multipart/form-data');

      if (uploadAttempt === 1) {
        // First upload: multiple faces rejection
        capturedSession = {
          session_id: 'sess_up_multi',
          user_code: 'YIR_UPLOAD',
          source: 'upload',
          state: 'rejected',
          reason: 'multiple_faces',
          required: 1,
          samples: 0
        };
      } else {
        // Second upload: ready
        capturedSession = {
          session_id: 'sess_up_ready',
          user_code: 'YIR_UPLOAD',
          source: 'upload',
          state: 'ready',
          required: 1,
          samples: 1
        };
      }
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: capturedSession })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_up_multi', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data: capturedSession }) });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_up_ready', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data: capturedSession }) });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_up_ready/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_up_ready/commit', async route => {
    commitSuccess = true;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        already_saved: false,
        data: {
          has_face_profile: 1,
          receipt: { session_id: 'sess_up_ready', user_code: 'YIR_UPLOAD', contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' }
        }
      })
    });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Switch to Upload source
  await page.locator('#source-upload-btn').click();
  await expect(page.locator('#upload-panel')).toBeVisible();
  await expect(page.locator('#start')).toHaveText('Xác thực ảnh tải lên');

  // 2. Select file: Client-side validation for invalid type
  await page.locator('#face-image').setInputFiles({
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test')
  });
  await expect(page.locator('#status')).toContainText('Định dạng file không được hỗ trợ');

  // 3. Select valid PNG file with multiple faces
  await page.locator('#face-image').setInputFiles({
    name: 'two_people.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  });
  await expect(page.locator('#file-name')).toHaveText('two_people.png');

  // Click start upload
  await page.locator('#start').click();

  // 4. Verify rejection message and guide
  await expect(page.locator('#status')).toContainText('Phát hiện nhiều hơn 1 khuôn mặt');
  await expect(page.locator('#error-guide')).toBeVisible();
  await expect(page.locator('#error-guide-msg')).toContainText('Phát hiện nhiều hơn 1 khuôn mặt');

  // 5. Select valid portrait JPEG and retry
  await page.locator('#face-image').setInputFiles({
    name: 'portrait.jpg',
    mimeType: 'image/jpeg',
    buffer: VALID_JPEG_BUFFER
  });
  await page.locator('#start').click();

  // 6. Verify ready, confirm, and commit
  await expect(page.locator('#status')).toContainText('Khuôn mặt đã được mô hình R50 xác thực đạt chuẩn');
  await expect(page.locator('#preview-status-text')).toContainText('Khuôn mặt hợp lệ (1/1)');

  await page.locator('#confirm').check();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Hồ sơ R50 đã được backend lưu theo contract thử nghiệm');
  expect(commitSuccess).toBe(true);
});

test('YIRLoDT One-Image: Member duplicate code and invalid input error handling', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));

  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));

  await page.route('**/api/users', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: [{ user_id: 1, user_code: 'EXISTING_01', full_name: 'Existing Member', status: 'active', has_face_profile: 1 }] })
      });
    } else if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() || '{}');
      if (b.user_code === 'EXISTING_01') {
        return route.fulfill({
          status: 409, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', code: 'duplicate_member_code', message: 'Mã thành viên đã tồn tại' })
        });
      }
      if (!b.user_code || b.user_code.includes('/')) {
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', code: 'invalid_member', message: 'Mã thành viên không hợp lệ' })
        });
      }
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Switch to create mode
  await page.locator('#mode-create').check();

  // 2. Try empty fields
  await page.locator('#create-member-btn').click();
  await expect(page.locator('#member-error')).toContainText('Vui lòng nhập đầy đủ họ tên và mã thành viên');

  // 3. Try duplicate member code
  await page.locator('#full-name').fill('New Name');
  await page.locator('#user-code').fill('EXISTING_01');
  await page.locator('#create-member-btn').click();
  await expect(page.locator('#member-error')).toContainText('Mã thành viên "EXISTING_01" đã tồn tại trên hệ thống');

  // 4. Try invalid member code
  await page.locator('#user-code').fill('bad/code');
  await page.locator('#create-member-btn').click();
  await expect(page.locator('#member-error')).toContainText('Họ tên hoặc mã thành viên không hợp lệ');
});

test('YIRLoDT One-Image: Pending-Start Cancel race condition never claims confirmed cancellation until backend confirms', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({status: 'success', data: {token: 'synthetic-admin-token'}})
  }));

  await page.route('**/api/cpu-test/admin-scope', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      scope: 'isolated-r50-laptop-test',
      production_activated: false,
      embedding_contract: {contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e'}
    })
  }));

  await page.route('**/api/users', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: [{ user_id: 1, user_code: 'RACE_01', full_name: 'Race Subject', status: 'active', has_face_profile: 0 }] })
  }));

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let resolveStart = null;
  let deleteCalled = false;
  let deleteMode = 'success'; // 'success' or '503'

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(r => { resolveStart = r; });
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { session_id: 'sess_race_999', required: 1, samples: 0, state: 'capturing' } })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    if (route.request().method() === 'DELETE') {
      deleteCalled = true;
      if (deleteMode === 'success') {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { cancellation: 'cancelled', confirmed: true } })
        });
      } else {
        return route.fulfill({
          status: 503, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', data: { cancellation: 'unconfirmed', confirmed: false, recovery_deadline_seconds: 180 } })
        });
      }
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Click Start -> POST /capture held in-flight
  await page.locator('#start').click();

  // 2. User immediately clicks Cancel while Start is pending!
  await page.locator('#cancel').click();

  // Invariant: Status must show "Đang hủy phiên lấy mẫu…" and MUST NOT falsely say "Đã hủy phiên lấy mẫu."!
  await expect(page.locator('#status')).toContainText('Đang hủy phiên lấy mẫu');
  expect(await page.locator('#status').textContent()).not.toBe('Đã hủy phiên lấy mẫu.');

  // 3. Start response arrives from backend
  if (resolveStart) resolveStart();

  // 4. Frontend awaits the in-flight start, captures session_id, and sends DELETE
  await expect.poll(() => deleteCalled).toBe(true);

  // Status updates to confirmed cancellation ONLY after backend confirms
  await expect(page.locator('#status')).toHaveText('Đã hủy phiên lấy mẫu.');
  await expect(page.locator('#start')).toBeEnabled();
});

test('P1 regression: camera frame change after ready never overwrites frozen confirmation preview', async ({page}) => {
  const FROZEN_CONFIRMATION_JPEG = Buffer.from(
    '/9j//gAnQ09ORklSTUFUSU9OX0ZST1pFTl9GUkFNRV9URVNUX01BUktFUv/gABBKRklGAAEBAAABAAEAAP/bAEMAAgEBAQEBAgEBAQICAgICBAMCAgICBQQEAwQGBQYGBgUGBgYHCQgGBwkHBgYICwgJCgoKCgoGCAsMCwoMCQoKCv/bAEMBAgICAgICBQMDBQoHBgcKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCv/AABEIAAoACgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+f+iiigD/2Q==',
    'base64'
  );
  const LIVE_CAMERA_CHANGED_JPEG = VALID_JPEG_BUFFER;

  let currentCameraFeed = VALID_JPEG_BUFFER;
  let sessionPreviewRequested = 0;
  let livePreviewAfterReadyRequested = 0;
  let sessionState = 'capturing';

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'synthetic-admin-token' } })
  }));

  await page.route('**/api/users', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: [{ user_id: 'u_101', user_code: 'YIR_FROZEN_TEST', full_name: 'Nguyễn Văn Đạt', status: 'active', has_face_profile: 0 }]
      })
    });
  });

  await page.route('**/api/cpu-test/admin-scope', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'run_frozen_1',
        embedding_contract: { contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' },
        scope: 'isolated-r50-laptop-test',
        production_activated: false
      })
    });
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: currentCameraFeed });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      sessionState = 'ready';
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            session_id: 'sess_frozen_001',
            user_code: 'YIR_FROZEN_TEST',
            source: 'camera',
            state: 'ready',
            required: 1,
            samples: 1,
            remaining_seconds: 175.0
          }
        })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_frozen_001', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: {
          session_id: 'sess_frozen_001',
          user_code: 'YIR_FROZEN_TEST',
          source: 'camera',
          state: 'ready',
          required: 1,
          samples: 1,
          remaining_seconds: 174.5
        }
      })
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_frozen_001/preview', route => {
    sessionPreviewRequested++;
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: FROZEN_CONFIRMATION_JPEG
    });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/preview', route => {
    if (sessionState === 'ready') {
      livePreviewAfterReadyRequested++;
    }
    route.fulfill({
      status: 200, contentType: 'image/jpeg',
      body: currentCameraFeed
    });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // Click start capture
  await page.locator('#start').click();

  // Wait for ready state and confirm frozen preview was fetched
  await expect(page.locator('#status')).toContainText('Khuôn mặt đã được mô hình R50 xác thực đạt chuẩn');
  expect(sessionPreviewRequested).toBe(1);

  // Capture the frozen preview image source URL
  const frozenBlobSrc = await page.locator('#preview').getAttribute('src');
  expect(frozenBlobSrc).toMatch(/^blob:/);

  // Now, camera input changes drastically (e.g. subject walked away or different person)
  currentCameraFeed = LIVE_CAMERA_CHANGED_JPEG;

  // Wait 1.5 seconds across several polling intervals
  await page.waitForTimeout(1500);

  // Read currently displayed preview image in the DOM
  const finalBlobSrc = await page.locator('#preview').getAttribute('src');
  // Must remain the exact same frozen confirmation blob URL!
  expect(finalBlobSrc).toBe(frozenBlobSrc);
  // Must NOT have requested live camera frames once session reached ready
  expect(livePreviewAfterReadyRequested).toBe(0);

  // Canvas verify that the image rendered with natural dimensions
  const imgDimensions = await page.evaluate(() => {
    const img = document.getElementById('preview');
    return { width: img.naturalWidth, height: img.naturalHeight, hidden: img.classList.contains('hidden') };
  });
  expect(imgDimensions.width).toBeGreaterThan(0);
  expect(imgDimensions.height).toBeGreaterThan(0);
  expect(imgDimensions.hidden).toBe(false);

  // Verify save identity confirmation behavior
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Cần xác nhận đúng thành viên trước khi lưu');

  await page.locator('#confirm').check();
  await expect(page.locator('#save')).toBeEnabled();
});

test('P1 regression: frozen confirmation preview failure shows honest retry guidance and keeps Save disabled', async ({page}) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'synthetic-admin-token' } })
  }));

  await page.route('**/api/users', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: [{ user_id: 'u_102', user_code: 'YIR_PREV_FAIL', full_name: 'Lê Hoàng Nam', status: 'active', has_face_profile: 0 }]
      })
    });
  });

  await page.route('**/api/cpu-test/admin-scope', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'run_frozen_2',
        embedding_contract: { contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' },
        scope: 'isolated-r50-laptop-test',
        production_activated: false
      })
    });
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            session_id: 'sess_prev_fail_001',
            user_code: 'YIR_PREV_FAIL',
            source: 'camera',
            state: 'ready',
            required: 1,
            samples: 1,
            remaining_seconds: 170.0
          }
        })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_prev_fail_001', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: {
          session_id: 'sess_prev_fail_001',
          user_code: 'YIR_PREV_FAIL',
          source: 'camera',
          state: 'ready',
          required: 1,
          samples: 1,
          remaining_seconds: 169.5
        }
      })
    });
  });

  // Frozen preview endpoint fails with 503
  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_prev_fail_001/preview', route => {
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', message: 'Preview generator busy or unavailable' })
    });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  await page.locator('#start').click();

  // Honest retry guidance and error displayed
  await expect(page.locator('#status')).toContainText('Không thể tải ảnh xác nhận: HTTP 503');
  await expect(page.locator('#error-guide')).toBeVisible();
  await expect(page.locator('#error-guide-title')).toHaveText('Không thể tải ảnh xác nhận khuôn mặt');

  // Save and Confirm MUST remain disabled
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#confirm')).toBeDisabled();

  // Retry option is displayed
  await expect(page.locator('#retry')).toBeVisible();
});

test('P1 regression: pagehide followed by pageshow restores active controls, clears Trang da dong, resumes preview and allows Start', async ({page}) => {
  let startAuthHeader = null;
  let adminScopeRequestCount = 0;

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'token-pagehide-restoration-xyz' } })
  }));

  await page.route('**/api/users', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: [{ user_id: 'u_201', user_code: 'YIR_RESTORE_01', full_name: 'Võ Minh Trí', status: 'active', has_face_profile: 0 }]
      })
    });
  });

  await page.route('**/api/cpu-test/admin-scope', route => {
    adminScopeRequestCount++;
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'run_restore_1',
        embedding_contract: { contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' },
        scope: 'isolated-r50-laptop-test',
        production_activated: false
      })
    });
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      startAuthHeader = route.request().headers()['authorization'];
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            session_id: 'sess_restored_001',
            user_code: 'YIR_RESTORE_01',
            source: 'camera',
            state: 'ready',
            required: 1,
            samples: 1,
            remaining_seconds: 170.0
          }
        })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_restored_001/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/sess_restored_001', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: { session_id: 'sess_restored_001', state: 'ready', required: 1, samples: 1 }
      })
    });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Simulate persisted pagehide (page enters bfcache)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });

  // Verify pagehide state
  await expect(page.locator('#preview-placeholder-text')).toHaveText('Trang đã đóng');

  // 2. Simulate pageshow (page restored from bfcache)
  const initialScopeCount = adminScopeRequestCount;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  // Controls must remain visible, Login must remain hidden
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();

  // Scope verification must have been called during pageshow restoration
  await expect.poll(() => adminScopeRequestCount).toBeGreaterThan(initialScopeCount);

  // Status must confirm session restoration
  await expect(page.locator('#status')).toContainText('Đã khôi phục phiên đăng nhập');

  // Preview must NOT say "Trang đã đóng" anymore; camera preview must resume
  await expect(page.locator('#preview-placeholder-text')).not.toHaveText('Trang đã đóng');
  await expect(page.locator('#preview')).toBeVisible();

  // 3. Click Start capture -> must succeed with Bearer token, NEVER returning 401
  await page.locator('#start').click();
  expect(startAuthHeader).toBe('Bearer token-pagehide-restoration-xyz');
  await expect(page.locator('#status')).toContainText('Khuôn mặt đã được mô hình R50 xác thực đạt chuẩn');
});

test('P1 regression: pageshow after authentication loss/expiry hides active controls and presents login UI', async ({page}) => {
  let scopeStatusToReturn = 200;

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'token-to-be-expired' } })
  }));

  await page.route('**/api/users', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: [{ user_id: 'u_202', user_code: 'YIR_EXPIRE_01', full_name: 'Phạm Thị Mai', status: 'active', has_face_profile: 0 }]
      })
    });
  });

  await page.route('**/api/cpu-test/admin-scope', route => {
    if (scopeStatusToReturn === 200) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          run_id: 'run_expire_1',
          embedding_contract: { contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' },
          scope: 'isolated-r50-laptop-test',
          production_activated: false
        })
      });
    } else {
      return route.fulfill({
        status: 401, contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'Token expired or invalid' })
      });
    }
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // 1. Dispatch pagehide
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });

  // 2. Token expires or is revoked on server while page is hidden
  scopeStatusToReturn = 401;

  // 3. Dispatch pageshow
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });

  // Invariant: Controls MUST be hidden, Login UI MUST be visible!
  await expect(page.locator('#controls')).toBeHidden();
  await expect(page.locator('#login')).toBeVisible();

  // Preview placeholder must be reset to "Đang chờ đăng nhập…"
  await expect(page.locator('#preview-placeholder-text')).toHaveText('Đang chờ đăng nhập…');

  // Status must explain that authentication expired
  await expect(page.locator('#status')).toContainText('Phiên đăng nhập đã hết hạn');
});

test('P1 regression: repeated pagehide/pageshow navigation prevents stale request race conditions and cleans up sessions', async ({page}) => {
  let deletedSessions = [];

  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', data: { token: 'token-repeated-nav' } })
  }));

  await page.route('**/api/users', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: [{ user_id: 'u_203', user_code: 'YIR_REPEAT_01', full_name: 'Đặng Tuấn Anh', status: 'active', has_face_profile: 0 }]
      })
    });
  });

  await page.route('**/api/cpu-test/admin-scope', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'run_repeat_1',
        embedding_contract: { contract_id: '79f76beb9482d499318903c73449339e088c4d29e797e88916d79e5fb253d47e' },
        scope: 'isolated-r50-laptop-test',
        production_activated: false
      })
    });
  });

  await page.route('**/api/cpu-test/camera/preview', route => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG_BUFFER });
  });

  let sessionCount = 0;
  await page.route('**/api/cpu-test/contracts/*/users/*/capture', async route => {
    if (route.request().method() === 'POST') {
      sessionCount++;
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            session_id: `sess_repeat_${sessionCount}`,
            user_code: 'YIR_REPEAT_01',
            source: 'camera',
            state: 'queued',
            required: 1,
            samples: 0
          }
        })
      });
    }
    route.fallback();
  });

  await page.route('**/api/cpu-test/contracts/*/users/*/capture/**', async route => {
    if (route.request().method() === 'DELETE') {
      const parts = route.request().url().split('/');
      const delId = parts[parts.length - 1];
      deletedSessions.push(delId);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { cancellation: 'cancelled', confirmed: true } })
      });
    }
    route.fallback();
  });

  await page.goto(backend.url + '/r50-capture.html');
  await page.locator('#password').fill('admin-pass');
  await page.locator('#login button').click();
  await expect(page.locator('#controls')).toBeVisible();

  // Cycle 1: Start capture -> pagehide -> pageshow
  await page.locator('#start').click();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
  await expect.poll(() => deletedSessions).toContain('sess_repeat_1');

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Đã khôi phục phiên đăng nhập');

  // Cycle 2: Start capture again -> pagehide -> pageshow
  await page.locator('#start').click();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
  await expect.poll(() => deletedSessions).toContain('sess_repeat_2');

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#status')).toContainText('Đã khôi phục phiên đăng nhập');
  await expect(page.locator('#preview')).toBeVisible();
});
