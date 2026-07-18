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
  await page.waitForSelector('header');
};

test.describe('World Link and Management E2E and A11y', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed campaign: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('should open main menu, open campaign settings, link/create/delete world, and handle focus correctly', async ({ page }) => {
    // 1. Open Main Menu and Campaign Settings
    const mainMenuTrigger = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuTrigger.click();
    
    const settingsBtn = page.getByRole('button', { name: 'Campaign Settings' });
    await settingsBtn.click();
    
    const campaignHeading = page.locator('#campaign-modal-title');
    await expect(campaignHeading).toBeVisible();
    await expect(campaignHeading).toBeFocused();

    // 2. Open Change World modal
    const changeWorldBtn = page.getByRole('button', { name: 'Change World' });
    await changeWorldBtn.click();
    
    const worldPickerHeading = page.locator('#world-picker-title');
    await expect(worldPickerHeading).toBeVisible();
    await expect(worldPickerHeading).toBeFocused();

    // Run axe check on the world link modal
    await checkA11y(page, 'Link Campaign to World Modal');

    // 3. Click Create New World
    await page.getByRole('button', { name: '+ Create New World' }).click();
    const newWorldHeading = page.locator('#world-picker-title');
    await expect(newWorldHeading).toBeVisible();
    await expect(newWorldHeading).toBeFocused();

    // Fill details
    await page.getByLabel('World Name:').fill('Forgotten Realms');
    await page.getByLabel('Description:').fill('Classic D&D world setting.');
    
    // Submit
    await page.getByRole('button', { name: 'Create & Link' }).click();
    
    // World Picker should close, focus should go back to "Change World" button
    await expect(worldPickerHeading).not.toBeVisible();
    await expect(changeWorldBtn).toBeFocused();

    // Check header for updated world name
    await expect(page.locator('header')).toContainText('World: Forgotten Realms');

    // 4. Open Change World again, verify active linking, and delete the world
    await changeWorldBtn.click();
    await expect(worldPickerHeading).toBeVisible();
    await expect(worldPickerHeading).toBeFocused();

    // Verify linked world is listed
    const linkBtn = page.getByRole('button', { name: 'Forgotten Realms (Linked)' });
    await expect(linkBtn).toBeVisible();

    // Setup dialog handler for delete confirmation
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to delete');
      await dialog.accept();
    });
    
    await page.getByRole('button', { name: 'Delete Forgotten Realms' }).click();
    await expect(page.getByRole('button', { name: 'Forgotten Realms (Linked)' })).not.toBeVisible();

    // Close world picker modal using Escape, verify focus returns to Change World button
    await page.keyboard.press('Escape');
    await expect(worldPickerHeading).not.toBeVisible();
    await expect(changeWorldBtn).toBeFocused();

    // Close Campaign Settings modal using Escape, verify focus returns to Main Menu trigger
    await page.keyboard.press('Escape');
    await expect(campaignHeading).not.toBeVisible();
    await expect(mainMenuTrigger).toBeFocused();
  });
});
