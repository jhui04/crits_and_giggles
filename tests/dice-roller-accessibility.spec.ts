import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';

const SUITE_ID = 'dice-roller-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Dice Roller Accessibility & Functionality', () => {
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

  test('opens, rolls chained dice, updates live region, and handles errors', async ({ page }) => {
    // 1. Focus the main menu button to establish a clear activeElement
    const headerBtn = page.locator('button[aria-label="Open Main Menu"]');
    await headerBtn.focus();
    await expect(headerBtn).toBeFocused();

    // 2. Open Dice Roller via Alt+R shortcut
    await page.keyboard.press('Alt+KeyR');

    const modal = page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
    await expect(modal).toBeVisible();

    // 2. Focus should land on the heading
    const heading = page.locator('#dice-roller-title');
    await expect(heading).toBeFocused();

    // 3. Focus input and type a chained notation
    const input = page.locator('#dice-notation-input');
    await input.focus();
    await input.fill('1d10+2+2d4');

    // 4. Press Enter to roll
    await page.keyboard.press('Enter');

    // 5. Verify result elements are visible
    const totalResult = modal.locator('[data-testid="grand-total"]');
    await expect(totalResult).toBeVisible();

    // 6. Verify live region announcement content
    const liveRegion = page.locator('[aria-live="assertive"]');
    await expect(liveRegion).toContainText('Result:');
    await expect(liveRegion).toContainText('Rolled: 1d10+2+2d4');

    // 7. Verify roll history exists
    const historyItem = modal.locator('ul li').first();
    await expect(historyItem).toBeVisible();
    await expect(historyItem).toContainText('1d10+2+2d4');

    // 8. Test error handling
    await input.focus();
    await input.fill('invalid_input');
    await page.click('button:has-text("Roll")');

    const errorAlert = modal.locator('[role="alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('Error:');

    // 9. Clear inputs and errors
    await page.click('button:has-text("Clear")');
    await expect(errorAlert).not.toBeVisible();
    await expect(input).toHaveValue('');

    // 10. Close using Escape key and check focus restoration
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await expect(headerBtn).toBeFocused(); // Focus must be restored
  });
});
