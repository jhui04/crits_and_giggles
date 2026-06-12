import { test, expect } from '@playwright/test';

test.describe('Core User Journeys', () => {

  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
  });

  test.beforeEach(async ({ page }) => {
    // Clear state before each test to ensure we start from scratch
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/');
    await page.waitForSelector('main');
  });

  test('User can create a new campaign and switch to it', async ({ page }) => {
    // Open Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    
    // Open Switch Campaign modal
    await page.click('text=Switch Campaign');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Click Create New Campaign
    await page.click('text=Create New Campaign');
    
    // Fill out the form
    await page.fill('#new-camp-name', 'The Lost Mines of Phandelver');
    await page.fill('#new-camp-desc', 'A perilous journey.');
    
    // Submit
    await page.click('button:has-text("Create & Select")');

    // Verify modal closed and campaign is active
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    await expect(page.locator('header')).toContainText('Campaign: The Lost Mines of Phandelver');
  });

  test('User can toggle between Create and Run mode', async ({ page }) => {
    // By default, should be in Create Mode
    await expect(page.locator('text=Create Mode')).toBeVisible();
    await expect(page.locator('text=Campaign Builder')).toBeVisible();

    // Switch to Run Mode
    await page.click('text=Switch to Run Mode');
    
    // Verify Run Mode UI
    await expect(page.locator('text=Run Mode')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Combat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Story' })).toBeVisible();

    // Switch back
    await page.click('text=Switch to Create Mode');
    await expect(page.locator('text=Create Mode')).toBeVisible();
  });
});
