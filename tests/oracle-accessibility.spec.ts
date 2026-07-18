import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';

const SUITE_ID = 'oracle-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Oracle Accessibility', () => {
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

  test('Oracle opens, search works, and focus management is correct', async ({ page }) => {
    // 1. Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await expect(oracle).toBeVisible();

    // 2. Check focus on search input
    const searchInput = page.locator('#monster-search');
    await expect(searchInput).toBeFocused();

    // 3. Search for "Aboleth"
    await searchInput.fill('Aboleth');
    
    // Wait for filtered results
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('Aboleth');

    // 4. Open Detail Modal
    const abolethButton = results.first();
    await abolethButton.click();

    const detailModal = page.locator('[role="dialog"] h3:has-text("Aboleth")');
    await expect(detailModal).toBeVisible();

    // 5. Check focus on detail heading
    await expect(detailModal).toBeFocused();

    // 6. Close Detail Modal with Escape
    await page.keyboard.press('Escape');
    await expect(detailModal).not.toBeVisible();

    // 7. Check focus restoration to the result button
    await expect(abolethButton).toBeFocused();

    // 8. Close Oracle with Escape
    await page.keyboard.press('Escape');
    await expect(oracle).not.toBeVisible();
  });

  test('Oracle type filter moves focus correctly after type switch and updates results', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const heading = page.locator('#oracle-title');

    // --- Switch to Spells ---
    await page.selectOption('#oracle-type-filter', 'spell');

    // Heading must receive focus first (SR exits Forms Mode)
    await expect(heading).toBeFocused();

    // Then the spell search input must receive focus
    const spellSearch = page.locator('#spell-search');
    await expect(spellSearch).toBeFocused();

    // Verify search works
    await spellSearch.fill('Aid');
    const spellResults = oracle.locator('ul li button');
    await expect(spellResults.first()).toContainText('Aid');

    // --- Switch to Magic Items ---
    await page.selectOption('#oracle-type-filter', 'item');

    // Heading must receive focus first
    await expect(heading).toBeFocused();

    // Then the magic item search input must receive focus
    const magicItemSearch = page.locator('#magic-item-search');
    await expect(magicItemSearch).toBeFocused();

    // --- Switch back to Monsters ---
    await page.selectOption('#oracle-type-filter', 'monster');

    // Heading must receive focus first
    await expect(heading).toBeFocused();

    // Then the monster search input must receive focus
    const monsterSearch = page.locator('#monster-search');
    await expect(monsterSearch).toBeFocused();

    await monsterSearch.fill('Aboleth');
    const monsterResults = oracle.locator('ul li button');
    await expect(monsterResults.first()).toContainText('Aboleth');
  });
});
