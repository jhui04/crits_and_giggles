import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'spell-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Oracle Spell Accessibility', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    // Ensure absolute isolation by resetting
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    // Inject active campaign seed and load main page
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto('/');
    await page.waitForSelector('header');
  });

  test('should search and view details of a spell with correct focus', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await expect(oracle).toBeVisible();

    // Switch Search Type to Spells
    await page.selectOption('#oracle-type-filter', 'spell');

    // Heading must receive focus first (confirms SR exits Forms Mode before input takes over)
    await expect(page.locator('#oracle-title')).toBeFocused();

    // Focus must land on the spell search input automatically
    const searchInput = page.locator('#spell-search');
    await expect(searchInput).toBeFocused();

    // Query for "Acid Splash"
    await searchInput.fill('Acid Splash');

    // Wait for filtered results and verify name
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('Acid Splash');

    // Ensure accessibility of the search interface
    await checkA11y(page, 'Oracle Spell Search');

    // Click the spell button to open details
    const targetButton = results.first();
    await targetButton.click();

    // Verify detail view opens and header focuses
    const detailHeading = page.locator('h3:has-text("Acid Splash")');
    await expect(detailHeading).toBeVisible();
    await expect(detailHeading).toBeFocused();

    // Close details using Escape
    await page.keyboard.press('Escape');
    await expect(detailHeading).not.toBeVisible();

    // Verify focus is restored back to the clicked result button
    await expect(targetButton).toBeFocused();

    // Close the Oracle modal
    await page.keyboard.press('Escape');
    await expect(oracle).not.toBeVisible();
  });

  test('should trap focus within the details modal', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    // Switch Search Type to Spells
    await page.selectOption('#oracle-type-filter', 'spell');

    // Heading must receive focus first (confirms SR exits Forms Mode before input takes over)
    await expect(page.locator('#oracle-title')).toBeFocused();

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const searchInput = oracle.locator('#spell-search');
    await searchInput.fill('Acid Splash');

    // Click the spell button to open details modal
    const results = oracle.locator('ul li button');
    await results.first().click();

    const detailsHeading = page.locator('h3:has-text("Acid Splash")');
    await expect(detailsHeading).toBeVisible();
    await expect(detailsHeading).toBeFocused();

    // Verify focus trapping
    const closeBtn = page.locator('[role="dialog"][aria-labelledby="spell-preview-title"]').getByRole('button', { name: 'Close', exact: true });
    await closeBtn.focus();
    await expect(closeBtn).toBeFocused();

    // Press Tab - should wrap back to the first focusable element (heading 'h3')
    await page.keyboard.press('Tab');
    await expect(detailsHeading).toBeFocused();

    // Press Shift+Tab - should wrap to the last focusable element (close button)
    await page.keyboard.press('Shift+Tab');
    await expect(closeBtn).toBeFocused();

    // Close details
    await page.keyboard.press('Escape');
    await expect(detailsHeading).not.toBeVisible();
  });

  test('should trap focus within the filters modal', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    // Switch Search Type to Spells
    await page.selectOption('#oracle-type-filter', 'spell');

    // Heading must receive focus first (confirms SR exits Forms Mode before input takes over)
    await expect(page.locator('#oracle-title')).toBeFocused();

    // Click Filters to open filters modal
    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await oracle.locator('button:has-text("Filters")').click();

    const filterModal = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
    await expect(filterModal).toBeVisible();
    await expect(page.locator('#filters-title')).toBeFocused();

    // Focus last element (Apply Filters button)
    const applyButton = page.locator('button:has-text("Apply Filters")');
    await applyButton.focus();
    await expect(applyButton).toBeFocused();

    // Tab forward - should wrap to the first element (summary tag "Level")
    await page.keyboard.press('Tab');
    const firstElement = page.locator('summary:has-text("Level")');
    await expect(firstElement).toBeFocused();

    // Shift+Tab backward - should wrap back to the last element (Apply Filters button)
    await page.keyboard.press('Shift+Tab');
    await expect(applyButton).toBeFocused();

    // Close filters modal
    await page.keyboard.press('Escape');
    await expect(filterModal).not.toBeVisible();
  });

  test('should filter spells by source book', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');
    await page.selectOption('#oracle-type-filter', 'spell');

    // Heading must receive focus first (confirms SR exits Forms Mode before input takes over)
    await expect(page.locator('#oracle-title')).toBeFocused();

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await oracle.locator('button:has-text("Filters")').click();

    const filterModal = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
    await expect(filterModal).toBeVisible();

    // Expand Source Book section
    await page.click('summary:has-text("Source")');

    // Click first source checkbox
    const sourceCheckbox = filterModal.locator('fieldset:has(legend:has-text("Source")) label input[type="checkbox"]').first();
    await sourceCheckbox.check();

    // Apply filters
    await page.click('button:has-text("Apply Filters")');
    await expect(filterModal).not.toBeVisible();

    // Verify list narrows down
    const itemsCount = await oracle.locator('ul li').count();
    expect(itemsCount).toBeGreaterThan(0);
  });
});
