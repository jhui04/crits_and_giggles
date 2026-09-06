import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'encounter-map-suite';
const baseSeed = getSeedState(SUITE_ID);

const mapSeed = {
  ...baseSeed,
  chapters: [
    {
      id: `${SUITE_ID}-chap-1`,
      title: 'Chapter 1: The Sinking Shore',
      content: 'Trouble begins at the shore. @Encounter[encounter-map-1]{Map 5.1: Palma Flora}',
      order: 0
    }
  ],
  encounters: [
    {
      id: 'encounter-map-1',
      name: 'Map 5.1: Palma Flora',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.1-palma-flora.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 20, height: 20 },
      units: [
        {
          instanceId: `${SUITE_ID}-unit-1`,
          monsterId: '17003',
          name: 'sahuagin',
          maxHp: 22,
          currentHp: 22,
          hpDice: '4d8 + 4',
          dexMod: 0,
          initiative: 12,
          passivePerception: 10,
          isPlayer: false,
          position: { x: 2, y: 2 }
        },
        {
          instanceId: `${SUITE_ID}-player-1`,
          playerId: `${SUITE_ID}-p-1`,
          name: 'Grog',
          maxHp: 30,
          currentHp: 30,
          dexMod: 2,
          initiative: 16,
          passivePerception: 14,
          isPlayer: true,
          position: { x: 4, y: 4 }
        }
      ]
    }
  ]
};

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
};

test.describe('Encounter Map Accessibility and Workflow Suite', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: mapSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: mapSeed });
    await setupApp(page);
  });

  test('Chapter shows Map Available badge and encounter link in Run Mode', async ({ page }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    // Chapter Encounters list
    const runEncounterLink = page.getByRole('link', { name: /Run Map 5\.1: Palma Flora/ });
    await expect(runEncounterLink).toBeVisible();

    // Map Available badge should be visible next to it
    const mapBadge = page.locator('text=Map Available');
    await expect(mapBadge).toBeVisible();
  });

  test('Encounter Runner setup view displays View Map button and opens accessible map modal', async ({ page, context }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Map 5\.1: Palma Flora/ }).click()
    ]);
    await encounterPage.waitForLoadState();

    // Verify header View Map button
    const viewMapBtn = encounterPage.getByRole('button', { name: 'View Map (Alt+P)' });
    await expect(viewMapBtn).toBeVisible();

    // Click View Map button to open modal
    await viewMapBtn.click();

    // Assert modal dialog and focus on heading
    const modalHeading = encounterPage.getByRole('heading', { name: /Map: Map 5\.1: Palma Flora/ });
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toBeFocused();

    // Assert Axe accessibility check on Encounter Map Modal
    await checkA11y(encounterPage, 'Encounter Map Modal - Setup View');

    // Switch to Player version
    const playerVerBtn = encounterPage.getByRole('button', { name: 'Player Version' });
    await expect(playerVerBtn).toBeVisible();
    await playerVerBtn.click();
    await expect(playerVerBtn).toHaveAttribute('aria-pressed', 'true');

    // Image alt text updates to reflect player version
    const mapImg = encounterPage.getByRole('img');
    await expect(mapImg).toHaveAttribute('alt', /Player Version/);

    // Switch back to DM version
    const dmVerBtn = encounterPage.getByRole('button', { name: 'DM Version' });
    await dmVerBtn.click();
    await expect(dmVerBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(mapImg).toHaveAttribute('alt', /Dungeon Master Version/);

    // Close via Escape key
    await encounterPage.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible();

    // Focus restored to the View Map button
    await expect(viewMapBtn).toBeFocused();

    await encounterPage.close();
  });

  test('Combat Map toolbar contains View Map and Backdrop controls with Alt+P shortcut', async ({ page, context }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Map 5\.1: Palma Flora/ }).click()
    ]);
    await encounterPage.waitForLoadState();

    // Start combat
    const startBtn = encounterPage.getByRole('button', { name: 'Start Combat' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await expect(startBtn).not.toBeVisible();

    // Verify Combat Map is mounted
    const combatMapHeading = encounterPage.getByRole('heading', { name: /Combat Map/ });
    await expect(combatMapHeading).toBeVisible();

    // Verify toolbar controls
    const toolbarViewMapBtn = encounterPage.locator('.combat-map-section').getByRole('button', { name: 'View Map (Alt+P)' });
    await expect(toolbarViewMapBtn).toBeVisible();

    const backdropToggleBtn = encounterPage.getByRole('button', { name: /Grid Backdrop/ });
    await expect(backdropToggleBtn).toBeVisible();
    await expect(backdropToggleBtn).toHaveAttribute('aria-pressed', 'true');

    // Toggle backdrop off
    await backdropToggleBtn.click();
    await expect(backdropToggleBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(backdropToggleBtn).toHaveText('Show Grid Backdrop');

    // Toggle backdrop on
    await backdropToggleBtn.click();
    await expect(backdropToggleBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(backdropToggleBtn).toHaveText('Hide Grid Backdrop');

    // Open map modal via Alt+P shortcut from combat map
    await encounterPage.keyboard.press('Alt+p');
    const modalHeading = encounterPage.getByRole('heading', { name: /Map: Map 5\.1: Palma Flora/ });
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toBeFocused();

    // Check accessibility during combat view modal
    await checkA11y(encounterPage, 'Encounter Map Modal - Active Combat View');

    // Close via close button
    const closeBtn = encounterPage.getByRole('button', { name: 'Close (Esc)' });
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    await encounterPage.close();
  });
});
