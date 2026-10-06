import { test, expect, type Page } from '@playwright/test';
import { getSeedState } from './seed-data';
import { checkA11y } from './utils/axe-helper';
import { chooseDisclosureOption } from './utils/disclosure-select-helper';

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

  test('Search Type change keeps focus on the Search Type button and updates results', async ({ page }) => {
    await openOracle(page);
    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const typeButton = page.locator('#oracle-type-filter');

    // --- Switch to Spells ---
    await chooseDisclosureOption(page, typeButton, 'Spells');
    await expect(typeButton).toHaveAccessibleName('Search Type: Spells');
    const spellSearch = page.locator('#spell-search');
    await expect(spellSearch).toBeVisible();
    // Focus must not jump to the search field after a type change.
    await page.waitForTimeout(300);
    await expect(typeButton).toBeFocused();

    // Tab moves on to the spell search field; search works.
    await page.keyboard.press('Tab');
    await expect(spellSearch).toBeFocused();
    await spellSearch.fill('Aid');
    await expect(oracle.locator('ul li button').first()).toContainText('Aid');

    // --- Switch to Magic Items ---
    await chooseDisclosureOption(page, typeButton, 'Magic Items');
    await expect(typeButton).toHaveAccessibleName('Search Type: Magic Items');
    await expect(page.locator('#magic-item-search')).toBeVisible();

    // --- Switch back to Monsters ---
    await chooseDisclosureOption(page, typeButton, 'Monsters');
    await expect(typeButton).toHaveAccessibleName('Search Type: Monsters');
    const monsterSearch = page.locator('#monster-search');
    await expect(monsterSearch).toBeVisible();
    await page.waitForTimeout(300);
    await expect(typeButton).toBeFocused();

    await monsterSearch.fill('Aboleth');
    await expect(oracle.locator('ul li button').first()).toContainText('Aboleth');
  });

  test('Search Type follows the disclosure pattern', async ({ page }) => {
    await openOracle(page);
    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const typeButton = page.locator('#oracle-type-filter');
    const list = page.locator('ul[aria-label="Search Type"]');
    const option = (name: string) => list.getByRole('button', { name, exact: true });
    // A disclosure: no menu, listbox, combobox or radio roles anywhere in the Oracle.
    const forbiddenRoles = oracle.locator(
      '[role="menu"], [role="menubar"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], ' +
      '[role="listbox"], [role="option"], [role="combobox"], [role="radio"], [role="radiogroup"]',
    );

    // Closed: one button whose name holds the label and value once each.
    await expect(typeButton).toHaveRole('button');
    await expect(typeButton).toHaveAccessibleName('Search Type: Monsters');
    // No aria-haspopup: JAWS keeps forms mode on such buttons.
    await expect(typeButton).not.toHaveAttribute('aria-haspopup');
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toHaveCount(0);
    await expect(forbiddenRoles).toHaveCount(0);
    // No separate label element for the control.
    await expect(page.locator('label[for="oracle-type-filter"]')).toHaveCount(0);
    await checkA11y(page, 'Oracle Search Type disclosure (closed)');

    // Enter opens the list with focus on the pressed option.
    await typeButton.focus();
    await page.keyboard.press('Enter');
    await expect(list).toBeVisible();
    await expect(typeButton).toHaveAttribute('aria-expanded', 'true');
    await expect(typeButton).not.toHaveAttribute('aria-haspopup');
    await expect(typeButton).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? '');
    // The list is the very next element after the button, so a screen
    // reader's virtual cursor reaches it with one Down Arrow.
    const nextSiblingId = await typeButton.evaluate((el) => el.nextElementSibling?.id ?? null);
    expect(nextSiblingId).toBe(await list.getAttribute('id'));
    await expect(forbiddenRoles).toHaveCount(0);

    const options = list.locator('li > button');
    const names = ['Monsters', 'Spells', 'Magic Items', 'World Assets'];
    await expect(options).toHaveCount(names.length);
    for (const [i, name] of names.entries()) {
      await expect(options.nth(i)).toHaveRole('button');
      await expect(options.nth(i)).toHaveAccessibleName(name);
      await expect(options.nth(i)).toHaveAttribute('aria-pressed', /^(true|false)$/);
    }
    await expect(list.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(option('Monsters')).toHaveAttribute('aria-pressed', 'true');
    await expect(option('Monsters')).toBeFocused();

    await checkA11y(page, 'Oracle Search Type disclosure (open)');

    // While open, everything outside the control is inert, so a screen
    // reader's browse-mode Down Arrow stops at the last option instead of
    // reading on into the page.
    expect(await page.locator('#oracle-title').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
    expect(await page.locator('#monster-search').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
    expect(await typeButton.evaluate((el) => !!el.closest('[inert]'))).toBe(false);
    expect(await list.evaluate((el) => !!el.closest('[inert]'))).toBe(false);

    // Arrows wrap; Home/End.
    await page.keyboard.press('ArrowUp');
    await expect(option('World Assets')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(option('Monsters')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(option('Spells')).toBeFocused();
    await page.keyboard.press('End');
    await expect(option('World Assets')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(option('Monsters')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(option('Spells')).toBeFocused();

    // Escape closes without a change, focus back on the button, and the
    // Oracle dialog itself stays open.
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');
    await expect(typeButton).toHaveAccessibleName('Search Type: Monsters');
    await expect(oracle).toBeVisible();
    // Closing lifts the inert.
    await expect(oracle.locator('[inert]')).toHaveCount(0);

    // Escape on the toggle while open closes the list, not the Oracle.
    await page.keyboard.press('Enter');
    await expect(option('Monsters')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(typeButton).toBeFocused();
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(oracle).toBeVisible();

    // Space opens; Space chooses.
    await page.keyboard.press(' ');
    await expect(option('Monsters')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(typeButton).toHaveAccessibleName('Search Type: Spells');
    // Space's keyup on the toggle must not reopen the list.
    await page.waitForTimeout(200);
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');

    // The list opens on the new pressed option.
    await page.keyboard.press('Enter');
    await expect(option('Spells')).toBeFocused();
    await expect(option('Spells')).toHaveAttribute('aria-pressed', 'true');
    await expect(option('Monsters')).toHaveAttribute('aria-pressed', 'false');

    // Tab and Shift+Tab move natively between the option buttons.
    await page.keyboard.press('Tab');
    await expect(option('Magic Items')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(option('Spells')).toBeFocused();

    // Tab out of the last option closes the list and moves on.
    await page.keyboard.press('End');
    await expect(option('World Assets')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#spell-search')).toBeFocused();
    await expect(typeButton).toHaveAccessibleName('Search Type: Spells');

    // Shift+Tab from the first option reaches the toggle (the list stays
    // open: focus is still inside the control); Shift+Tab again leaves the
    // control and closes the list.
    await typeButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
    await expect(option('Monsters')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(typeButton).toBeFocused();
    await expect(list).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(typeButton).not.toBeFocused();
    await expect(list).toHaveCount(0);
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');

    // Mouse: click opens, click an option chooses.
    await typeButton.click();
    await expect(list).toBeVisible();
    await option('Magic Items').click();
    await expect(list).toHaveCount(0);
    await expect(typeButton).toHaveAccessibleName('Search Type: Magic Items');
    await expect(typeButton).toBeFocused();
    await expect(page.locator('#magic-item-search')).toBeVisible();

    // Mouse: clicking the toggle again closes; clicking outside closes.
    await typeButton.click();
    await expect(list).toBeVisible();
    await typeButton.click();
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await typeButton.click();
    await expect(list).toBeVisible();
    // The heading is inert while the list is open, so click its spot directly.
    const titleBox = await page.locator('#oracle-title').boundingBox();
    await page.mouse.click(titleBox!.x + 5, titleBox!.y + 5);
    await expect(list).toHaveCount(0);
    await expect(oracle.locator('[inert]')).toHaveCount(0);
    await expect(typeButton).toHaveAccessibleName('Search Type: Magic Items');

    // Closing the Oracle with Escape still works afterwards.
    await typeButton.focus();
    await page.keyboard.press('Escape');
    await expect(oracle).toBeHidden();
  });
});

test.describe('Oracle browse pages share one structure', () => {
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

  const PAGES = [
    { type: 'Monsters', searchId: 'monster-search', noun: 'monster' },
    { type: 'Spells', searchId: 'spell-search', noun: 'spell' },
    { type: 'Magic Items', searchId: 'magic-item-search', noun: 'magic item' },
    { type: 'World Assets', searchId: 'world-asset-search', noun: 'world asset' },
  ];

  for (const { type, searchId, noun } of PAGES) {
    test(`${type}: search landmark, Results heading, count, one button per result, details and filters dialogs`, async ({ page }) => {
      await openOracle(page);
      const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
      if (type !== 'Monsters') await chooseDisclosureOption(page, page.locator('#oracle-type-filter'), type);

      // One search landmark holding the labelled field and the Filters button.
      const search = oracle.getByRole('search');
      await expect(search).toHaveCount(1);
      const field = search.getByRole('textbox', { name: `Search ${type}`, exact: true });
      await expect(field).toHaveAttribute('id', searchId);
      await expect(field).not.toHaveAttribute('placeholder');
      const filtersButton = search.getByRole('button', { name: 'Filters', exact: true });
      await expect(filtersButton).toBeVisible();
      // No other landmarks or headings beyond the Oracle's own and "Results".
      await expect(oracle.locator('section, [role="region"]')).toHaveCount(0);
      await expect(oracle.getByRole('heading', { level: 3 })).toHaveText([/^Results(, page 1 of \d+)?$/]);

      // The count is a status line with a consistent wording.
      const status = oracle.getByRole('status');
      await expect(status).toHaveText(new RegExp(`^\\d+ ${noun}s? found\\.$`));
      // No more than one page of results is listed.
      expect(await oracle.locator('ul.oracle-results > li').count()).toBeLessThanOrEqual(100);
      const results = oracle.locator('ul.oracle-results > li > button');
      await expect(results.first()).toBeVisible();
      await checkA11y(page, `Oracle ${type} page`);

      // A result is one button; its details dialog focuses its heading and returns focus on Escape.
      const first = results.first();
      const name = (await first.locator('.oracle-result-name').textContent()) ?? '';
      const accessibleName = await first.evaluate((el) => el.textContent ?? '');
      expect(accessibleName === name || accessibleName.startsWith(`${name}, `), `result name: ${accessibleName}`).toBe(true);
      await first.click();
      const details = page.locator('[role="dialog"][aria-labelledby="details-title"]');
      await expect(details).toBeVisible();
      await expect(page.locator('#details-title')).toBeFocused();
      await expect(page.locator('#details-title')).toHaveText(name);
      await expect(details.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
      await checkA11y(page, `Oracle ${type} details`);
      await page.keyboard.press('Escape');
      await expect(details).toHaveCount(0);
      await expect(first).toBeFocused();
      await expect(oracle).toBeVisible();

      // Filters: heading first, collapsed groups, Apply Filters; the button reports active filters.
      await filtersButton.click();
      const filters = page.locator('[role="dialog"][aria-labelledby="filters-title"]');
      await expect(page.locator('#filters-title')).toBeFocused();
      await expect(filters.locator('details:not([open]) > summary').first()).toBeVisible();
      await filters.locator('summary').first().click();
      await filters.locator('input[type="checkbox"]').first().check();
      await expect(filters.locator('summary').first()).toContainText('(1 selected)');
      await filters.getByRole('button', { name: 'Apply Filters' }).click();
      await expect(filters).toHaveCount(0);
      await expect(search.getByRole('button', { name: 'Filters (1 active)', exact: true })).toBeFocused();

      // The Escape inside a dialog closes only that dialog.
      await search.getByRole('button', { name: 'Filters (1 active)' }).click();
      await page.keyboard.press('Escape');
      await expect(filters).toHaveCount(0);
      await expect(oracle).toBeVisible();
    });
  }
});

test.describe('Oracle results are paged', () => {
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

  test('Every monster is reachable a page at a time; turning a page focuses the Results heading', async ({ page }) => {
    await openOracle(page);
    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const heading = oracle.getByRole('heading', { level: 3, name: /^Results/ });
    const results = oracle.locator('ul.oracle-results > li > button');
    const previous = oracle.getByRole('button', { name: 'Previous page', exact: true });
    const next = oracle.getByRole('button', { name: 'Next page', exact: true });
    const status = oracle.getByRole('status');

    const total = Number((await status.textContent())?.match(/^(\d+) monsters found\.$/)?.[1]);
    expect(total, 'the monster list must span several pages').toBeGreaterThan(200);
    const pages = Math.ceil(total / 100);

    // Page 1: 100 results, the heading names the page, only Next page.
    await expect(heading).toHaveText(`Results, page 1 of ${pages}`);
    await expect(results).toHaveCount(100);
    await expect(previous).toHaveCount(0);
    // Page buttons sit both above the list (right after the count) and below it.
    await expect(next).toHaveCount(2);
    const list = oracle.locator('ul.oracle-results');
    expect(await next.first().evaluate((btn, ul) => !!(btn.compareDocumentPosition(ul!) & Node.DOCUMENT_POSITION_FOLLOWING), await list.elementHandle())).toBe(true);
    expect(await next.last().evaluate((btn, ul) => !!(btn.compareDocumentPosition(ul!) & Node.DOCUMENT_POSITION_PRECEDING), await list.elementHandle())).toBe(true);
    const firstOnPage1 = (await results.first().textContent()) ?? '';

    // Next page (the bottom one): focus on the heading, new results, the count line unchanged.
    await next.last().focus();
    await page.keyboard.press('Enter');
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(`Results, page 2 of ${pages}`);
    await expect(results.first()).not.toHaveText(firstOnPage1);
    await expect(status).toHaveText(`${total} monsters found.`);
    await expect(previous).toHaveCount(2);
    await checkA11y(page, 'Oracle results page 2');

    // A result's details dialog returns focus to it, still on the same page.
    const secondPageResult = results.nth(3);
    await secondPageResult.click();
    await expect(page.locator('#details-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(secondPageResult).toBeFocused();
    await expect(heading).toHaveText(`Results, page 2 of ${pages}`);

    // Previous page (the top one) goes back.
    await previous.first().click();
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(`Results, page 1 of ${pages}`);
    await expect(results.first()).toHaveText(firstOnPage1);

    // The last page has only Previous page and holds the remainder.
    for (let p = 1; p < pages; p++) await next.first().click();
    await expect(heading).toHaveText(`Results, page ${pages} of ${pages}`);
    await expect(next).toHaveCount(0);
    await expect(results).toHaveCount(total - (pages - 1) * 100);

    // A new search returns to page 1; a single page has no page buttons.
    await page.locator('#monster-search').fill('Aboleth');
    await expect(heading).toHaveText('Results');
    await expect(previous).toHaveCount(0);
    await expect(next).toHaveCount(0);
  });

  test('Spells use the same pager', async ({ page }) => {
    await openOracle(page);
    await chooseDisclosureOption(page, page.locator('#oracle-type-filter'), 'Spells');
    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    const heading = oracle.getByRole('heading', { level: 3, name: /^Results/ });
    await expect(heading).toHaveText(/^Results, page 1 of \d+$/);
    await expect(oracle.locator('ul.oracle-results > li')).toHaveCount(100);
    await oracle.getByRole('button', { name: 'Next page', exact: true }).first().click();
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(/^Results, page 2 of \d+$/);
  });
});

async function openOracle(page: Page) {
  await page.click('button[aria-label="Open Main Menu"]');
  await page.click('button:has-text("The Oracle")');
  await expect(page.locator('[role="dialog"][aria-labelledby="oracle-title"]')).toBeVisible();
  // The Oracle opens with focus in the monster search field; wait for it so
  // the later steps do not race that initial focus move.
  await expect(page.locator('#monster-search')).toBeFocused();
}
