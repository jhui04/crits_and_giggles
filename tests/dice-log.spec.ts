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

  test('opens via Alt+D, verifies focus and a11y, filters entries, and restores focus on Escape', async ({ page }) => {
    // 1. Focus the main menu button to establish trigger element
    const headerBtn = page.locator('button[aria-label="Open Main Menu"]');
    await headerBtn.focus();
    await expect(headerBtn).toBeFocused();

    // 2. Open Dice Roller (Alt+R) to produce a roll with metadata
    await page.keyboard.press('Alt+KeyR');
    const rollerModal = page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
    await expect(rollerModal).toBeVisible();

    const input = page.locator('#dice-notation-input');
    await input.focus();
    await input.fill('2d6+3');
    await page.keyboard.press('Enter');

    // Close Dice Roller
    await page.keyboard.press('Escape');
    await expect(rollerModal).not.toBeVisible();

    // 3. Open Dice Log via Alt+D
    await page.keyboard.press('Alt+KeyD');
    const logModal = page.locator('[role="dialog"][aria-labelledby="dice-log-title"]');
    await expect(logModal).toBeVisible();

    // 4. Focus lands on heading
    const heading = page.locator('#dice-log-title');
    await expect(heading).toBeFocused();

    // 5. Check a11y
    await checkA11y(page, 'Dice Log Modal');

    // 6. Verify entry metadata
    const logList = logModal.locator('ul[aria-label="Dice rolls list"]');
    await expect(logList).toBeVisible();
    await expect(logList).toContainText('Dice Roller');
    await expect(logList).toContainText('Manual Roll');
    await expect(logList).toContainText('2d6+3');

    // 7. Test search filter
    const searchInput = page.locator('#dice-log-search');
    await searchInput.fill('Manual');
    await expect(logList.locator('li')).toHaveCount(1);

    await searchInput.fill('NonExistentTerm');
    await expect(logModal.getByText('No rolls match the current filter.')).toBeVisible();

    // 8. Close with Escape and verify focus restoration
    await page.keyboard.press('Escape');
    await expect(logModal).not.toBeVisible();
    await expect(headerBtn).toBeFocused();
  });

  test('opens Dice Log from Main Menu', async ({ page }) => {
    const headerBtn = page.locator('button[aria-label="Open Main Menu"]');
    await headerBtn.click();

    const menuModal = page.locator('[role="dialog"][aria-labelledby="main-menu-title"]');
    await expect(menuModal).toBeVisible();

    const diceLogBtn = page.getByRole('button', { name: /DM Dice Roll Log/ });
    await expect(diceLogBtn).toBeVisible();
    await diceLogBtn.click();

    const logModal = page.locator('[role="dialog"][aria-labelledby="dice-log-title"]');
    await expect(logModal).toBeVisible();
    await expect(page.locator('#dice-log-title')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(logModal).not.toBeVisible();
  });
});
