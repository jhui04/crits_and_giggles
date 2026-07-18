import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';

const SUITE_ID = 'visibility-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Monster Data Visibility', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    // Ensure absolute isolation by resetting
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto('/');
    await page.waitForSelector('header');
  });

  test('should display monsters in the Oracle', async ({ page }) => {
    await page.click('body');
    await page.keyboard.press('Alt+O');
    await expect(page.locator('#oracle-title')).toBeVisible();
    await expect(page.locator('text=Loading monsters...')).not.toBeVisible({ timeout: 15000 });
    const status = page.locator('p[role="status"]');
    await expect(status).toBeVisible();
    const count = await page.locator('.monster-browser ul li').count();
    console.log('Oracle Monster Count:', count);
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('should display monsters in the Encounter Builder', async ({ page }) => {
    await page.click('body');
    
    // Verify we are on the seeded campaign
    await expect(page.locator('header')).toContainText(`Campaign: ${suiteSeed.name}`);

    // Open Encounter Builder
    await page.getByRole('button', { name: /Create Encounter/i }).click();
    await expect(page.locator('text=Encounter Builder')).toBeVisible();
    
    // Open Monster Picker
    await page.getByRole('button', { name: /Add Monster/i }).click();
    await expect(page.locator('#select-monster-title')).toBeVisible();

    await expect(page.locator('text=Loading monsters...')).not.toBeVisible({ timeout: 15000 });
    const status = page.locator('.monster-browser p[role="status"]');
    await expect(status).toBeVisible();
    const count = await page.locator('.monster-browser ul li').count();
    console.log('Encounter Builder Monster Count:', count);
    expect(count).toBeGreaterThanOrEqual(5);
  });
});
