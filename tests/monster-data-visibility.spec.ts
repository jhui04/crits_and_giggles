import { test, expect } from '@playwright/test';

test.describe('Monster Data Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
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
    
    // Create a campaign first
    await page.keyboard.press('Alt+C');
    await expect(page.locator('text=Select Campaign')).toBeVisible();
    await page.getByRole('button', { name: /Create New Campaign/i }).click();
    await page.getByLabel(/Campaign Name/i).fill('Test Campaign');
    await page.getByRole('button', { name: /Create & Select/i }).click();
    await expect(page.locator('text=Campaign: Test Campaign')).toBeVisible();

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
