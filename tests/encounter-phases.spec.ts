import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const SUITE_ID = 'phases-test-suite';

const phasesSeed = {
  id: SUITE_ID,
  name: 'Multi-Phase Campaign',
  description: 'Test Campaign for Encounter Phases',
  chapters: [
    { id: 'chap-phases-1', title: 'Chapter 1', content: 'Phases chapter', order: 0 }
  ],
  assets: [],
  players: [
    { id: 'player-1', name: 'Valeros', description: 'Fighter' }
  ],
  encounters: [
    {
      id: 'enc-phases-1',
      name: 'Ambush at Old Road',
      chapterIds: ['chap-phases-1'],
      units: [
        {
          instanceId: 'unit-scout-1',
          name: 'Goblin Scout',
          hpDice: '2d6',
          dexMod: 2,
          initiative: 12,
          isPlayer: false,
          phase: 1
        },
        {
          instanceId: 'player-valeros',
          playerId: 'player-1',
          name: 'Valeros',
          dexMod: 1,
          initiative: 16,
          isPlayer: true,
          phase: 1
        },
        {
          instanceId: 'unit-bugbear-boss',
          name: 'Bugbear Boss',
          hpDice: '5d8+10',
          dexMod: 2,
          isPlayer: false,
          phase: 2
        }
      ]
    }
  ]
};

test.describe('Encounter Phases System', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: phasesSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: phasesSeed });
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
  });

  test('at start only Phase 1 is visible, and toggle switch activates Phase 2 units', async ({ page }) => {
    await page.goto('/?encounter=enc-phases-1');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('header');

    // 1. Verify Phase controls region exists
    const phasesToolbar = page.locator('section[aria-label="Encounter Phases"]');
    await expect(phasesToolbar).toBeVisible();

    const phase1Btn = page.getByRole('switch', { name: /Phase 1/ });
    const phase2Btn = page.getByRole('switch', { name: /Phase 2/ });

    await expect(phase1Btn).toHaveAttribute('aria-checked', 'true');
    await expect(phase2Btn).toHaveAttribute('aria-checked', 'false');

    // 2. Only Phase 1 units are visible initially in the setup list
    await expect(page.getByLabel(/Goblin Scout/)).toBeVisible();
    await expect(page.getByLabel(/Valeros/)).toBeVisible();
    await expect(page.getByLabel(/Bugbear Boss/)).not.toBeVisible();

    // Run Axe check on Phase controls in Setup
    await checkA11y(page, 'Encounter Phases Setup');

    // 3. Toggle Phase 2 ON
    await phase2Btn.click();
    await expect(phase2Btn).toHaveAttribute('aria-checked', 'true');

    // Live region announces Phase 2
    const liveRegion = page.locator('[aria-live="assertive"]');
    await expect(liveRegion).toContainText('Phase 2 activated');
    await expect(liveRegion).toContainText('Bugbear Boss');

    // Bugbear Boss is now visible in the list
    await expect(page.getByLabel(/Bugbear Boss/)).toBeVisible();

    // 4. Toggle Phase 2 OFF
    await phase2Btn.click();
    await expect(phase2Btn).toHaveAttribute('aria-checked', 'false');
    await expect(liveRegion).toContainText('Phase 2 deactivated');
    await expect(page.getByLabel(/Bugbear Boss/)).not.toBeVisible();
  });

  test('activating Phase 2 during active combat rolls stats and integrates units into turn tracker', async ({ page }) => {
    await page.goto('/?encounter=enc-phases-1');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('header');

    // Start combat with Phase 1 only
    const startBtn = page.getByRole('button', { name: 'Start Combat' });
    await startBtn.click();

    // Confirm combat started
    await expect(page.locator('header').getByText(/Round 1/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Initiative Track' })).toBeVisible();

    // Bugbear Boss should not be in the combat track yet
    await expect(page.getByRole('button', { name: /Options for Bugbear Boss/ })).not.toBeVisible();

    // Toggle Phase 2 ON mid-combat
    const phase2Btn = page.getByRole('switch', { name: /Phase 2/ });
    await phase2Btn.click();
    await expect(phase2Btn).toHaveAttribute('aria-checked', 'true');

    // Bugbear Boss should now be in the initiative track
    await expect(page.getByRole('button', { name: /Options for Bugbear Boss/ })).toBeVisible();

    // Run Axe check during active combat with multiple phases
    await checkA11y(page, 'Encounter Phases Active Combat');
  });
});
