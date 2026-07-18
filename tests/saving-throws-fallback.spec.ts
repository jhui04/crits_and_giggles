import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { seedStateSaves } from './seed-data';

test('Monster Saving Throws Fallback in Operations Modal', async ({ page, request, context }) => {
  const apiBase = 'http://localhost:3005/api';
  
  // 1. Reset and seed data
  await request.delete(`${apiBase}/danger/reset`);
  await request.post(`${apiBase}/campaigns`, { data: seedStateSaves });

  // 2. Setup app with the saves test campaign
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, seedStateSaves.id);
  
  await page.goto('/');
  await page.waitForSelector('header');
  
  // Verify correct campaign
  await expect(page.locator('header')).toContainText(`Campaign: ${seedStateSaves.name}`);

  // 3. Go to combat and load encounter
  await page.keyboard.press('Alt+m');
  
  const [encounterPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /Run Test Encounter/ }).click()
  ]);
  await encounterPage.waitForLoadState();
  
  // Wait for unit to appear in setup list
  await expect(encounterPage.getByText('Save Test Monster')).toBeVisible();
  await encounterPage.getByRole('button', { name: 'Start Combat' }).click();

  // 4. Open monster operations
  const optionsBtn = encounterPage.getByRole('button', { name: /Options/i }).first();
  await expect(optionsBtn).toBeVisible();
  await optionsBtn.click();
  
  // Wait for modal
  await expect(encounterPage.locator('[role="dialog"]')).toBeVisible();
  
  // Click Saving Throws
  await encounterPage.locator('[role="dialog"] button:has-text("Saving Throws")').click();
  
  // 5. Verify skill/save values for Aartuk Starhorror
  // Stats: STR +1, DEX +0, CON +2, INT +1, WIS +3, CHA +0
  await expect(encounterPage.locator('button:has-text("STR: +1")')).toBeVisible();
  await expect(encounterPage.locator('button:has-text("DEX: +0")')).toBeVisible();
  await expect(encounterPage.locator('button:has-text("CON: +2")')).toBeVisible();
  await expect(encounterPage.locator('button:has-text("WIS: +3")')).toBeVisible();

  // 6. Run a scan
  await checkA11y(encounterPage, 'Monster Operations - Skills/Saves Fallback');
  await encounterPage.close();
});
