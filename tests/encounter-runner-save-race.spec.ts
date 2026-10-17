import { test, expect, Page, Route } from '@playwright/test';

// Regression coverage for a race between EncounterRunner.tsx's own saves
// (syncEncounterState -> updateCampaign -> PUT /api/campaigns/:id) and the
// "pick up external server-side updates" effect that reloads the encounter
// when the campaign context's running_state carries an updatedAt this
// component didn't itself write.
//
// Bug: the component used to track only the LAST updatedAt it wrote
// (lastSyncedUpdatedAtRef). With two saves in flight (e.g. Alt+N pressed
// twice quickly), the ref is overwritten with write B's updatedAt
// synchronously, before write A's PUT response lands. CampaignProvider's
// updateCampaign serializes PUTs but applies EACH call's own server
// response to context state as it resolves, so when A's (now stale, "A" is
// older than the ref's "B") echo lands, `freshUpdatedAt !== ref.current`
// looks like an external mutation and spuriously fires loadEncounter --
// clearing in-progress HP edits, re-running autoDeploy, and resetting
// activeEncounter/turnIndex/round to A's stale snapshot, with a bogus
// "Encounter resumed..." screen-reader announcement.
//
// Fix: track the SET of every updatedAt this component has written, so
// A's echo is still recognized as our own no matter which write's response
// lands last.

const SUITE_ID = 'save-race-suite';
const ENCOUNTER_ID = `${SUITE_ID}-enc-1`;
const apiBase = `${process.env.TEST_API_BASE || 'http://localhost:3005'}/api`;

const raceSeed = {
  id: SUITE_ID,
  name: 'Save Race Campaign',
  description: 'Verifies overlapping EncounterRunner saves do not trigger a spurious external reload',
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
      name: 'Save Race Encounter',
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

const currentTurnButton = (page: Page) => page.locator('[aria-current="step"]');

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);

  // Record every textContent the assertive live region takes on, so a
  // transient "Encounter resumed..." announcement can be caught even if a
  // later announcement overwrites it before the test gets to read the DOM.
  await page.addInitScript(() => {
    (window as unknown as { __liveAnnouncements: string[] }).__liveAnnouncements = [];
    const attach = () => {
      const el = document.querySelector('[aria-live="assertive"]');
      if (!el) {
        requestAnimationFrame(attach);
        return;
      }
      const record = () => {
        const text = el.textContent || '';
        if (text) (window as unknown as { __liveAnnouncements: string[] }).__liveAnnouncements.push(text);
      };
      record();
      new MutationObserver(record).observe(el, { characterData: true, childList: true, subtree: true });
    };
    requestAnimationFrame(attach);
  });

  await page.goto(`/?encounter=${ENCOUNTER_ID}`);
  await page.waitForSelector('header, main');
  await expect(page.getByRole('heading', { name: `Running: ${raceSeed.encounters[0].name}` })).toBeVisible();
};

const getAnnouncements = (page: Page) =>
  page.evaluate(() => (window as unknown as { __liveAnnouncements: string[] }).__liveAnnouncements);

test.describe('EncounterRunner save race (own-write echo vs. external update)', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: raceSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${apiBase}/campaigns`, { data: raceSeed });
    await request.delete(`${apiBase}/test/proposals`);
  });

  test('two quick Alt+N saves overlapping in flight do not trigger a spurious "Encounter resumed" reload, and the turn still advances by exactly two', async ({ page }) => {
    await setupApp(page);
    await expect(currentTurnButton(page)).toContainText('Grog');

    // The initial load legitimately announces "Encounter resumed..." once
    // (it's resuming saved combat state) -- clear that before watching for
    // a SPURIOUS one caused by the save race under test.
    await page.evaluate(() => {
      (window as unknown as { __liveAnnouncements: string[] }).__liveAnnouncements = [];
    });

    let putCount = 0;
    await page.route(`**/api/campaigns/${SUITE_ID}`, async (route: Route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      putCount += 1;
      if (putCount === 1) {
        // Hold the FIRST save's response so the second save's own PUT (sent
        // only once CampaignProvider's serialized chain advances past the
        // first) resolves and lands in context state before this older,
        // now-stale echo does.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });

    // Focus must not be inside an input for Alt+N to be handled as "next turn".
    await page.locator('body').click();
    await page.keyboard.press('Alt+n');
    await page.keyboard.press('Alt+n');

    // Wait for both PUTs to round-trip.
    await expect.poll(() => putCount).toBe(2);
    // Give the (possibly buggy) reload effect a moment to fire after the
    // delayed first PUT's response lands in context state.
    await page.waitForTimeout(1000);

    // With 2 combatants, two Next Turn presses should land back on the
    // first combatant with the round incremented to 2. A spurious reload
    // back to the first (stale) write's snapshot would show Round 1 with
    // the turn on Goblin Sneak instead.
    await expect(page.getByLabel('Round 2')).toBeVisible();
    await expect(currentTurnButton(page)).toContainText('Grog');

    const announcements = await getAnnouncements(page);
    expect(announcements.some((a) => /Encounter resumed/i.test(a))).toBe(false);
  });

  test('a genuine external update (HITL-approved damage) still reloads and is picked up live', async ({ page, request }) => {
    await setupApp(page);
    await expect(currentTurnButton(page)).toContainText('Grog');

    // Stage and approve a real HITL damage proposal the same way
    // tests/e2e/hitl/damage-tool.spec.ts does, which executes the mutation
    // directly against the server (server/assistant/toolController.js's
    // executeMutation sets running_state.updatedAt itself) -- an updatedAt
    // this EncounterRunner instance never wrote.
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
    const assistantDialog = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(assistantDialog).toBeVisible();

    const confirmBox = assistantDialog.locator('[data-testid="hitl-confirmation-box"]');
    await page.locator('#assistant-oracle-input').fill('Apply 3 damage to the goblin');
    await assistantDialog.getByRole('button', { name: 'Ask' }).click();
    await expect(confirmBox).toBeVisible();

    await confirmBox.getByRole('button', { name: /Approve/i }).click();
    await expect(confirmBox).not.toBeVisible();

    await page.keyboard.press('Escape');
    await expect(assistantDialog).not.toBeVisible();

    // The external mutation (Goblin Sneak: 7 -> 4 HP) should be picked up by
    // this EncounterRunner instance's reload effect without a manual page
    // refresh.
    await expect(page.locator('ul[role="list"] button').filter({ hasText: /Goblin Sneak.*HP: 4\/7/ })).toBeVisible();
  });
});
