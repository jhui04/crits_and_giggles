import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

// Covers the manual-damage concentration check (DC = max(10, floor(damage/2)),
// auto-rolled CON save for monsters, appended to the SAME damage announcement)
// and the stale-undo guard, which discards (rather than applies) a manual-HP
// undo entry whose unit's HP no longer matches what the entry recorded right
// after its own change.
//
// Goblin Shaman is a custom unit (no monsterId/fullData), so its CON save
// modifier falls back to 0 (src/components/EncounterRunner.tsx: `u.fullData
// ? getSaveModifier(u.fullData, 'CON') : 0`) -- this keeps the expected d20
// total exactly equal to the stubbed natural roll, with no monster-data
// lookup required.

const SUITE_ID = 'combat-concentration-suite';
const ENCOUNTER_ID = `${SUITE_ID}-enc-1`;
const apiBase = `${process.env.TEST_API_BASE || 'http://localhost:3005'}/api`;

function makeSeed() {
  return {
    id: SUITE_ID,
    name: 'Concentration Campaign',
    description: 'Verifies the manual-damage concentration check and stale-undo guard',
    chapters: [
      { id: `${SUITE_ID}-chap-1`, title: 'Chapter 1', content: 'Hello world', order: 0 },
    ],
    assets: [],
    players: [
      { id: `${SUITE_ID}-player-1`, name: 'Grog', description: 'A test player' },
    ],
    encounters: [
      {
        id: ENCOUNTER_ID,
        name: 'Concentration Encounter',
        chapterIds: [`${SUITE_ID}-chap-1`],
        runningState: {
          isCombatStarted: true,
          round: 1,
          turnIndex: 0,
          combatants: [
            {
              instanceId: 'c-goblin-shaman-1',
              name: 'Goblin Shaman',
              currentHp: 30,
              maxHp: 30,
              tempHp: 0,
              dexMod: 0,
              initiative: 20,
              isPlayer: false,
              conditions: [{ name: 'Concentrating' }],
              position: { x: 1, y: 1 },
            },
            {
              instanceId: 'c-grog-1',
              name: 'Grog',
              currentHp: 20,
              maxHp: 20,
              tempHp: 0,
              initiative: 10,
              isPlayer: true,
              position: { x: 2, y: 1 },
            },
          ],
          combatLog: [],
        },
        units: [
          {
            instanceId: 'c-goblin-shaman-1',
            name: 'Goblin Shaman',
            currentHp: 30,
            maxHp: 30,
            tempHp: 0,
            dexMod: 0,
            initiative: 20,
            isPlayer: false,
            conditions: [{ name: 'Concentrating' }],
            position: { x: 1, y: 1 },
          },
          {
            instanceId: 'c-grog-1',
            playerId: `${SUITE_ID}-player-1`,
            name: 'Grog',
            currentHp: 20,
            maxHp: 20,
            tempHp: 0,
            dexMod: 0,
            initiative: 10,
            isPlayer: true,
            position: { x: 2, y: 1 },
          },
        ],
      },
    ],
  };
}

const setupApp = async (page: Page, fixedRandom?: number) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  if (fixedRandom !== undefined) {
    // Makes the concentration save's 1d20 roll deterministic:
    // floor(fixedRandom * 20) + 1 is the resulting natural roll.
    await page.addInitScript((r) => {
      Math.random = () => r;
    }, fixedRandom);
  }
};

const liveRegion = (page: Page) => page.locator('[aria-live="assertive"]');
const optionsButton = (page: Page) => page.getByRole('button', { name: /Goblin Shaman \(HP:/ });
const unitRowButton = (page: Page) => page.getByRole('button', { name: /Goblin Shaman \(HP:/ });

const applyDamage = async (page: Page, amount: string) => {
  await optionsButton(page).click();
  await expect(page.getByRole('heading', { name: 'Goblin Shaman Actions' })).toBeFocused();
  await page.getByRole('button', { name: 'Damage', exact: true }).click();
  await page.getByLabel('Damage Amount:').fill(amount);
  await page.getByRole('button', { name: 'Apply' }).click();
};

test.describe('Manual-damage concentration checks and stale-undo guard', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: makeSeed() });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${apiBase}/campaigns`, { data: makeSeed() });
    // Proposals staged via /api/test/stage-proposal don't expire on their own
    // (docs/HITL_WRITE_TOOLS.md §8); start each test from an empty queue.
    await request.delete(`${apiBase}/test/proposals`);
  });

  test('a maintained concentration save is appended to the same damage announcement', async ({ page }) => {
    // Natural roll 15 (floor(0.72*20)+1 = 15), CON mod 0 -> total 15.
    // Damage 10 (untyped, no resistance) -> damageTaken 10 -> DC max(10,5)=10. 15 >= 10: maintained.
    await setupApp(page, 0.72);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Concentration Encounter' })).toBeVisible();

    await applyDamage(page, '10');

    await expect(liveRegion(page)).toContainText(
      'Goblin Shaman takes 10 damage. 20 of 30 HP. Concentration save: 15 against DC 10, maintained.'
    );
    await expect(unitRowButton(page)).toContainText('Concentrating');

    await checkA11y(page, 'Combat Tracker after a maintained concentration save');
  });

  test('a failed concentration save removes Concentrating, and undo restores it', async ({ page }) => {
    // Natural roll 7 (floor(0.32*20)+1 = 7), CON mod 0 -> total 7.
    // Damage 25 -> 30 - 25 = 5 HP (bloodied, not down) -> damageTaken 25 -> DC max(10,12)=12. 7 < 12: failed.
    await setupApp(page, 0.32);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Concentration Encounter' })).toBeVisible();

    await applyDamage(page, '25');

    await expect(liveRegion(page)).toContainText(
      'Goblin Shaman takes 25 damage. 5 of 30 HP. Goblin Shaman is bloodied. ' +
      'Concentration save: 7 against DC 12, failed. Goblin Shaman is no longer concentrating.'
    );
    await expect(unitRowButton(page)).not.toContainText('Concentrating');

    await checkA11y(page, 'Combat Tracker after a failed concentration save');

    // Undo restores both the HP and the Concentrating condition it had before
    // the damage (the undo announcement wording itself is unchanged).
    const undoButton = page.getByRole('button', { name: /^Undo: 25 damage to Goblin Shaman/ });
    await undoButton.click();

    await expect(liveRegion(page)).toContainText('Undid 25 damage to Goblin Shaman. 30 of 30 HP.');
    await expect(unitRowButton(page)).toContainText('Concentrating');
    await expect(unitRowButton(page)).toContainText('HP: 30/30');
  });

  test('dropping to 0 HP skips the roll and ends concentration automatically', async ({ page }) => {
    await setupApp(page);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Concentration Encounter' })).toBeVisible();

    await applyDamage(page, '30');

    await expect(liveRegion(page)).toContainText(
      'Goblin Shaman takes 30 damage. 0 of 30 HP. Goblin Shaman is down. Concentration ends.'
    );
    await expect(unitRowButton(page)).not.toContainText('Concentrating');

    await checkA11y(page, 'Combat Tracker after dropping to 0 HP while concentrating');
  });

  test("undo is refused and the entry discarded once the unit's HP changed via another path (HITL-approved damage)", async ({ page, request }) => {
    await setupApp(page);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Concentration Encounter' })).toBeVisible();

    // Manual damage builds an undo entry recording 30 -> 20 HP for Goblin Shaman.
    await applyDamage(page, '10');
    await expect(unitRowButton(page)).toContainText('HP: 20/30');
    const undoButton = page.getByRole('button', { name: /^Undo: 10 damage to Goblin Shaman/ });
    await expect(undoButton).toBeVisible();

    // Now simulate the DM approving an Assistant Oracle HITL damage proposal
    // against the SAME combatant -- a second, independent path that mutates
    // this unit's HP directly on the server (server/assistant/toolController.js's
    // executeMutation), exactly as tests/encounter-runner-save-race.spec.ts's
    // "genuine external update" test does. EncounterRunner's own reload effect
    // picks this up live, without a page reload, so the in-memory undo stack
    // (which a reload would otherwise wipe) survives to be tested as stale.
    const stageRes = await request.post(`${apiBase}/test/stage-proposal`, {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [{ combatantName: 'Goblin Shaman', amount: 8, actionType: 'damage' }],
          encounterId: ENCOUNTER_ID,
        },
        context: { campaignId: SUITE_ID, encounterId: ENCOUNTER_ID },
      },
    });
    expect(stageRes.ok()).toBe(true);
    const stagedData = await stageRes.json();
    expect(stagedData.proposal).toBeDefined();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Proposing 8 damage to the Goblin Shaman.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const assistantDialog = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(assistantDialog).toBeVisible();

    const confirmBox = assistantDialog.locator('[data-testid="hitl-confirmation-box"]');
    await page.locator('#assistant-oracle-input').fill('Apply 8 damage to the goblin shaman');
    await assistantDialog.getByRole('button', { name: 'Ask' }).click();
    await expect(confirmBox).toBeVisible();

    await confirmBox.getByRole('button', { name: /Approve/i }).click();
    await expect(confirmBox).not.toBeVisible();

    await page.keyboard.press('Escape');
    await expect(assistantDialog).not.toBeVisible();

    // Picked up live: 20 -> 12 HP, via the HITL path rather than the manual one.
    await expect(unitRowButton(page)).toContainText('HP: 12/30');

    // The undo button (still describing the now-stale manual entry, 30 -> 20)
    // is pressed; it must discard the entry rather than clobbering the HP the
    // HITL approval just set.
    await undoButton.click();

    await expect(liveRegion(page)).toContainText("Can't undo: Goblin Shaman's hit points changed since then.");
    await expect(unitRowButton(page)).toContainText('HP: 12/30');
    await expect(page.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);
  });
});
