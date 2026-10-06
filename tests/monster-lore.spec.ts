import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'lore-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Monster Lore Visibility', () => {
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

  test('should display monster description and lore sections in Oracle', async ({ page }) => {
    // Open Oracle
    await page.keyboard.press('Alt+O');
    await expect(page.locator('#oracle-title')).toBeVisible();
    
    // Wait for monsters to load
    await expect(page.locator('text=Loading monsters...')).not.toBeVisible({ timeout: 15000 });

    // Search for Adult Black Dragon to make it visible
    await page.getByLabel('Search Monsters').fill('Adult Black Dragon');

    // Select "Adult Black Dragon" (which we know has lore)
    const dragonLink = page.getByRole('button', { name: /Adult Black Dragon/i }).first();
    await dragonLink.click();

    // Check for Description heading
    await expect(page.getByRole('heading', { name: 'Description' })).toBeVisible();
    
    // Check for Lair Actions heading (lore section)
    await expect(page.getByRole('heading', { name: 'Lair Actions' })).toBeVisible();
    
    // Check for Regional Effects heading
    await expect(page.getByRole('heading', { name: 'Regional Effects' })).toBeVisible();

    // Verify accessibility
    await checkA11y(page, 'Monster Details with Lore');
  });
});
