import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'baseline-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Accessibility Baseline Scans', () => {
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
      localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto('/');
    await page.waitForSelector('main');
    
    // Verify correct campaign loaded
    await expect(page.locator('header')).toContainText(`Campaign: ${suiteSeed.name}`);
  });

  test('Create Mode Baseline', async ({ page }) => {
    await checkA11y(page, 'Create Mode - Campaign Builder');
  });

  test('Run Mode - Story Tab Baseline', async ({ page }) => {
    await page.click('text=Switch to Run Mode');
    await checkA11y(page, 'Run Mode - Story Tab');
  });

  test('Run Mode - Encounter Runner Baseline', async ({ page, context }) => {
    await page.click('text=Switch to Run Mode');
    
    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Test Encounter/ }).click()
    ]);
    await encounterPage.waitForLoadState();
    await checkA11y(encounterPage, 'Run Mode - Encounter Runner');
    await encounterPage.close();
  });

  test('Oracle Baseline', async ({ page }) => {
    // Open Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.waitForSelector('#main-menu-title');
    
    // Open Oracle from menu
    await page.click('text=The Oracle (Alt+O)');
    await page.waitForSelector('.oracle-overlay');
    await checkA11y(page, 'Oracle Modal');
  });
});
