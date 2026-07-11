import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'world-switcher-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('main');
};

test.describe('World Switcher Modal E2E and A11y', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed campaign: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('should open, create world, select it, delete it, and handle focus correctly', async ({ page }) => {
    // 1. Open switcher with Alt+W and verify focus
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.focus();
    await page.keyboard.press('Alt+w');
    
    const switcherHeading = page.locator('#world-switcher-title');
    await expect(switcherHeading).toBeVisible();
    await expect(switcherHeading).toBeFocused();

    // Run axe check
    await checkA11y(page, 'World Switcher Modal');

    // 2. Click Create New World
    await page.getByRole('button', { name: '+ Create New World' }).click();
    const newWorldHeading = page.locator('#world-switcher-title');
    await expect(newWorldHeading).toBeVisible();
    await expect(newWorldHeading).toBeFocused();

    // Fill details
    await page.getByLabel('World Name:').fill('Forgotten Realms');
    await page.getByLabel('Description:').fill('Classic D&D world setting.');
    
    // Submit
    await page.getByRole('button', { name: 'Create & Select' }).click();
    
    // Switcher should close, focus should go back to main menu trigger
    await expect(switcherHeading).not.toBeVisible();
    await expect(mainMenuTrigger).toBeFocused();

    // Check header for updated world name
    await expect(page.locator('header')).toContainText('World: Forgotten Realms');

    // 3. Open Switcher again, select Forgotten Realms, close, and verify focus restoration
    await page.keyboard.press('Alt+w');
    await expect(switcherHeading).toBeVisible();
    await expect(switcherHeading).toBeFocused();

    // Click Forgotten Realms button (with Active badge)
    const selectBtn = page.getByRole('button', { name: 'Forgotten Realms (Active)' });
    await expect(selectBtn).toBeVisible();
    await selectBtn.click();

    // Should close and restore focus
    await expect(switcherHeading).not.toBeVisible();
    await expect(mainMenuTrigger).toBeFocused();

    // 4. Delete world
    await page.keyboard.press('Alt+w');
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to delete');
      await dialog.accept();
    });
    
    await page.getByRole('button', { name: 'Delete Forgotten Realms' }).click();
    await expect(page.getByRole('button', { name: 'Forgotten Realms (Active)' })).not.toBeVisible();

    // Close switcher using Escape
    await page.keyboard.press('Escape');
    await expect(switcherHeading).not.toBeVisible();
  });
});
