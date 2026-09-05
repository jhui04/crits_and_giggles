import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'encounter-persistence-suite';
const suiteSeed = getSeedState(SUITE_ID);
const encounterId = suiteSeed.encounters[0].id;

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    if (!window.localStorage.getItem('crits_active_campaign')) {
      window.localStorage.setItem('crits_active_campaign', id);
    }
  }, SUITE_ID);
};

test.describe('Encounter State Persistence Between Browser Sessions', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    await setupApp(page);
  });

  test('Initiative setup values persist across page reloads', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: `Running: ${suiteSeed.encounters[0].name}` })).toBeVisible();
    await expect(page.getByText('Initiative Setup')).toBeVisible();

    const playerUnit = suiteSeed.encounters[0].units.find(u => u.isPlayer)!;
    const monsterUnit = suiteSeed.encounters[0].units.find(u => !u.isPlayer)!;

    const playerInput = page.getByLabel(new RegExp(playerUnit.name));
    const monsterInput = page.getByLabel(new RegExp(monsterUnit.name));

    // Fill in player initiative and wait for server persistence
    const playerSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await playerInput.fill('19');
    await playerSave;

    // Fill in monster initiative and wait for server persistence
    const monsterSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await monsterInput.fill('14');
    await monsterSave;

    // Reload page to simulate browser restart / refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Initiative Setup')).toBeVisible();
    await expect(page.getByLabel(new RegExp(playerUnit.name))).toHaveValue('19');
    await expect(page.getByLabel(new RegExp(monsterUnit.name))).toHaveValue('14');
  });

  test('Combat start, rolls, and initiative order persist across page reloads', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    // Click Start Combat and wait for persistence
    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;

    // Verify Active Combat view
    await expect(page.getByText('Initiative Track')).toBeVisible();
    await expect(page.getByLabel('Round 1')).toBeVisible();

    // Get order of combatants and first turn
    const combatantItems = page.locator('ul[role="list"] > li');
    await expect(combatantItems).toHaveCount(2);

    const firstCombatantBtn = combatantItems.first().locator('button').first();
    const secondCombatantBtn = combatantItems.nth(1).locator('button').first();

    const firstCombatantText = await firstCombatantBtn.innerText();
    const secondCombatantText = await secondCombatantBtn.innerText();

    // Verify current turn indicator is on first combatant
    await expect(firstCombatantBtn).toHaveAttribute('aria-current', 'step');

    // Check accessibility on initial active combat view
    await checkA11y(page, 'Active Combat Initial View');

    // Reload page (simulate browser session restore / reload)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Assert it immediately reopens into Active Combat, NOT Initiative Setup
    await expect(page.getByText('Initiative Track')).toBeVisible();
    await expect(page.getByText('Initiative Setup')).not.toBeVisible();
    await expect(page.getByLabel('Round 1')).toBeVisible();

    // Assert combatant order and current turn are preserved
    const reloadedItems = page.locator('ul[role="list"] > li');
    await expect(reloadedItems).toHaveCount(2);
    expect(await reloadedItems.first().locator('button').first().innerText()).toBe(firstCombatantText);
    expect(await reloadedItems.nth(1).locator('button').first().innerText()).toBe(secondCombatantText);
    await expect(reloadedItems.first().locator('button').first()).toHaveAttribute('aria-current', 'step');

    // Check accessibility on resumed active combat view
    await checkA11y(page, 'Active Combat Resumed View');
  });

  test('Turn advancement and round advancement persist across page reloads', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;

    await expect(page.getByText('Initiative Track')).toBeVisible();

    const combatantItems = page.locator('ul[role="list"] > li');

    // Advance turn to second combatant
    const turn1Save = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Next Turn (Alt+N)' }).click();
    await turn1Save;
    await expect(combatantItems.nth(1).locator('button').first()).toHaveAttribute('aria-current', 'step');

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify second combatant still has the turn
    const reloadedItems = page.locator('ul[role="list"] > li');
    await expect(reloadedItems.nth(1).locator('button').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('Round 1')).toBeVisible();

    // Advance turn again (wrap around to start Round 2)
    const turn2Save = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Next Turn (Alt+N)' }).click();
    await turn2Save;
    await expect(reloadedItems.first().locator('button').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('Round 2')).toBeVisible();

    // Reload page again
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify Round 2 and current turn are preserved
    const round2Items = page.locator('ul[role="list"] > li');
    await expect(round2Items.first().locator('button').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('Round 2')).toBeVisible();
  });

  test('Health modifications persist across page reloads', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;

    await expect(page.getByText('Initiative Track')).toBeVisible();

    // Read initial monster HP dynamically
    const monsterBtn = page.locator('ul[role="list"] button').filter({ hasText: /HP: \d+\/\d+/ });
    const initialText = await monsterBtn.innerText();
    const match = initialText.match(/HP: (\d+)\/(\d+)/);
    expect(match).not.toBeNull();
    const initialHp = parseInt(match![1], 10);
    const maxHp = match![2];

    // Open Options for the monster
    const optionsButton = page.getByRole('button', { name: 'Options' }).first();
    await optionsButton.click();

    // Choose Damage
    await page.getByRole('button', { name: 'Damage' }).click();
    await expect(page.getByLabel('Damage Amount:')).toBeFocused();

    // Apply 1 damage
    await page.getByLabel('Damage Amount:').fill('1');
    const dmgSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Apply' }).click();
    await dmgSave;

    // Verify damage applied in UI
    const expectedHpText = `HP: ${Math.max(0, initialHp - 1)}/${maxHp}`;
    await expect(page.locator('ul[role="list"] button').filter({ hasText: expectedHpText })).toBeVisible();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify HP remains damaged after reload
    await expect(page.locator('ul[role="list"] button').filter({ hasText: expectedHpText })).toBeVisible();
  });

  test('Reset Encounter clears running state and returns to setup', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;

    await expect(page.getByText('Initiative Track')).toBeVisible();

    // Click Reset Encounter and accept dialog
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    const resetSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Reset Encounter' }).click();
    await resetSave;

    // Should return to Initiative Setup
    await expect(page.getByText('Initiative Setup')).toBeVisible();
    await expect(page.getByText('Initiative Track')).not.toBeVisible();

    // Reload to verify reset is persistent
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Initiative Setup')).toBeVisible();
    await expect(page.getByText('Initiative Track')).not.toBeVisible();

    // Check accessibility of the reset view
    await checkA11y(page, 'Reset to Setup View');
  });

  test('Cross-tab encounter execution restores active state in a new tab', async ({ page, context }) => {
    // Tab 1: Start combat and advance turn
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');
    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;

    const turnSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Next Turn (Alt+N)' }).click();
    await turnSave;
    await expect(page.getByLabel('Round 1')).toBeVisible();

    // Tab 2: Open same encounter in a new browser tab
    const secondPage = await context.newPage();
    await setupApp(secondPage);
    await secondPage.goto(`/?encounter=${encounterId}`);
    await secondPage.waitForLoadState('networkidle');

    // Verify Tab 2 immediately resumes combat in the same state
    await expect(secondPage.getByText('Initiative Track')).toBeVisible();
    await expect(secondPage.getByLabel('Round 1')).toBeVisible();
    const secondPageItems = secondPage.locator('ul[role="list"] > li');
    await expect(secondPageItems.nth(1).locator('button').first()).toHaveAttribute('aria-current', 'step');

    await secondPage.close();
  });
});
