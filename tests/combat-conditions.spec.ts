import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'combat-conditions-suite';
const suiteSeed = getSeedState(SUITE_ID);
const encounterId = suiteSeed.encounters[0].id;
const playerUnit = suiteSeed.encounters[0].units.find(u => u.isPlayer)!;
const monsterUnit = suiteSeed.encounters[0].units.find(u => !u.isPlayer)!;

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
};

test.describe('Combat Conditions Tracker', () => {
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

  test('set conditions on a combatant, advance turns, verify expiry announcement, and persist across reload', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await page.waitForLoadState('networkidle');

    const startSave = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await startSave;
    await expect(page.getByText('Initiative Track')).toBeVisible();

    // Player (initiative 18) goes first, ahead of the monster (initiative 15).
    const playerItem = page.locator('li', { hasText: playerUnit.name });
    const conditionsTrigger = playerItem.getByRole('button', { name: /^Conditions/ });
    await conditionsTrigger.click();

    const heading = page.getByRole('heading', { name: `Conditions for ${playerUnit.name}` });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await checkA11y(page, 'Conditions Modal');

    // Apply Prone first with the shared duration field left blank, so it's indefinite.
    await page.getByRole('checkbox', { name: 'Prone' }).check();
    const saveResp1 = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Save' }).click();
    await saveResp1;

    // Focus restored to the trigger that opened the modal.
    await expect(conditionsTrigger).toBeFocused();

    const liveRegion = page.locator('div[aria-live="assertive"]');
    await expect(liveRegion).toContainText(`${playerUnit.name} is now Prone.`);
    await expect(playerItem).toContainText('Prone');

    // Reopen and add Poisoned for 1 round. Prone (already applied, pre-existing) keeps
    // its own indefinite duration; the shared duration field only affects the newly
    // checked Poisoned.
    await conditionsTrigger.click();
    await expect(page.getByRole('heading', { name: `Conditions for ${playerUnit.name}` })).toBeFocused();
    await page.getByRole('checkbox', { name: 'Poisoned' }).check();
    await page.getByLabel(/Duration in rounds/).fill('1');
    const saveResp2 = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Save' }).click();
    await saveResp2;
    await expect(conditionsTrigger).toBeFocused();

    // Announcement reflects both conditions with Poisoned's own 1-round duration and Prone
    // indefinite. Prone was applied first (in the earlier save) so it's listed first.
    await expect(liveRegion).toContainText(`${playerUnit.name} is now Prone, Poisoned (1 round).`);

    // Initiative list text includes the conditions for screen-reader browse mode.
    await expect(playerItem).toContainText('Poisoned (1 round)');
    await expect(playerItem).toContainText('Prone');

    // Advance turn: outgoing player's Poisoned (1 round) ends; Prone (indefinite) remains.
    const turn1Save = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Next Turn (Alt+N)' }).click();
    await turn1Save;
    await expect(liveRegion).toContainText(`${playerUnit.name}'s Poisoned has ended.`);
    await expect(liveRegion).toContainText(`Current turn: ${monsterUnit.name}.`);

    // Advance again: wraps to round 2, current turn is back to the player, still Prone.
    const turn2Save = page.waitForResponse(resp => resp.url().includes('/api/campaigns') && resp.status() === 200);
    await page.getByRole('button', { name: 'Next Turn (Alt+N)' }).click();
    await turn2Save;
    await expect(liveRegion).toContainText(`Current turn: ${playerUnit.name}, Prone.`);
    await expect(page.getByLabel('Round 2')).toBeVisible();

    // Reload and confirm the surviving condition persisted server-side.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Round 2')).toBeVisible();
    const reloadedPlayerItem = page.locator('li', { hasText: playerUnit.name });
    await expect(reloadedPlayerItem).toContainText('Prone');
    await expect(reloadedPlayerItem).not.toContainText('Poisoned');
  });
});
