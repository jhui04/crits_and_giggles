import { test, expect, Page } from '@playwright/test';

// Regression coverage for the Alt+A / Alt+D / Alt+N collisions between App.tsx's
// global window keydown listener, AssistantOracleModal.tsx's own window keydown
// listener, and EncounterRunner.tsx's own window keydown listener on the encounter
// tab (?encounter=<id>). All three register independent `window.addEventListener
// ('keydown', ...)` handlers; `e.stopPropagation()` in one does not stop the
// others, and registration order is not guaranteed. See tests/modal-accessibility
// .spec.ts and tests/assistant-context-accessibility.spec.ts for the base patterns
// this follows.

const SUITE_ID = 'shortcut-collision-suite';
const ENCOUNTER_ID = `${SUITE_ID}-enc-1`;

const collisionSeed = {
  id: SUITE_ID,
  name: 'Shortcut Collision Campaign',
  description: 'Verifies Alt+A / Alt+D / Alt+N do not collide across EncounterRunner and the App-level overlays',
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
      name: 'Collision Test Encounter',
      chapterIds: [`${SUITE_ID}-chap-1`],
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            instanceId: 'c-grog-1',
            name: 'Grog',
            currentHp: 20,
            maxHp: 20,
            tempHp: 0,
            initiative: 18,
            isPlayer: true,
            position: { x: 1, y: 1 },
          },
          {
            instanceId: 'c-goblin-1',
            name: 'Goblin Sneak',
            currentHp: 7,
            maxHp: 7,
            tempHp: 0,
            dexMod: 1,
            initiative: 12,
            isPlayer: false,
            position: { x: 2, y: 1 },
          },
        ],
        combatLog: [],
      },
      units: [
        {
          instanceId: 'c-grog-1',
          playerId: `${SUITE_ID}-player-1`,
          name: 'Grog',
          currentHp: 20,
          maxHp: 20,
          tempHp: 0,
          dexMod: 2,
          initiative: 18,
          isPlayer: true,
          position: { x: 1, y: 1 },
        },
        {
          instanceId: 'c-goblin-1',
          name: 'Goblin Sneak',
          currentHp: 7,
          maxHp: 7,
          tempHp: 0,
          dexMod: 1,
          initiative: 12,
          isPlayer: false,
          position: { x: 2, y: 1 },
        },
      ],
    },
  ],
};

const apiBase = 'http://localhost:3005/api';

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto(`/?encounter=${ENCOUNTER_ID}`);
  await page.waitForSelector('header, main');
  await expect(page.getByRole('heading', { name: `Running: ${collisionSeed.encounters[0].name}` })).toBeVisible();
};

const assistantDialog = (page: Page) => page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
const operationsDialog = (page: Page) => page.locator('[role="dialog"][aria-labelledby="ops-modal-title"]');
const diceLogDialog = (page: Page) => page.locator('[role="dialog"][aria-labelledby="dice-roller-title"]');
const currentTurnButton = (page: Page) => page.locator('[aria-current="step"]');

test.describe('EncounterRunner global shortcut collisions', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: collisionSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${apiBase}/campaigns`, { data: collisionSeed });
    // Proposals staged via /api/test/stage-proposal don't expire on their own
    // (docs/HITL_WRITE_TOOLS.md §8); start each test from an empty queue.
    await request.delete(`${apiBase}/test/proposals`);
  });

  test('Alt+A on the encounter tab opens only the Assistant Oracle, not the per-combatant Operations modal', async ({ page }) => {
    await setupApp(page);

    await page.keyboard.press('Alt+a');

    await expect(assistantDialog(page)).toBeVisible();
    await expect(operationsDialog(page)).toHaveCount(0);
    // Exactly one dialog should be open at a time.
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(assistantDialog(page)).not.toBeVisible();
  });

  test('Alt+D on the encounter tab opens exactly one Dice Log', async ({ page }) => {
    await setupApp(page);

    await page.keyboard.press('Alt+d');

    await expect(diceLogDialog(page)).toHaveCount(1);
    await expect(diceLogDialog(page)).toBeVisible();
    // No duplicate "dice-roller-title" id anywhere else in the DOM.
    await expect(page.locator('#dice-roller-title')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(diceLogDialog(page)).not.toBeVisible();
  });

  test('EncounterRunner\'s own "Dice Log (Alt+D)" button also opens exactly one Dice Log', async ({ page }) => {
    await setupApp(page);

    await page.getByRole('button', { name: 'Open Dice Roller and Log (Alt+D)' }).click();

    await expect(diceLogDialog(page)).toHaveCount(1);
    await expect(diceLogDialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(diceLogDialog(page)).not.toBeVisible();
  });

  test('Alt+N while the Assistant Oracle is open with a pending HITL proposal does not advance the turn', async ({ page, request }) => {
    await setupApp(page);

    // Confirm starting turn before anything happens.
    await expect(currentTurnButton(page)).toContainText('Grog');

    // Stage a real proposal via the test-only HITL endpoint and have the chat
    // response deliver it, exactly as tests/e2e/hitl/damage-tool.spec.ts does.
    const stageRes = await request.post(`${apiBase}/test/stage-proposal`, {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [{ combatantName: 'Goblin Sneak', amount: 3, actionType: 'damage' }],
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
          answer: 'Proposing 3 damage to the Goblin Sneak.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    await expect(assistantDialog(page)).toBeVisible();

    const confirmBox = assistantDialog(page).locator('[data-testid="hitl-confirmation-box"]');
    await page.locator('#assistant-oracle-input').fill('Apply 3 damage to the goblin');
    await assistantDialog(page).getByRole('button', { name: 'Ask' }).click();
    await expect(confirmBox).toBeVisible();

    // Alt+N here is meant to be read by the Assistant as "deny the proposal" (see
    // AssistantOracleModal.tsx), not by EncounterRunner as "next turn" -- both
    // listen for the same keystroke on `window`.
    await page.keyboard.press('Alt+n');

    // The proposal was denied (Assistant consumed the keystroke)...
    await expect(confirmBox).not.toBeVisible();
    // ...and the combat turn must NOT have silently advanced underneath it.
    await expect(currentTurnButton(page)).toContainText('Grog');

    await page.keyboard.press('Escape');
    await expect(assistantDialog(page)).not.toBeVisible();

    // Sanity check: Alt+N on its own (no overlay open) still advances the turn
    // as documented, so the fix didn't disable the shortcut outright.
    await page.keyboard.press('Alt+n');
    await expect(currentTurnButton(page)).toContainText('Goblin Sneak');
  });

  test('Alt+N while the Options dialog (Conditions view) is open does not advance the turn', async ({ page }) => {
    await setupApp(page);
    await expect(currentTurnButton(page)).toContainText('Grog');

    // Options is one of EncounterRunner's own in-tree dialogs, so the
    // old isForeignOverlayOpen() check alone didn't catch it: it lives
    // inside rootRef, unlike the Assistant Oracle/Oracle/Shortcuts
    // Help/Dice Log overlays.
    const grogItem = page.locator('li', { hasText: 'Grog' });
    await grogItem.getByRole('button').click();
    await page.getByRole('button', { name: 'Conditions', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'Conditions for Grog' });
    await expect(heading).toBeFocused();

    await page.keyboard.press('Alt+n');

    // The dialog is still open and the turn did not silently advance underneath it.
    await expect(heading).toBeVisible();
    await expect(currentTurnButton(page)).toContainText('Grog');

    await page.keyboard.press('Escape');
    await expect(heading).not.toBeVisible();

    // Sanity check: Alt+N works again once the dialog is closed.
    await page.keyboard.press('Alt+n');
    await expect(currentTurnButton(page)).toContainText('Goblin Sneak');
  });
});
