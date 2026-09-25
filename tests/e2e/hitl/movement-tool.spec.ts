import { test, expect, Page, Locator } from '@playwright/test';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-movement-e2e-suite';
const ENCOUNTER_ID = 'hitl-move-enc-1';
const COMPILED_ENCOUNTER_ID = 'hitl-move-enc-2';

const movementCampaignSeed = {
  id: SUITE_ID,
  name: 'HITL Movement Campaign',
  description: 'Tactical movement verification suite',
  chapters: [
    {
      id: `${SUITE_ID}-chap-1`,
      title: 'Chapter 1: Palma Flora Shoreline',
      content: 'Shoreline battle @Encounter[hitl-move-enc-1]{Palma Flora Shoreline}',
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
      name: 'Palma Flora Shoreline',
      chapterIds: [`${SUITE_ID}-chap-1`],
      // No map image: regions and coordinates below are seeded on a small hand-made grid, so this
      // test does not depend on the compiled production map data (see the compiled-map test below).
      mapSize: { width: 33, height: 21 },
      gridConfig: {
        columns: 33,
        rows: 21,
        cellPitch: 74,
        regions: [
          {
            id: 'P5',
            name: 'Northern Bridge',
            cells: ['17,0', '17,1', '17,2'],
          },
          {
            id: 'P1',
            name: 'South Shore',
            cells: ['12,8', '13,8', '12,9', '13,9'],
          },
        ],
      },
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            instanceId: 'c-grog-1',
            name: 'Grog Strongjaw',
            currentHp: 45,
            maxHp: 45,
            initiative: 16,
            isPlayer: true,
            position: { x: 12, y: 8 },
          },
          {
            instanceId: 'c-sahuagin-1',
            name: 'Sahuagin Raider',
            currentHp: 22,
            maxHp: 22,
            initiative: 12,
            isPlayer: false,
            position: { x: 13, y: 8 },
          },
        ],
      },
      units: [
        {
          instanceId: 'c-grog-1',
          name: 'Grog Strongjaw',
          currentHp: 45,
          maxHp: 45,
          dexMod: 2,
          initiative: 16,
          isPlayer: true,
          position: { x: 12, y: 8 },
        },
        {
          instanceId: 'c-sahuagin-1',
          name: 'Sahuagin Raider',
          currentHp: 22,
          maxHp: 22,
          dexMod: 1,
          initiative: 12,
          isPlayer: false,
          position: { x: 13, y: 8 },
        },
      ],
    },
    {
      id: COMPILED_ENCOUNTER_ID,
      name: 'Palma Flora Compiled Map',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.1-palma-flora.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 67, height: 43 },
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          { instanceId: 'c2-grog', name: 'Grog Strongjaw', currentHp: 45, maxHp: 45, initiative: 16, isPlayer: true, position: { x: 26, y: 17 } },
          { instanceId: 'c2-sahuagin', name: 'Sahuagin Raider', currentHp: 22, maxHp: 22, initiative: 12, isPlayer: false, position: { x: 30, y: 17 } },
        ],
      },
      units: [
        { instanceId: 'c2-grog', name: 'Grog Strongjaw', currentHp: 45, maxHp: 45, dexMod: 2, initiative: 16, isPlayer: true, position: { x: 26, y: 17 } },
        { instanceId: 'c2-sahuagin', name: 'Sahuagin Raider', currentHp: 22, maxHp: 22, dexMod: 1, initiative: 12, isPlayer: false, position: { x: 30, y: 17 } },
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

test.describe('Milestone 2: Character Movement Tool with Rich Context (R2)', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: movementCampaignSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: movementCampaignSeed });
    // Proposals staged via /api/test/stage-proposal below don't expire on
    // their own (see docs/HITL_WRITE_TOOLS.md §8); clear any left pending
    // by a prior test in this file so this test starts from an empty queue.
    await request.delete(`${apiBase}/test/proposals`);
    await setupApp(page);
  });

  test('R2-E2E-01: Renders rich presentation with character name, origin & dest coordinates, regions, and adjacencies', async ({
    page,
    request,
  }) => {
    // Stage real proposal via backend test endpoint
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'move_combatant',
        args: {
          combatantName: 'Grog Strongjaw',
          destination: 'R1', // Northern Bridge: x=17, y=0
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
          answer: 'I propose moving Grog Strongjaw to the Northern Bridge (R1). Please review and confirm.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Move Grog to R1');
    await modal.getByRole('button', { name: 'Ask' }).click();

    // 1. Verify HITL confirmation box rendered
    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // 2. Verify Character Moving section
    const characterNameEl = confirmBox.locator('[data-testid="movement-combatant-name"]');
    await expect(characterNameEl).toHaveText('Grog Strongjaw');

    // 3. Verify Origin & Destination Coordinates and Region Names
    const originCoordsEl = confirmBox.locator('[data-testid="movement-origin-coords"]');
    await expect(originCoordsEl).toContainText('M9');

    const destCoordsEl = confirmBox.locator('[data-testid="movement-dest-coords"]');
    await expect(destCoordsEl).toContainText('R1');
    await expect(destCoordsEl).toContainText('Northern Bridge');

    // 4. Verify Tactical Adjacencies at Origin (Sahuagin Raider is enemy adjacent at 5 ft)
    const originAdjEl = confirmBox.locator('[data-testid="movement-origin-adjacencies"]');
    await expect(originAdjEl).toBeVisible();
    await expect(originAdjEl).toContainText('Sahuagin Raider');

    // 5. Verify Destination Adjacencies (None at R1)
    const destAdjEl = confirmBox.locator('[data-testid="movement-dest-adjacencies"]');
    await expect(destAdjEl).toBeVisible();
    await expect(destAdjEl).toContainText('None');

    // 6. Verify accessible action buttons
    await expect(confirmBox.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect(confirmBox.getByRole('button', { name: /Deny/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R2-E2E-02: Passes Axe accessibility scans with zero violations when Movement Proposal Card is active', async ({
    page,
    request,
  }) => {
    // Stage real proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'move_combatant',
        args: {
          combatantName: 'Grog Strongjaw',
          destination: 'R1',
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
          answer: 'Tactical movement proposal ready for review.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Move Grog to R1');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Run Axe scan on the full page with active Movement Proposal Card
    await checkA11y(page, 'Movement Proposal Card inside Assistant Oracle');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R2-E2E-03: Approve action mutates combatant position in DB and updates Combat Map battlemap', async ({
    page,
    request,
  }) => {
    // Verify initial position on Combat Map: Grog at (12, 8) / M9
    const initialGrogCell = page.locator('td[data-cell="12-8"]');
    await expect(initialGrogCell).toHaveAttribute('aria-label', /Grog Strongjaw/);

    const targetCellBefore = page.locator('td[data-cell="17-0"]');
    await expect(targetCellBefore).toHaveAttribute('aria-label', /Empty/);

    // Stage real proposal
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'move_combatant',
        args: {
          combatantId: 'c-grog-1',
          destination: 'R1',
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
          answer: 'Please confirm moving Grog Strongjaw to R1.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Advance Grog to R1');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Approve button
    const approveBtn = confirmBox.getByRole('button', { name: /Approve/i });
    await approveBtn.click();

    // Verify confirmation message appears in chat log
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action Approved & Applied/i);
    await expect(logRegion).toContainText(/Moved Grog Strongjaw to R1/i);

    // Verify confirmation box dismissed and focus restored to input
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Close Assistant Oracle to view Combat Map
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Verify Combat Map updated immediately:
    // Destination (17, 0) / R1 now has Grog Strongjaw
    const destCellAfter = page.locator('td[data-cell="17-0"]');
    await expect(destCellAfter).toHaveAttribute('aria-label', /Grog Strongjaw/);

    // Origin (12, 8) / M9 is now Empty
    const originCellAfter = page.locator('td[data-cell="12-8"]');
    await expect(originCellAfter).toHaveAttribute('aria-label', /Empty/);

    // Verify SQLite Database persistence via backend GET
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    expect(campRes.ok()).toBe(true);
    const campaignData = await campRes.json();
    const encounter = campaignData.encounters.find((e: { id: string }) => e.id === ENCOUNTER_ID);
    const grogUnit = encounter.units.find((u: { instanceId: string }) => u.instanceId === 'c-grog-1');

    expect(grogUnit.position).toEqual({ x: 17, y: 0 });
  });

  test('R2-E2E-04: Deny action leaves combatant position completely unchanged in DB and Combat Map', async ({
    page,
    request,
  }) => {
    // Initial position: Grog at (12, 8)
    const initialGrogCell = page.locator('td[data-cell="12-8"]');
    await expect(initialGrogCell).toHaveAttribute('aria-label', /Grog Strongjaw/);

    // Stage proposal to move to A1
    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'move_combatant',
        args: {
          combatantId: 'c-grog-1',
          destination: 'A1',
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
          answer: 'Please confirm moving Grog Strongjaw to A1.',
          proposals: [stagedData.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Move Grog to A1');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();

    // Click Deny button
    const denyBtn = confirmBox.getByRole('button', { name: /Deny/i });
    await denyBtn.click();

    // Verify cancellation notice in chat log
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action Cancelled/i);

    // Verify confirmation box dismissed and focus restored to input
    await expect(confirmBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Close Assistant Oracle
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Verify Combat Map: Grog remains at (12, 8)
    const grogCell = page.locator('td[data-cell="12-8"]');
    await expect(grogCell).toHaveAttribute('aria-label', /Grog Strongjaw/);

    // Cell A1 (0, 0) remains Empty
    const a1Cell = page.locator('td[data-cell="0-0"]');
    await expect(a1Cell).toHaveAttribute('aria-label', /Empty/);

    // Verify SQLite Database persistence: position is still (12, 8)
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    expect(campRes.ok()).toBe(true);
    const campaignData = await campRes.json();
    const encounter = campaignData.encounters.find((e: { id: string }) => e.id === ENCOUNTER_ID);
    const grogUnit = encounter.units.find((u: { instanceId: string }) => u.instanceId === 'c-grog-1');

    expect(grogUnit.position).toEqual({ x: 12, y: 8 });
  });
  test('R2-E2E-05: Movement card lists terrain and cover notes from the compiled map and passes Axe', async ({
    page,
    request,
  }) => {
    await page.goto(`/?encounter=${COMPILED_ENCOUNTER_ID}`);
    await page.waitForSelector('header, main');

    // Pick a sand cell in P1 South Shore that touches water, straight from the compiled map data,
    // so the test follows the data instead of hard-coding coordinates.
    const docRes = await request.get('http://localhost:5174/data/maps/egtw-5.1-palma-flora.json');
    expect(docRes.ok()).toBe(true);
    const doc = await docRes.json();
    const code = (cls: string) => Object.entries(doc.terrain.legend).find(([, c]) => c === cls)?.[0];
    const sand = code('sand');
    const water = [code('water_deep'), code('water_shallow')];
    const p1 = doc.regions.find((r: { id: string }) => r.id === 'P1');
    const cell = p1.cells
      .map((k: string) => k.split(',').map(Number))
      .find(([x, y]: number[]) => {
        if (doc.terrain.rows[y][x] !== sand) return false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && water.includes(doc.terrain.rows[y + dy]?.[x + dx])) return true;
        }
        return false;
      });
    expect(cell).toBeDefined();
    const label = (x: number, y: number) => {
      let col = '';
      let n = x;
      while (n >= 0) { col = String.fromCharCode((n % 26) + 65) + col; n = Math.floor(n / 26) - 1; }
      return `${col}${y + 1}`;
    };
    const destination = label(cell[0], cell[1]);

    const stageRes = await request.post('http://localhost:3005/api/test/stage-proposal', {
      data: {
        toolName: 'move_combatant',
        args: { combatantName: 'Sahuagin Raider', destination, encounterId: COMPILED_ENCOUNTER_ID },
        context: { campaignId: SUITE_ID, encounterId: COMPILED_ENCOUNTER_ID },
      },
    });
    expect(stageRes.ok()).toBe(true);
    const staged = await stageRes.json();

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: `I propose moving the Sahuagin Raider to ${destination}. Please review and confirm.`,
          proposals: [staged.proposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Put the sahuagin at the water edge on the beach');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmBox = getConfirmationBox(modal);
    await expect(confirmBox).toBeVisible();
    const notes = confirmBox.locator('[data-testid="movement-dest-notes"]');
    await expect(notes).toBeVisible();
    await expect(notes.getByRole('heading', { name: /Destination Notes/ })).toBeVisible();
    await expect(notes.getByRole('listitem').first()).toContainText(/^Sand; water touches it to the /);
    await expect(confirmBox.locator('[data-testid="movement-dest-coords"]')).toContainText('South Shore');

    await checkA11y(page);
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
