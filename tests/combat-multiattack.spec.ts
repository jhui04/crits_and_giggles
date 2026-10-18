import { test, expect, type Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

// Multiattack in Run Mode: the Actions view of a combatant's Options dialog has
// one Multiattack button naming the parsed options. One option rolls directly;
// several open an options list. Every constituent attack goes through the
// existing dice machinery, is dice-logged, and the result lists one item per attack.
//
// Bandit Captain (id 16799): "three melee attacks: two with its scimitar and
// one with its dagger. Or ... two ranged attacks with its daggers." (2 options)
// Dragon Turtle (id 16845): "three attacks: one with its bite and two with its
// claws. It can make one tail attack in place of its two claw attacks." (1 option)

const SUITE_ID = 'multiattack-suite';
const ENCOUNTER_ID = `${SUITE_ID}-enc-1`;
const apiBase = `${process.env.TEST_API_BASE || 'http://localhost:3005'}/api`;

const unit = (instanceId: string, monsterId: string, name: string, initiative: number, x: number) => ({
  instanceId, monsterId, name, currentHp: 40, maxHp: 40, tempHp: 0, dexMod: 0, initiative, isPlayer: false, position: { x, y: 1 },
});
const units = [unit('c-captain-1', '16799', 'Bandit Captain', 20, 1), unit('c-turtle-1', '16845', 'Dragon Turtle', 10, 2)];

const seed = {
  id: SUITE_ID,
  name: 'Multiattack Campaign',
  description: 'Verifies Multiattack option parsing and rolling',
  chapters: [{ id: `${SUITE_ID}-chap-1`, title: 'Chapter 1', content: 'Hello world', order: 0 }],
  assets: [],
  players: [],
  encounters: [
    {
      id: ENCOUNTER_ID,
      name: 'Multiattack Encounter',
      chapterIds: [`${SUITE_ID}-chap-1`],
      runningState: { isCombatStarted: true, round: 1, turnIndex: 0, combatants: units, combatLog: [] },
      units,
    },
  ],
};

const rowButton = (page: Page, name: string) => page.getByRole('button', { name: `${name} (HP:` });

async function openActions(page: Page, name: string) {
  await rowButton(page, name).click();
  await expect(page.getByRole('heading', { name: `${name} Actions` })).toBeFocused();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
}

test.describe('Multiattack actions', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: seed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    await request.post(`${apiBase}/campaigns`, { data: seed });
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Multiattack Encounter' })).toBeVisible();
  });

  test('a single-option Multiattack is one button that rolls directly and lists each attack', async ({ page }) => {
    await openActions(page, 'Dragon Turtle');
    // One button in the actions list; no raw text, picker or Roll button.
    const multiButton = page.getByRole('button', { name: 'Multiattack: Bite x1 and Claw x2' });
    await expect(multiButton).toBeFocused();
    await expect(page.getByRole('button', { name: /^Roll / })).toHaveCount(0);
    await expect(page.getByText('three attacks')).toHaveCount(0);
    await checkA11y(page, 'Multiattack single option');

    await multiButton.click();
    const result = page.getByRole('dialog', { name: /Dragon Turtle - Multiattack/ });
    await expect(result).toBeVisible();
    await expect(page.locator('[aria-live="assertive"]')).toContainText(/Dragon Turtle rolled Multiattack \(Bite x1, Claw x2\): Bite: .*; Claw: .*; Claw: /);
    // The result: a summary line and one list item per attack.
    await expect(result).toContainText('3 attacks rolled');
    const items = result.getByRole('list', { name: 'Attacks' }).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText(/^Bite: .* to hit, .* damage$/);
    await expect(items.nth(1)).toHaveText(/^Claw: .* to hit, .* damage$/);
    await checkA11y(page, 'Multiattack result');
    // Closing the result closes the Options dialog too (existing behaviour); focus returns to the row.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Dragon Turtle Actions' })).not.toBeVisible();
    await expect(rowButton(page, 'Dragon Turtle')).toBeFocused();
  });

  test('a multi-option Multiattack opens its options, rolls the chosen one, logs the dice, and restores focus', async ({ page }) => {
    await openActions(page, 'Bandit Captain');
    const multiButton = page.getByRole('button', { name: 'Multiattack: Scimitar x2 and Dagger x1, or Dagger x2' });
    await expect(multiButton).toBeFocused();
    await multiButton.click();

    // Options view: heading focused, raw text reachable, one button per option, no Roll button.
    const heading = page.getByRole('heading', { name: 'Multiattack Options' });
    await expect(heading).toBeFocused();
    await expect(page.getByText(/three melee attacks/)).toBeVisible();
    await checkA11y(page, 'Multiattack options');

    // Back restores focus to the Multiattack button.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(multiButton).toBeFocused();
    await multiButton.click();

    const options = page.getByRole('list', { name: 'Multiattack options' });
    await expect(options.getByRole('button')).toHaveCount(2);
    await options.getByRole('button', { name: 'Dagger x2' }).click();

    const result = page.getByRole('dialog', { name: /Bandit Captain - Multiattack \(Dagger x2\)/ });
    await expect(result).toBeVisible();
    await expect(page.locator('[aria-live="assertive"]')).toContainText(/Bandit Captain rolled Multiattack \(Dagger x2\): Dagger: .* to hit.*; Dagger: .* to hit/);
    await expect(result.getByRole('list', { name: 'Attacks' }).getByRole('listitem')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Bandit Captain Actions' })).not.toBeVisible();
    await expect(rowButton(page, 'Bandit Captain')).toBeFocused();

    // Both daggers rolled to hit and for damage in the dice log.
    await page.keyboard.press('Alt+d');
    const log = page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
    await expect(log).toBeVisible();
    const list = log.locator('ul[aria-label="Dice rolls"]');
    await expect(list.locator('li', { hasText: 'Dagger (Attack to hit)' })).toHaveCount(2);
    await expect(list.locator('li', { hasText: 'Dagger (piercing damage)' })).toHaveCount(2);
    await page.keyboard.press('Escape');
  });
});
