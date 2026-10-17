import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
import { getSeedState } from './seed-data';
import fs from 'fs';
import path from 'path';

const monstersData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/monsters.json'), 'utf-8'));
const mockMonster = monstersData[0];

/*
 * Regression coverage for the "aria-modal does not trap Tab" bug: several
 * role="dialog" modals had no manual focus trap (useFocusTrap), so Tab could
 * carry keyboard/screen-reader focus out into the page behind the dialog.
 * These tests drive Tab well past the last control in a handful of the
 * fixed dialogs and assert focus never leaves the dialog's DOM subtree.
 */

const SUITE_ID = 'modal-focus-trap-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
  await expect(page.locator('header')).toContainText(`Campaign: ${suiteSeed.name}`);
};

/** Tabs forward `times` times, then asserts focus is still inside `dialog`. */
const assertTabStaysTrapped = async (page: Page, dialog: Locator, times = 20) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press('Tab');
  }
  const stillInside = await dialog.evaluate((el) => el.contains(document.activeElement));
  expect(stillInside).toBe(true);

  // Same check in reverse (Shift+Tab), to catch a trap that only guards one direction.
  for (let i = 0; i < times; i++) {
    await page.keyboard.press('Shift+Tab');
  }
  const stillInsideReverse = await dialog.evaluate((el) => el.contains(document.activeElement));
  expect(stillInsideReverse).toBe(true);
};

test.describe('Modal Tab focus trapping', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Main Menu modal traps Tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="main-menu-title"]');
    await expect(dialog).toBeVisible();
    await assertTabStaysTrapped(page, dialog);
  });

  test('Switch Campaign modal traps Tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: /Switch Campaign/ }).click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="switch-camp-title"]');
    await expect(dialog).toBeVisible();
    await assertTabStaysTrapped(page, dialog);
  });

  test('Campaign Builder Player Form modal traps Tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Campaign Settings' }).click();
    const campaignDialog = page.locator('[role="dialog"][aria-labelledby="campaign-modal-title"]');
    await expect(campaignDialog).toBeVisible();
    // The Campaign Settings modal itself should also trap Tab.
    await assertTabStaysTrapped(page, campaignDialog);

    await page.getByRole('button', { name: '+ Add Player' }).click();
    const playerDialog = page.locator('[role="dialog"][aria-labelledby="player-modal-title"]');
    await expect(playerDialog).toBeVisible();
    await assertTabStaysTrapped(page, playerDialog);
  });

  const setupEncounterPage = async (page: Page, context: BrowserContext) => {
    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Test Encounter/ }).click()
    ]);
    await encounterPage.waitForLoadState();
    return encounterPage;
  };

  test('QuickRoller "Skill Check" modal traps Tab', async ({ page, context }) => {
    await page.keyboard.press('Alt+m');
    const encounterPage = await setupEncounterPage(page, context);
    await encounterPage.getByRole('button', { name: 'Start Combat' }).click();

    // Open a combatant's details, which hosts the QuickRoller "Skill Check" trigger.
    await encounterPage.getByRole('button', { name: new RegExp(mockMonster.name) }).first().click();
    await expect(encounterPage.locator('h2, h3').filter({ hasText: mockMonster.name }).first()).toBeVisible();

    await encounterPage.getByRole('button', { name: 'Skill Check' }).click();
    const quickRollerDialog = encounterPage.locator('[role="dialog"][aria-labelledby="quick-roller-title"]');
    await expect(quickRollerDialog).toBeVisible();
    await assertTabStaysTrapped(encounterPage, quickRollerDialog);

    await encounterPage.close();
  });
});
