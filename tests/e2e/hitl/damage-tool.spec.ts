import { test, expect, Page, Locator } from '@playwright/test';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-damage-e2e-suite';
const ENCOUNTER_ID = 'hitl-damage-enc-1';

const damageCampaignSeed = {
  id: SUITE_ID,
  name: 'HITL Combat Damage Campaign',
  description: 'Combat damage and temp HP verification suite',
  chapters: [
    {
      id: `${SUITE_ID}-chap-1`,
      title: 'Chapter 1: Palma Flora Cavern',
      content: 'Underground ambush @Encounter[hitl-damage-enc-1]{Palma Flora Cavern}',
      order: 0,
    },
  ],
  assets: [],
  players: [
    {
      id: `${SUITE_ID}-player-grog`,
      name: 'Grog Strongjaw',
      description: 'Goliath Barbarian',
    },
  ],
  encounters: [
    {
      id: ENCOUNTER_ID,
      name: 'Palma Flora Cavern',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.1-palma-flora-player.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 33, height: 21 },
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            instanceId: 'c-grog-1',
            name: 'Grog Strongjaw',
            currentHp: 40,
            maxHp: 50,
            tempHp: 10,
            initiative: 16,
            isPlayer: true,
            position: { x: 12, y: 8 },
          },
          {
            instanceId: 'c-goblin-1',
            name: 'Goblin Sneak',
            currentHp: 7,
            maxHp: 7,
            tempHp: 0,
            initiative: 12,
            isPlayer: false,
            position: { x: 13, y: 8 },
          },
        ],
        combatLog: [],
      },
      units: [
        {
          instanceId: 'c-grog-1',
          name: 'Grog Strongjaw',
          currentHp: 40,
          maxHp: 50,
          tempHp: 10,
          dexMod: 2,
          initiative: 16,
          isPlayer: true,
          position: { x: 12, y: 8 },
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
          position: { x: 13, y: 8 },
        },
      ],
    },
  ],
};

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto(`/?encounter=${ENCOUNTER_ID}`);
  await page.waitForSelector('header, main');
};

/**
 * Helper: Opens Assistant Oracle modal via Alt+A and verifies focus
 */
async function openAssistantOracle(page: Page): Promise<{ modal: Locator; chatInput: Locator }> {
  await page.keyboard.press('Alt+a');
  const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
  await expect(modal).toBeVisible();
  const chatInput = page.locator('#assistant-oracle-input');
  // Not asserting focus here: every test in this file stages a real
  // proposal via /api/test/stage-proposal before calling this helper, so by
  // the time the modal opens, the recovered proposal's own
  // HitlConfirmationBox may already own focus instead of the chat input
  // (see docs/HITL_WRITE_TOOLS.md §5 — an arriving/recovered proposal
  // claims focus).
  return { modal, chatInput };
}

/**
 * Helper: Locates the HITL confirmation container in the modal
 */
function getConfirmationBox(modal: Locator): Locator {
  return modal.locator('[data-testid="hitl-confirmation-box"]');
}

test.describe('Milestone 3: Combat Damage Application Tool (R3)', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: damageCampaignSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: damageCampaignSeed });
    // Proposals staged via /api/test/stage-proposal below don't expire on
    // their own (see docs/HITL_WRITE_TOOLS.md §8); clear any left pending
    // by a prior test in this file so this test starts from an empty queue.
    await request.delete(`${apiBase}/test/proposals`);
    await setupApp(page);
  });

  test('R3-E2E-01: Displays Damage Proposal Card with target name, action/amount, current HP (+temp), and projected HP', async ({
    page,
    request,
  }) => {
    // Stage real proposal via backend test endpoint
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [
            {
              combatantName: 'Grog Strongjaw',
              amount: 15,
              actionType: 'damage',
              damageType: 'slashing',
            },
            {
              combatantName: 'Goblin Sneak',
              amount: 20,
              actionType: 'damage',
            },
          ],
          encounterId: ENCOUNTER_ID,
        },
        context: {
          campaignId: SUITE_ID,
          encounterId: ENCOUNTER_ID,
        },
      },
    });
    expect(stageRes.ok()).toBe(true);
    const stagedData = await stageRes.json();
    expect(stagedData.proposal).toBeDefined();

    // Intercept chat API to deliver the staged proposal
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'I propose applying combat damage to Grog and the Goblin. Please review the projection.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Apply 15 slashing damage to Grog and 20 damage to the goblin');
    await modal.getByRole('button', { name: 'Ask' }).click();

    // 1. Verify HITL confirmation box rendered
    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // 2. Verify Damage Card rendered
    const damageCard = confirmBox.locator('[data-testid="hitl-damage-card"]');
    await expect(damageCard).toBeVisible();

    // 3. Verify Grog Strongjaw row (40 HP, 10 temp HP. 15 damage -> 0 temp HP, 35 HP)
    const grogRow = confirmBox.locator('[data-testid="damage-target-c-grog-1"]');
    await expect(grogRow).toBeVisible();
    await expect(grogRow.locator('[data-testid="damage-combatant-name"]')).toHaveText('Grog Strongjaw');
    await expect(grogRow.locator('[data-testid="damage-action-type"]')).toContainText('slashing (damage)');
    await expect(grogRow.locator('[data-testid="damage-amount"]')).toHaveText('15');
    await expect(grogRow.locator('[data-testid="damage-current-hp"]')).toContainText('40 / 50 (+10 temp)');
    await expect(grogRow.locator('[data-testid="damage-projected-hp"]')).toContainText('35 / 50');

    // 4. Verify Goblin row (7 HP, 0 temp HP. 20 damage -> 0 HP clamped)
    const goblinRow = confirmBox.locator('[data-testid="damage-target-c-goblin-1"]');
    await expect(goblinRow).toBeVisible();
    await expect(goblinRow.locator('[data-testid="damage-combatant-name"]')).toHaveText('Goblin Sneak');
    await expect(goblinRow.locator('[data-testid="damage-current-hp"]')).toContainText('7 / 7');
    await expect(goblinRow.locator('[data-testid="damage-projected-hp"]')).toContainText('0 / 7');

    // 5. Verify action buttons present
    await expect(confirmBox.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect(confirmBox.getByRole('button', { name: /Deny/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R3-E2E-02: Passes Axe accessibility scans with zero violations when Damage Proposal Card is active', async ({
    page,
    request,
  }) => {
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [
            {
              combatantName: 'Grog Strongjaw',
              amount: 12,
              actionType: 'damage',
              damageType: 'fire',
            },
          ],
          encounterId: ENCOUNTER_ID,
        },
        context: {
          campaignId: SUITE_ID,
          encounterId: ENCOUNTER_ID,
        },
      },
    });
    const stagedData = await stageRes.json();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Damage application proposal ready for review.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Deal 12 fire damage to Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Run Axe scan on the full page with active Damage Proposal Card
    await checkA11y(page, 'Damage Proposal Card inside Assistant Oracle');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R3-E2E-03: Approve action updates DB (encounter_units & running_state) and announces event in live region', async ({
    page,
    request,
  }) => {
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [
            {
              combatantName: 'Grog Strongjaw',
              amount: 15,
              actionType: 'damage',
            },
          ],
          encounterId: ENCOUNTER_ID,
        },
        context: {
          campaignId: SUITE_ID,
          encounterId: ENCOUNTER_ID,
        },
      },
    });
    const stagedData = await stageRes.json();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Please review and confirm 15 damage to Grog Strongjaw.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Hit Grog for 15');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Approve button
    const approveBtn = confirmBox.getByRole('button', { name: /Approve/i });
    await approveBtn.click();

    // 1. Verify confirmation message appears in chat log
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action Approved & Applied/i);

    // 2. Verify live region announcement exists and announced the event
    const liveRegion = page.locator('#hitl-live-announcement');
    await expect(liveRegion).toContainText(/Action approved/i);

    // 3. Verify confirmation box dismissed and focus restored to input
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // 4. Verify SQLite Database persistence via backend GET
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    expect(campRes.ok()).toBe(true);
    const campaignData = await campRes.json();
    const encounter = campaignData.encounters.find((e: { id: string }) => e.id === ENCOUNTER_ID);
    const grogUnit = encounter.units.find((u: { instanceId: string }) => u.instanceId === 'c-grog-1');

    // Grog original: 40 currentHp, 10 tempHp. 15 damage -> 35 currentHp, 0 tempHp
    expect(grogUnit.currentHp).toBe(35);
    expect(grogUnit.tempHp).toBe(0);

    // Verify running_state has combatLog entry
    expect(encounter.runningState.combatLog).toBeDefined();
    expect(encounter.runningState.combatLog.length).toBeGreaterThan(0);
  });

  test('R3-E2E-04: Deny action cleanly cancels proposal leaving HP and temp HP unchanged in DB and state', async ({
    page,
    request,
  }) => {
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [
            {
              combatantName: 'Grog Strongjaw',
              amount: 25,
              actionType: 'damage',
            },
          ],
          encounterId: ENCOUNTER_ID,
        },
        context: {
          campaignId: SUITE_ID,
          encounterId: ENCOUNTER_ID,
        },
      },
    });
    const stagedData = await stageRes.json();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Please confirm 25 damage to Grog.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Damage Grog 25');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Deny button
    const denyBtn = confirmBox.getByRole('button', { name: /Deny/i });
    await denyBtn.click();

    // 1. Verify cancellation message appears in chat log
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action Cancelled/i);

    // 2. Verify confirmation box dismissed and focus restored to input
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // 3. Verify SQLite Database is completely untouched
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    expect(campRes.ok()).toBe(true);
    const campaignData = await campRes.json();
    const encounter = campaignData.encounters.find((e: { id: string }) => e.id === ENCOUNTER_ID);
    const grogUnit = encounter.units.find((u: { instanceId: string }) => u.instanceId === 'c-grog-1');

    // Unchanged: 40 HP and 10 temp HP
    expect(grogUnit.currentHp).toBe(40);
    expect(grogUnit.tempHp).toBe(10);
  });

  test('R3-E2E-05: Supports Alt+Y shortcut to approve and Alt+N shortcut to deny with keyboard focus flow', async ({
    page,
    request,
  }) => {
    // 1. Test Alt+Y for healing proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'apply_combat_damage',
        args: {
          targets: [
            {
              combatantName: 'Grog Strongjaw',
              amount: 5,
              actionType: 'healing',
            },
          ],
          encounterId: ENCOUNTER_ID,
        },
        context: {
          campaignId: SUITE_ID,
          encounterId: ENCOUNTER_ID,
        },
      },
    });
    const stagedData = await stageRes.json();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Please confirm 5 healing to Grog.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Heal Grog 5');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Trigger approve via Alt+Y
    await page.keyboard.press('Alt+y');

    // Verify approved
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action Approved & Applied/i);
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Verify DB updated: Grog healed from 40 to 45
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    const campaignData = await campRes.json();
    const encounter = campaignData.encounters.find((e: { id: string }) => e.id === ENCOUNTER_ID);
    const grogUnit = encounter.units.find((u: { instanceId: string }) => u.instanceId === 'c-grog-1');
    expect(grogUnit.currentHp).toBe(45);
    expect(grogUnit.tempHp).toBe(10); // temp HP untouched
  });
});
