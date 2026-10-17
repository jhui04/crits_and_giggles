import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';
import { chooseDisclosureAction, chooseDisclosureOption } from './utils/disclosure-select-helper';

const SUITE_ID = 'campaign-settings-switching-suite';
const OTHER_ID = 'campaign-settings-switching-other';
const suiteSeed = getSeedState(SUITE_ID);
const otherSeed = { ...getSeedState(OTHER_ID), name: 'Switch Target Campaign', players: [] };

test.describe('Campaign Settings: switching, deleting, and empty lists', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    for (const seed of [{ ...suiteSeed, players: [] }, otherSeed]) {
      const res = await request.post(`${apiBase}/campaigns`, { data: seed });
      if (!res.ok()) throw new Error(`Failed to seed: ${res.status()}`);
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto('/');
    await page.waitForSelector('header');
  });

  test('main menu puts the mode switch above Campaign Settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    const names = await page.locator('[role="dialog"][aria-labelledby="main-menu-title"] button').allInnerTexts();
    const modeIdx = names.findIndex(n => /Switch to (Run|Create) Mode/.test(n));
    const settingsIdx = names.findIndex(n => /Campaign Settings/.test(n));
    expect(modeIdx).toBeGreaterThan(-1);
    expect(modeIdx).toBeLessThan(settingsIdx);
    await expect(page.getByRole('button', { name: /Switch Campaign/ })).toHaveCount(0);
  });

  test('no players means no list element at all', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Campaign Settings' }).click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="campaign-modal-title"]');
    await expect(dialog.getByRole('button', { name: '+ Add Player' })).toBeVisible();
    await expect(dialog.locator('ul, ol')).toHaveCount(0);
    await expect(dialog).not.toContainText('No players configured');
    await checkA11y(page, 'Campaign Settings without players');
  });

  test('campaign select switches campaign and only opens New Campaign when chosen', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Campaign Settings' }).click();
    const picker = page.locator('#camp-switcher');
    await expect(picker).toHaveAccessibleName(/^Campaign: /);
    await chooseDisclosureOption(page, picker, suiteSeed.name);
    await chooseDisclosureOption(page, picker, 'Switch Target Campaign');
    await expect(page.locator('header')).toContainText('Campaign: Switch Target Campaign');
    await chooseDisclosureOption(page, picker, suiteSeed.name);
    await expect(page.locator('header')).toContainText(`Campaign: ${suiteSeed.name}`);

    await chooseDisclosureAction(page, picker, 'Add new campaign...', async () => {
      await expect(page.getByRole('heading', { name: 'New Campaign' })).toHaveCount(0);
    });
    await expect(page.getByRole('heading', { name: 'New Campaign' })).toBeVisible();
  });

  test('Delete Campaign asks for confirmation and removes the campaign', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Campaign Settings' }).click();
    await chooseDisclosureOption(page, page.locator('#camp-switcher'), 'Switch Target Campaign');

    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', { name: 'Delete Campaign' }).click();
    await expect(page.locator('header')).toContainText('Campaign: Switch Target Campaign');

    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Delete Campaign' }).click();
    await expect(page.locator('header')).not.toContainText('Switch Target Campaign');
    await expect(page.locator('#campaign-modal-title')).not.toBeVisible();
  });

  test('empty chapter and campaign lists are not rendered as lists', async ({ page }) => {
    const empty = { ...getSeedState('campaign-settings-switching-empty'), name: 'Empty Lists Campaign', players: [], assets: [], encounters: [] };
    const res = await page.request.post('http://localhost:3005/api/campaigns', { data: empty });
    expect(res.ok()).toBeTruthy();
    await page.addInitScript(() => window.localStorage.setItem('crits_active_campaign', 'campaign-settings-switching-empty'));
    await page.goto('/');
    await expect(page.locator('header')).toContainText('Empty Lists Campaign');
    const main = page.locator('main, .layout-create').first();
    await expect(main.getByRole('button', { name: '+ Add Asset' })).toBeVisible();
    await expect(main.getByRole('list')).toHaveCount(0);
    await expect(main).not.toContainText(/No (assets|encounters)/);
  });
});
