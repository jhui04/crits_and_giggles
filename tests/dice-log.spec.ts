import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'dice-log-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Dice Roll Log Accessibility & Functionality', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
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

  test('opens via Alt+D, rolls, verifies focus and a11y, filters entries, and restores focus on Escape', async ({ page }) => {
    // 1. Focus the main menu button to establish trigger element
    const headerBtn = page.locator('button[aria-label="Open Main Menu"]');
    await headerBtn.focus();
    await expect(headerBtn).toBeFocused();

    // 2. Open the combined Dice Roller and Log (Alt+D) and roll
    await page.keyboard.press('Alt+KeyD');
    const logModal = page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
    await expect(logModal).toBeVisible();
    await expect(page.locator('#dice-roller-title')).toBeFocused();

    const input = page.locator('#dice-notation-input');
    await input.focus();
    await input.fill('2d6+3');
    await page.keyboard.press('Enter');

    // 3. Check a11y
    await checkA11y(page, 'Dice Roller and Log Modal');

    // 4. Verify entry reads as a single statement
    const logList = logModal.locator('ul[aria-label="Dice rolls"]');
    await expect(logList).toBeVisible();
    await expect(logList).toContainText('Dice Roller');
    await expect(logList).toContainText('Manual Roll');
    await expect(logList).toContainText('2d6+3');

    // 5. Filter panel is collapsed until the Filter button is used
    const filterBtn = logModal.getByRole('button', { name: /^Filter/ });
    await expect(filterBtn).toHaveAttribute('aria-expanded', 'false');
    await filterBtn.click();
    await expect(filterBtn).toHaveAttribute('aria-expanded', 'true');

    const searchInput = page.locator('#dice-log-search');
    await searchInput.fill('Manual');
    await expect(logList.locator('li')).toHaveCount(1);
    await expect(logModal.getByRole('button', { name: 'Filter, 1 active' })).toBeVisible();

    await searchInput.fill('NonExistentTerm');
    await expect(logModal.getByText('No rolls match the current filter.')).toBeVisible();

    // 6. Close with Escape and verify focus restoration
    await page.keyboard.press('Escape');
    await expect(logModal).not.toBeVisible();
    await expect(headerBtn).toBeFocused();
  });

  test('opens Dice Roller and Log from Main Menu', async ({ page }) => {
    const headerBtn = page.locator('button[aria-label="Open Main Menu"]');
    await headerBtn.click();

    const menuModal = page.locator('[role="dialog"][aria-labelledby="main-menu-title"]');
    await expect(menuModal).toBeVisible();

    const diceLogBtn = page.getByRole('button', { name: 'Dice Roller' });
    await expect(diceLogBtn).toBeVisible();
    await diceLogBtn.click();

    const logModal = page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
    await expect(logModal).toBeVisible();
    await expect(page.locator('#dice-roller-title')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(logModal).not.toBeVisible();
  });
});
