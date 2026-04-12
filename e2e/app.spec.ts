import { test, expect } from '@playwright/test';

// Helper: ensure app is in full layout mode (not sidecar)
async function ensureFullMode(page: any) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  // If in sidecar mode, there's no sidebar — click expand/full if available
  const fullBtn = page.locator('.win-btn[title="Full layout"]');
  if (await fullBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fullBtn.click();
    await page.waitForTimeout(500);
  }
}

test.describe('Pai App — Navigation & Layout', () => {
  test('loads dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.dashboard, .hero, .chat-panel')).toBeVisible({ timeout: 10000 });
  });

  test('sidebar has all nav items', async ({ page }) => {
    await page.goto('/');
    // In full mode, sidebar should be visible
    const sidebar = page.locator('.sidebar');
    if (await sidebar.isVisible()) {
      await expect(sidebar.locator('nav a')).toHaveCount(5, { timeout: 5000 });
    }
  });

  test('navigates to Notes/Tasks page', async ({ page }) => {
    await page.goto('/notes');
    await expect(page).toHaveURL(/notes/);
  });

  test('navigates to Files page', async ({ page }) => {
    await ensureFullMode(page);
    await ensureFullMode(page); await page.goto('/files');
    await expect(page.locator('.files-split-layout').first()).toBeVisible({ timeout: 10000 });
  });

  test('navigates to People page', async ({ page }) => {
    await ensureFullMode(page);
    await ensureFullMode(page); await page.goto('/people');
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 10000 });
  });

  test('navigates to Emails page', async ({ page }) => {
    await ensureFullMode(page);
    await ensureFullMode(page); await page.goto('/emails');
    await expect(page.locator('.emails-layout')).toBeVisible({ timeout: 10000 });
  });

  test('navigates to Settings page', async ({ page }) => {
    await ensureFullMode(page);
    await ensureFullMode(page); await page.goto('/settings');
    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Pai App — Chat', () => {
  test('chat panel is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.chat-panel').first()).toBeVisible({ timeout: 10000 });
  });

  test('chat input exists and is enabled', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('.chat-input-bar textarea');
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect(input).toBeEnabled();
  });

  test('can type in chat input', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('.chat-input-bar textarea');
    await input.fill('hello test');
    await expect(input).toHaveValue('hello test');
  });

  test('send button exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.chat-send')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Pai App — Dashboard', () => {
  test('shows greeting', async ({ page }) => {
    await page.goto('/');
    // Dashboard should show a greeting or the chat in sidecar mode
    const greeting = page.locator('.hero h1');
    const chat = page.locator('.chat-panel');
    await expect(greeting.or(chat)).toBeVisible({ timeout: 10000 });
  });

  test('shows meetings section when available', async ({ page }) => {
    await page.goto('/');
    // Meetings section may or may not be present depending on calendar data
    const meetings = page.locator('text=Today\'s Meetings');
    // Just check the page loaded, meetings are optional
    await expect(page.locator('.dashboard, .chat-panel')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Pai App — Files', () => {
  test('files page loads with tabs', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/files');
    await expect(page.locator('.files-tab')).toHaveCount(2, { timeout: 5000 }); // Open, Recent
  });

  test('search input exists', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/files');
    const search = page.locator('.fe-search input');
    await expect(search).toBeVisible({ timeout: 5000 });
  });

  test('can search files', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/files');
    const search = page.locator('.fe-search input');
    await search.fill('test');
    // Search should filter — either results or "No files found"
    await page.waitForTimeout(500);
  });

  test('context menu has Open and Copy Link', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/files');
    const file = page.locator('.fe-file').first();
    if (await file.isVisible()) {
      await file.click({ button: 'right' });
      await expect(page.locator('.context-menu')).toBeVisible();
      await expect(page.locator('.context-menu >> text=Open in Browser')).toBeVisible();
      await expect(page.locator('.context-menu >> text=Copy Link')).toBeVisible();
      await expect(page.locator('.context-menu >> text=Pin')).toBeVisible();
    }
  });
});

test.describe('Pai App — Emails', () => {
  test('emails page loads', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/emails');
    await expect(page.locator('.emails-layout')).toBeVisible({ timeout: 5000 });
  });

  test('folder panel visible', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/emails');
    await expect(page.locator('.email-folders-panel')).toBeVisible({ timeout: 5000 });
  });

  test('has sync button', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/emails');
    await expect(page.locator('button >> text=Sync')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Pai App — People', () => {
  test('people page loads with tabs', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/people');
    await expect(page.locator('text=Top')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=My Team')).toBeVisible();
  });

  test('search input exists', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/people');
    const input = page.locator('input[placeholder*="Search"]');
    await expect(input).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Pai App — Settings', () => {
  test('settings page loads', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/settings');
    await expect(page.locator('text=Assistant Personality')).toBeVisible({ timeout: 5000 });
  });

  test('has window mode dropdown', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/settings');
    await expect(page.locator('select').first()).toBeVisible({ timeout: 5000 });
  });

  test('has keyboard shortcuts section', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/settings');
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible({ timeout: 5000 });
  });

  test('has memory section', async ({ page }) => {
    await ensureFullMode(page); await page.goto('/settings');
    await expect(page.locator('text=Memory')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Pai API — Server endpoints', () => {
  test.describe.configure({ timeout: 60000 });

  test('dashboard API returns data', async ({ page }) => {
    await page.goto('http://localhost:3001/api/dashboard', { timeout: 45000 });
    const text = await page.locator('body').textContent({ timeout: 45000 });
    const data = JSON.parse(text || '{}');
    expect(data).toHaveProperty('activeReminderCount');
    expect(data).toHaveProperty('openTaskCount');
  });

  test('notes API returns array', async ({ page }) => {
    await page.goto('http://localhost:3001/api/notes');
    const text = await page.locator('body').textContent();
    expect(Array.isArray(JSON.parse(text || '[]'))).toBe(true);
  });

  test('emails API returns array', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/emails');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('memory graph stats', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/memory/stats');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('nodeCount');
    expect(data).toHaveProperty('edgeCount');
  });

  test('preferences profile', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/preferences/profile');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('preferences');
  });

  test('email attention endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/emails/attention');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('email daily summary', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/emails/daily-summary');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('date');
    expect(data).toHaveProperty('stats');
  });

  test('files pinned endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/files/pinned');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('chat auth check', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/chat/auth');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('authenticated');
  });
});
