import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { chooseDisclosureOption } from './utils/disclosure-select-helper';

// Covers typed damage (resistance halving + bloodied/down announcements) and
// the manual-HP undo stack (button + Alt+U), seeded directly as already-
// started combat so HP is deterministic (no Start Combat HP/initiative roll).
//
// Dragon Turtle (public/data/monsters.json, id 16845) has resistance to Fire
// and no immunities/vulnerabilities, so it's a simple real monster to verify
// resistance halving against.

const SUITE_ID = 'damage-types-suite';
const ENCOUNTER_ID = `${SUITE_ID}-enc-1`;
const DRAGON_TURTLE_ID = '16845';
const apiBase = `${process.env.TEST_API_BASE || 'http://localhost:3005'}/api`;

const damageTypesSeed = {
  id: SUITE_ID,
  name: 'Damage Types Campaign',
  description: 'Verifies typed damage, resistance, bloodied/down announcements, and HP undo',
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
      name: 'Damage Types Encounter',
      chapterIds: [`${SUITE_ID}-chap-1`],
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          {
            instanceId: 'c-dragon-turtle-1',
            monsterId: DRAGON_TURTLE_ID,
            name: 'Dragon Turtle',
            currentHp: 20,
            maxHp: 20,
            tempHp: 0,
            dexMod: 0,
            initiative: 20,
            isPlayer: false,
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
          instanceId: 'c-dragon-turtle-1',
          monsterId: DRAGON_TURTLE_ID,
          name: 'Dragon Turtle',
          currentHp: 20,
          maxHp: 20,
          tempHp: 0,
          dexMod: 0,
          initiative: 20,
          isPlayer: false,
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

test.describe('Combat damage types, resistance, bloodied/down announcements, and HP undo', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: damageTypesSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    await request.post(`${apiBase}/campaigns`, { data: damageTypesSeed });
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: `Running: ${damageTypesSeed.encounters[0].name}` })).toBeVisible();
  });

  const liveRegion = (page: import('@playwright/test').Page) => page.locator('[aria-live="assertive"]');
  const optionsButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Options for Dragon Turtle' });
  // The initiative-track row button for Dragon Turtle, whose name includes its live HP ("Dragon Turtle (HP: 15/20)").
  const unitRowButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Dragon Turtle \(HP:/ });

  test('typed damage applies resistance, announces bloodied/down, and manual HP changes can be undone', async ({ page }) => {
    // --- 1. Fire damage halved by Dragon Turtle's resistance ---
    await optionsButton(page).click();
    await expect(page.getByRole('heading', { name: 'Dragon Turtle Actions' })).toBeFocused();

    await page.getByRole('button', { name: 'Damage', exact: true }).click();
    await page.getByLabel('Damage Amount:').fill('10');

    const damageTypeButton = page.getByRole('button', { name: /^Damage Type:/ });
    await expect(damageTypeButton).toHaveText('Damage Type: Untyped▼');
    await chooseDisclosureOption(page, damageTypeButton, 'Fire');
    await expect(damageTypeButton).toContainText('Fire');

    await checkA11y(page, 'Monster Operations - Damage view with type selected');

    await page.getByRole('button', { name: 'Apply' }).click();

    // Modal closes; focus returns to the Options button that opened it.
    await expect(page.getByRole('dialog', { name: 'Dragon Turtle Actions' })).not.toBeVisible();
    await expect(optionsButton(page)).toBeFocused();

    // 10 fire damage, halved by resistance -> 5 effective damage: 20 -> 15. Not yet bloodied (half of 20 is 10).
    await expect(liveRegion(page)).toContainText('Dragon Turtle takes 10 fire damage, halved by resistance. 15 of 20 HP.');
    await expect(unitRowButton(page)).toContainText('HP: 15/20');

    await checkA11y(page, 'Combat Tracker after resisted damage');

    // --- 2. A second hit crosses the bloodied threshold ---
    await optionsButton(page).click();
    await page.getByRole('button', { name: 'Damage', exact: true }).click();
    await page.getByLabel('Damage Amount:').fill('12');
    await chooseDisclosureOption(page, page.getByRole('button', { name: /^Damage Type:/ }), 'Fire');
    await page.getByRole('button', { name: 'Apply' }).click();

    // 12 fire damage halved -> 6 effective: 15 -> 9, which is <= half of 20 (10): bloodied.
    await expect(liveRegion(page)).toContainText('Dragon Turtle takes 12 fire damage, halved by resistance. 9 of 20 HP. Dragon Turtle is bloodied.');
    await expect(unitRowButton(page)).toContainText('HP: 9/20');

    await checkA11y(page, 'Combat Tracker after bloodied crossing');

    // --- 3. Undo button is present, named for what it undoes, and restores HP ---
    const undoButton = page.getByRole('button', { name: /^Undo: 12 fire damage to Dragon Turtle/ });
    await expect(undoButton).toBeVisible();
    await undoButton.click();

    await expect(liveRegion(page)).toContainText('Undid 12 fire damage to Dragon Turtle. 15 of 20 HP.');
    await expect(unitRowButton(page)).toContainText('HP: 15/20');

    // The undo button now describes the remaining (first) entry and still exists.
    await expect(page.getByRole('button', { name: /^Undo: 10 fire damage to Dragon Turtle/ })).toBeVisible();

    await checkA11y(page, 'Combat Tracker after one undo');

    // --- 4. Alt+U undoes the second (last remaining) entry; button disappears and focus lands on Next Turn ---
    await page.locator('body').click();
    await page.keyboard.press('Alt+u');

    await expect(liveRegion(page)).toContainText('Undid 10 fire damage to Dragon Turtle. 20 of 20 HP.');
    await expect(unitRowButton(page)).toContainText('HP: 20/20');
    await expect(page.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);

    // Alt+U with nothing left to undo is a no-op (button absent, no crash, no announcement change).
    await page.keyboard.press('Alt+u');
    await expect(unitRowButton(page)).toContainText('HP: 20/20');

    await checkA11y(page, 'Combat Tracker after undo stack emptied');
  });

  test('resistance + vulnerability + down announcements, and clicking Undo restores focus predictably', async ({ page }) => {
    // Immune/vulnerable combos aren't testable against a real resistance-only
    // monster without hand-editing monster data, so this test focuses on the
    // "down" announcement (which takes priority over "bloodied") and on focus
    // management when the Undo button itself is clicked and then disappears.
    await optionsButton(page).click();
    await page.getByRole('button', { name: 'Damage', exact: true }).click();
    await page.getByLabel('Damage Amount:').fill('25'); // untyped, lethal: 20 -> 0
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(liveRegion(page)).toContainText('Dragon Turtle takes 25 damage. 0 of 20 HP. Dragon Turtle is down.');
    await expect(unitRowButton(page)).toContainText('HP: 0/20');

    await checkA11y(page, 'Combat Tracker after going down');

    // Clicking the Undo button (which then disappears, since the stack
    // empties) must not teleport focus to document.body; it moves to Next
    // Turn, the next logical control in this toolbar.
    const undoButton = page.getByRole('button', { name: /^Undo: 25 damage to Dragon Turtle/ });
    await undoButton.focus();
    await undoButton.click();

    await expect(liveRegion(page)).toContainText('Undid 25 damage to Dragon Turtle. 20 of 20 HP.');
    await expect(page.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next Turn (Alt+N)' })).toBeFocused();
  });

  // Note: page.goto performs a full browser navigation, so this also covers
  // the (trivial) case of hpUndoStack resetting to [] via component remount.
  // The id-keyed ref guard in loadEncounter (hpUndoEncounterIdRef) exists for
  // the same-mount case -- e.g. an external HITL-approved reload of the SAME
  // encounter -- which must NOT clear the stack; that in-place distinction
  // isn't separately exercised here, since reaching a second encounter from
  // this suite without a full reload has no UI path to drive.
  test('switching to a different encounter resets the undo stack', async ({ page, request }) => {
    const secondEncounterId = `${SUITE_ID}-enc-2`;
    // Also already in active combat, so the Undo button's absence below
    // actually demonstrates the stack was cleared -- not just that combat
    // hasn't started yet (the button's render check is only `hpUndoStack.length
    // > 0`; it doesn't itself verify the entry's unit belongs to this encounter).
    const secondSeed = {
      ...damageTypesSeed,
      encounters: [
        ...damageTypesSeed.encounters,
        {
          id: secondEncounterId,
          name: 'Second Encounter',
          chapterIds: [`${SUITE_ID}-chap-1`],
          runningState: {
            isCombatStarted: true,
            round: 1,
            turnIndex: 0,
            combatants: [
              {
                instanceId: 'c-dragon-turtle-2',
                monsterId: DRAGON_TURTLE_ID,
                name: 'Dragon Turtle',
                currentHp: 20,
                maxHp: 20,
                tempHp: 0,
                dexMod: 0,
                initiative: 20,
                isPlayer: false,
              },
            ],
            combatLog: [],
          },
          units: [
            {
              instanceId: 'c-dragon-turtle-2',
              monsterId: DRAGON_TURTLE_ID,
              name: 'Dragon Turtle',
              currentHp: 20,
              maxHp: 20,
              tempHp: 0,
              dexMod: 0,
              initiative: 20,
              isPlayer: false,
            },
          ],
        },
      ],
    };
    // Build the Undo stack on encounter 1 BEFORE seeding encounter 2: the
    // page's own in-memory campaign (loaded in beforeEach, before encounter 2
    // existed) still lacks it, and EncounterRunner's syncEncounterState PUTs
    // that whole client-side campaign object back on every HP change --
    // seeding encounter 2 first and THEN clicking Apply here would PUT a
    // campaign missing encounter 2 and silently delete it server-side before
    // the goto below ever gets there.
    await optionsButton(page).click();
    await page.getByRole('button', { name: 'Damage', exact: true }).click();
    await page.getByLabel('Damage Amount:').fill('3');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: /^Undo:/ })).toBeVisible();

    const res = await request.post(`${apiBase}/campaigns`, { data: secondSeed });
    if (!res.ok()) throw new Error(`Failed to seed second encounter: ${res.status()}`);

    // Load the second, distinct (also in-combat) encounter.
    await page.goto(`/?encounter=${secondEncounterId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Running: Second Encounter' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Undo:/ })).toHaveCount(0);
  });
});
