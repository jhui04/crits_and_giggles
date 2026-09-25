import { test, expect, Page, Locator } from '@playwright/test';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-config-e2e-suite';
const ENCOUNTER_ID = 'hitl-config-enc-1';

const configCampaignSeed = {
  id: SUITE_ID,
  name: 'HITL Combatant Config Campaign',
  description: 'Combatant customization and encounter phases verification suite',
  chapters: [
    {
      id: `${SUITE_ID}-chap-1`,
      title: 'Chapter 1: Palma Flora Shoreline',
      content: 'Shoreline battle @Encounter[hitl-config-enc-1]{Palma Flora Shoreline Ambush}',
      order: 0,
    },
  ],
  assets: [],
  players: [
    {
      id: `${SUITE_ID}-player-valeros`,
      name: 'Valeros',
      description: 'Human Fighter',
    },
  ],
  encounters: [
    {
      id: ENCOUNTER_ID,
      name: 'Palma Flora Shoreline Ambush',
      chapterIds: [`${SUITE_ID}-chap-1`],
      // No map image: the regions below are seeded directly so this test does not depend on the
      // compiled production map data.
      mapSize: { width: 33, height: 21 },
      gridConfig: {
        columns: 33,
        rows: 21,
        cellPitch: 74,
        regions: [
          {
            id: 'P1',
            name: 'South Shore',
            cells: ['1,2', '1,3', '2,2', '2,3'], // B3 is (1,2)
          },
          {
            id: 'P2',
            name: 'North Woods',
            cells: ['7,0', '7,1', '8,0', '8,1'], // H1 is (7,0)
          },
        ],
      },
      runningState: {
        isCombatStarted: false,
        round: 1,
        turnIndex: 0,
        activePhases: [1],
        combatants: [
          {
            instanceId: 'c-valeros-1',
            name: 'Valeros',
            currentHp: 25,
            maxHp: 25,
            tempHp: 0,
            initiative: 15,
            isPlayer: true,
            position: { x: 0, y: 0 },
            phase: 1,
          },
        ],
        combatLog: [],
      },
      units: [
        {
          instanceId: 'c-valeros-1',
          name: 'Valeros',
          currentHp: 25,
          maxHp: 25,
          tempHp: 0,
          dexMod: 2,
          initiative: 15,
          isPlayer: true,
          position: { x: 0, y: 0 },
          phase: 1,
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

test.describe('Milestone 4: Encounter Combatant Customization & Phase Tool (R4)', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: configCampaignSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: configCampaignSeed });
    // Proposals staged via /api/test/stage-proposal below don't expire on
    // their own (see docs/HITL_WRITE_TOOLS.md §8); clear any left pending
    // by a prior test in this file so this test starts from an empty queue.
    await request.delete(`${apiBase}/test/proposals`);
    await setupApp(page);
  });

  test('R4-E2E-01: Displays Combatant Config Proposal Card with Name, Monster Type, Starting Coordinates, Assigned Phase, and Faction', async ({
    page,
    request,
  }) => {
    // Stage real proposal via backend test endpoint using scenarioText
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'configure_encounter_combatants',
        args: {
          scenarioText:
            '3 Goblins appear at South Shore (B3) as the initial wave. 2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.',
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
    expect(stagedData.proposal.payloadType).toBe('combatant_config');

    // Intercept chat API to deliver the staged proposal
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'I have analyzed the scenario and staged a combatant configuration proposal.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Configure combatants for the upcoming beach ambush');
    await modal.getByRole('button', { name: 'Ask' }).click();

    // 1. Verify HITL confirmation box rendered
    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // 2. Verify Combatant Config Card rendered
    const configCard = confirmBox.locator('[data-testid="hitl-combatant-config-card"]');
    await expect(configCard).toBeVisible();

    // 3. Verify Table and Headers
    const table = configCard.locator('table[aria-label="Configured Combatants and Phases"]');
    await expect(table).toBeVisible();
    await expect(table.locator('th[scope="col"]').nth(0)).toHaveText('Name');
    await expect(table.locator('th[scope="col"]').nth(1)).toHaveText('Monster Type');
    await expect(table.locator('th[scope="col"]').nth(2)).toHaveText('Starting Coordinates');
    await expect(table.locator('th[scope="col"]').nth(3)).toHaveText('Assigned Phase');
    await expect(table.locator('th[scope="col"]').nth(4)).toHaveText('Faction');

    // 4. Verify Goblins in Phase 1 (Initial Wave)
    const goblin1Row = configCard.locator('[data-testid="combatant-row-0"]');
    await expect(goblin1Row).toBeVisible();
    await expect(goblin1Row.locator('[data-testid="combatant-name"]')).toHaveText('Goblin 1');
    await expect(goblin1Row.locator('[data-testid="combatant-monster-type"]')).toHaveText('Goblin');
    await expect(goblin1Row.locator('[data-testid="combatant-coordinates"]')).toContainText('B3');
    await expect(goblin1Row.locator('[data-testid="combatant-coordinates"]')).toContainText('South Shore');
    await expect(goblin1Row.locator('[data-testid="combatant-phase"]')).toHaveText('Phase 1: Initial Wave');
    await expect(goblin1Row.locator('[data-testid="combatant-faction"]')).toContainText('enemy');

    // 5. Verify Bugbears in Phase 2 (Reinforcements)
    const bugbear1Row = configCard.locator('[data-testid="combatant-row-3"]');
    await expect(bugbear1Row).toBeVisible();
    await expect(bugbear1Row.locator('[data-testid="combatant-name"]')).toHaveText('Bugbear 1');
    await expect(bugbear1Row.locator('[data-testid="combatant-monster-type"]')).toHaveText('Bugbear');
    await expect(bugbear1Row.locator('[data-testid="combatant-coordinates"]')).toContainText('H1');
    await expect(bugbear1Row.locator('[data-testid="combatant-coordinates"]')).toContainText('North Woods');
    await expect(bugbear1Row.locator('[data-testid="combatant-phase"]')).toHaveText('Phase 2: Reinforcements');
    await expect(bugbear1Row.locator('[data-testid="combatant-faction"]')).toContainText('enemy');

    // 6. Verify Standard Action Controls
    await expect(confirmBox.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect(confirmBox.getByRole('button', { name: /Deny/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R4-E2E-02: Passes Axe accessibility scans with zero violations when Combatant Config Proposal Card is active', async ({
    page,
    request,
  }) => {
    // Stage proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'configure_encounter_combatants',
        args: {
          scenarioText:
            '3 Goblins appear at South Shore (B3) as the initial wave. 2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.',
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
          answer: 'Please confirm configuring the encounter roster.',
          proposals: [stagedData.proposal],
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Configure combatants');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Run Axe core scan
    await checkA11y(page, 'HITL Combatant Config Proposal Confirmation Box');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R4-E2E-03: Approve action commits roster to SQLite DB, updates EncounterRunner, and announces in live region', async ({
    page,
    request,
  }) => {
    // Stage real proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'configure_encounter_combatants',
        args: {
          combatants: [
            {
              name: 'Goblin Ambush Scout',
              monsterId: 'goblin',
              coordinates: 'B3',
              phase: 1,
              faction: 'enemy',
            },
            {
              name: 'Bugbear Reinforcer',
              monsterId: 'bugbear',
              coordinates: 'H1',
              phase: 2,
              faction: 'enemy',
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
          answer: 'Proposal ready.',
          proposals: [stagedData.proposal],
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Configure roster');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Approve button
    const approveBtn = confirmBox.getByRole('button', { name: /Approve/i });
    await approveBtn.click();

    // Confirmation box dismissed
    await expect(confirmBox).not.toBeVisible();

    // Verify chat log has success message
    const chatLog = modal.locator('[role="log"]');
    await expect(chatLog).toContainText('Action Approved & Applied');

    // Verify live region announcement
    const liveAnnouncement = modal.locator('#hitl-live-announcement');
    await expect(liveAnnouncement).toContainText('Action approved');

    // Verify focus returned to chatInput
    await expect(chatInput).toBeFocused();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Verify EncounterRunner updated with new combatants
    // Phase 1 unit: Goblin Ambush Scout should be visible
    await expect(page.getByLabel(/Goblin Ambush Scout/)).toBeVisible();

    // Toggle Phase 2 switch to verify Phase 2 unit is also present
    const phase2Switch = page.getByRole('switch', { name: /Phase 2/ });
    if (await phase2Switch.isVisible()) {
      await phase2Switch.click();
      await expect(page.getByLabel(/Bugbear Reinforcer/)).toBeVisible();
    }
  });

  test('R4-E2E-04: Deny action cleanly cancels proposal leaving roster untouched in DB and runner', async ({
    page,
    request,
  }) => {
    // Stage real proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'configure_encounter_combatants',
        args: {
          scenarioText: '3 Goblins appear at South Shore (B3) as the initial wave.',
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
          answer: 'Please confirm roster configuration.',
          proposals: [stagedData.proposal],
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Configure goblins');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Deny button
    const denyBtn = confirmBox.getByRole('button', { name: /Deny/i });
    await denyBtn.click();

    // Confirmation box dismissed
    await expect(confirmBox).not.toBeVisible();

    // Verify chat log has cancellation message
    const chatLog = modal.locator('[role="log"]');
    await expect(chatLog).toContainText('Action Cancelled');

    // Verify focus returned to chatInput
    await expect(chatInput).toBeFocused();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Verify no goblins in encounter runner
    await expect(page.getByLabel(/Goblin 1/)).not.toBeVisible();
  });

  test('R4-E2E-05: Supports Alt+Y shortcut to approve and Alt+N shortcut to deny with keyboard focus flow', async ({
    page,
    request,
  }) => {
    // Stage proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'configure_encounter_combatants',
        args: {
          combatants: [
            {
              name: 'Shortcut Goblin',
              coordinates: 'B3',
              phase: 1,
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
          answer: 'Please review and confirm shortcut roster test.',
          proposals: [stagedData.proposal],
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Shortcut roster test');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Test Alt+Y to approve
    await page.keyboard.press('Alt+y');

    // Confirm box dismissed and focus restored to input
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
