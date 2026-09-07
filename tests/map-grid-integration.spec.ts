import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'map-grid-integration-suite';
const baseSeed = getSeedState(SUITE_ID);

const palmaRegions = [
  {
    id: 'P5',
    name: 'Northern Bridge',
    type: 'bridge',
    cells: ['17,0', '17,1', '17,2']
  },
  {
    id: 'P7',
    name: 'Walled Manor & Fountain',
    type: 'walled_compound',
    cells: ['21,3', '22,3', '23,3', '21,4', '22,4', '23,4', '20,5', '21,5', '22,5', '20,6', '21,6']
  },
  {
    id: 'P8',
    name: 'Harbor Docks & Wavechaser',
    type: 'docks',
    cells: ['25,7', '26,7', '27,7', '24,12', '25,12', '26,12', '27,12', '28,12', '29,12']
  },
  {
    id: 'P2',
    name: 'West Shore & Cottages',
    type: 'village_beach',
    cells: ['5,5', '6,5', '7,5', '8,5']
  },
  {
    id: 'ocean',
    name: 'Lucidian Ocean',
    type: 'water',
    cells: ['0,0', '1,0', '2,0']
  }
];

const wavechaserRegions = [
  {
    id: 'W-FORE',
    name: 'Forecastle & Bowsprit',
    type: 'ship_deck',
    cells: ['7,2', '8,2', '7,3', '8,3']
  },
  {
    id: 'W-MAIN',
    name: 'Main Deck & Cargo Grates',
    type: 'ship_deck',
    cells: ['6,8', '7,8', '8,8', '9,8']
  },
  {
    id: 'W-STERN',
    name: 'Quarterdeck, Helm & Ballistae',
    type: 'ship_deck',
    cells: ['7,17', '8,17', '4,19', '11,19']
  },
  {
    id: 'W-CAPT',
    name: "Captain's Cabin (Three Earrings)",
    type: 'ship_cabin',
    cells: ['23,17', '24,17', '23,18', '24,18']
  },
  {
    id: 'W-CABIN',
    name: "Passenger Cabin (Adventurers' Quarters)",
    type: 'ship_cabin',
    cells: ['26,17', '27,17', '26,18', '27,18']
  },
  {
    id: 'ocean',
    name: 'Lucidian Ocean',
    type: 'water',
    cells: ['0,0', '1,0', '2,0']
  }
];

const ruinedRegions = [
  {
    id: 'P5',
    name: 'Northern Bridge Ruins',
    type: 'bridge',
    cells: ['15,1', '15,2', '16,1', '16,2']
  },
  {
    id: 'P10',
    name: 'Central Plaza & Statue of Kord',
    type: 'plaza',
    cells: ['15,9', '16,9', '15,10', '16,10']
  },
  {
    id: 'ocean',
    name: 'Sharkfeather Trench',
    type: 'water',
    cells: ['0,0', '1,0', '2,0']
  }
];

const mapGridSeed = {
  ...baseSeed,
  chapters: [
    {
      id: `${SUITE_ID}-chap-1`,
      title: 'Chapter 1: The Sinking Shore',
      content: 'Trouble begins at the shore. @Encounter[palma-flora-encounter]{Map 5.1: Palma Flora} @Encounter[wavechaser-encounter]{Map 5.2: Wavechaser} @Encounter[ruined-palma-encounter]{Map 5.3: Ruined Palma Flora}',
      order: 0
    }
  ],
  encounters: [
    {
      id: 'palma-flora-encounter',
      name: 'Map 5.1: Palma Flora',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.1-palma-flora.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 33, height: 21, cellPitch: 75, offsetX: 66, offsetY: 35, regions: palmaRegions },
      gridConfig: {
        columns: 33,
        rows: 21,
        cellPitch: 75,
        offsetX: 66,
        offsetY: 35,
        imageWidth: 2550,
        imageHeight: 1650,
        regions: palmaRegions
      },
      units: [
        {
          instanceId: `${SUITE_ID}-unit-sahuagin`,
          monsterId: '17003',
          name: 'Sahuagin Raider',
          maxHp: 22,
          currentHp: 22,
          dexMod: 0,
          initiative: 12,
          isPlayer: false,
          position: { x: 5, y: 5 }
        },
        {
          instanceId: `${SUITE_ID}-player-hero`,
          playerId: `${SUITE_ID}-p-1`,
          name: 'Beauregard',
          maxHp: 28,
          currentHp: 28,
          dexMod: 3,
          initiative: 18,
          isPlayer: true,
          position: { x: 6, y: 5 }
        }
      ]
    },
    {
      id: 'wavechaser-encounter',
      name: 'Map 5.2: Wavechaser',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.2-wavechaser.png',
      mapSize: { width: 33, height: 21, cellPitch: 75, offsetX: 50, offsetY: 66, regions: wavechaserRegions },
      gridConfig: {
        columns: 33,
        rows: 21,
        cellPitch: 75,
        offsetX: 50,
        offsetY: 66,
        imageWidth: 2550,
        imageHeight: 1650,
        regions: wavechaserRegions
      },
      units: [
        {
          instanceId: `${SUITE_ID}-unit-pirate`,
          name: 'Pirate Sailor',
          maxHp: 16,
          currentHp: 16,
          dexMod: 1,
          initiative: 14,
          isPlayer: false,
          position: { x: 7, y: 8 }
        }
      ]
    },
    {
      id: 'ruined-palma-encounter',
      name: 'Map 5.3: Ruined Palma Flora',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.3-ruined-palma-flora.png',
      playerMapUrl: '/maps/5.3-ruined-palma-flora-player.png',
      mapSize: { width: 33, height: 21, cellPitch: 75, offsetX: 66, offsetY: 35, regions: ruinedRegions },
      gridConfig: {
        columns: 33,
        rows: 21,
        cellPitch: 75,
        offsetX: 66,
        offsetY: 35,
        imageWidth: 2550,
        imageHeight: 1650,
        regions: ruinedRegions
      },
      units: [
        {
          instanceId: `${SUITE_ID}-unit-selachai`,
          name: 'Selachai',
          maxHp: 45,
          currentHp: 45,
          dexMod: 2,
          initiative: 15,
          isPlayer: false,
          position: { x: 15, y: 10 }
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

test.describe('Map Grid Alignment and Integration Suite', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: mapGridSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: mapGridSeed });
    await setupApp(page);
  });

  test('Combat Map scales grid to battlemap dimensions with aligned backdrop and art toggle', async ({ page, context }) => {
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

    // Heading reflects true detected battlemap dimensions (33x21 cells = 165x105 ft)
    const mapHeading = encounterPage.getByRole('heading', { name: /Combat Map \(165x105 ft\)/ });
    await expect(mapHeading).toBeVisible();

    // ARIA Grid verifies 21 rows and 33 columns
    const grid = encounterPage.getByRole('grid', { name: 'Combat Map' });
    await expect(grid).toHaveAttribute('aria-rowcount', '21');
    await expect(grid).toHaveAttribute('aria-colcount', '33');

    // Check last column header exists (33rd column is AG)
    const colAG = encounterPage.locator('th').filter({ hasText: 'AG' });
    await expect(colAG).toBeAttached();

    // Verify backdrop element exists and has aligned background styling
    const backdrop = encounterPage.locator('.combat-map-section [aria-hidden="true"]').filter({
      has: encounterPage.locator('xpath=self::div[contains(@style, "background-image")]')
    }).first();
    await expect(backdrop).toBeVisible();

    // Verify art toggle button is available for DM vs Player view
    const artToggleBtn = encounterPage.getByRole('button', { name: /Art: DM View/ });
    await expect(artToggleBtn).toBeVisible();
    await artToggleBtn.click();

    // Toggle switched to Player View
    await expect(encounterPage.getByRole('button', { name: /Art: Player View/ })).toBeVisible();

    // Focus board using Alt+B and navigate
    await encounterPage.keyboard.press('Alt+b');
    const cellA1 = encounterPage.locator('[data-cell="0-0"]');
    await expect(cellA1).toBeFocused();

    // Navigate to creature token at (5, 5) -> F6
    await encounterPage.keyboard.press('Alt+j');
    const jumpHeading = encounterPage.getByRole('heading', { name: 'Jump to Creature' });
    await expect(jumpHeading).toBeVisible();
    await expect(jumpHeading).toBeFocused();

    // Jump to Sahuagin Raider
    const sahuaginJump = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Sahuagin Raider/ }).first();
    await sahuaginJump.click();
    await expect(jumpHeading).not.toBeVisible();

    // Focused cell is now the creature's cell with Sahuagin Raider token
    const tokenCell = encounterPage.locator('td[role="gridcell"]:focus');
    await expect(tokenCell).toBeVisible();
    await expect(tokenCell).toHaveAttribute('aria-label', /Sahuagin Raider/);

    // Axe accessibility scan
    await checkA11y(encounterPage, 'Combat Map with Aligned Battlemap Art');

    await encounterPage.close();
  });

  test('Combat Map identifies and announces irregular semantic regions on navigation, jump, and radar', async ({ page, context }) => {
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

    // 1. Verify Ocean cell at (0, 0)
    const oceanCell = encounterPage.locator('[data-cell="0-0"]');
    await expect(oceanCell).toHaveAttribute('aria-label', /Lucidian Ocean/);

    // 2. Verify Northern Bridge (P5) at column 17, row 1 (R2)
    const bridgeCell = encounterPage.locator('[data-cell="17-1"]');
    await expect(bridgeCell).toHaveAttribute('aria-label', /Northern Bridge - P5/);

    // 3. Verify Walled Manor & Fountain (P7) at column 22, row 4 (W5)
    const manorCell = encounterPage.locator('[data-cell="22-4"]');
    await expect(manorCell).toHaveAttribute('aria-label', /Walled Manor & Fountain - P7/);

    // 4. Verify Harbor Docks (P8) at column 26, row 7 (AA8)
    const dockCell = encounterPage.locator('[data-cell="26-7"]');
    await expect(dockCell).toHaveAttribute('aria-label', /Harbor Docks & Wavechaser - P8/);

    // 5. Verify Jump to Creature displays the creature's region (West Shore & Cottages - P2)
    await encounterPage.keyboard.press('Alt+j');
    const jumpModal = encounterPage.getByRole('dialog', { name: 'Jump to Creature' });
    await expect(jumpModal).toBeVisible();
    await expect(jumpModal.getByText(/West Shore & Cottages - P2/)).toBeVisible();
    await encounterPage.keyboard.press('Escape');
    await expect(jumpModal).not.toBeVisible();

    // 6. Verify Radar scan displays region names
    const radarBtn = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await expect(radarBtn).toBeVisible();
    await radarBtn.click();
    const radarModal = encounterPage.getByRole('dialog', { name: 'Nearby Entities (Radar)' });
    await expect(radarModal).toBeVisible();
    await expect(radarModal.getByText(/West Shore & Cottages - P2/)).toBeVisible();
    await encounterPage.keyboard.press('Escape');
    await expect(radarModal).not.toBeVisible();

    // 7. Check Axe accessibility scan
    await checkA11y(encounterPage, 'Combat Map with Irregular Semantic Regions');

    await encounterPage.close();
  });

  test('Jump to Region dialog orders regions by location, displays center points, teleports focus, and passes Axe scan', async ({ page, context }) => {
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

    // 1. Check toolbar button is present
    const regionJumpBtn = encounterPage.getByRole('button', { name: 'Jump to Region (Alt+L)' });
    await expect(regionJumpBtn).toBeVisible();

    // 2. Open via toolbar button
    await regionJumpBtn.click();

    // 3. Verify dialog and heading focus
    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();
    const heading = encounterPage.getByRole('heading', { name: 'Jump to Region' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();

    // 4. Verify regions are displayed with their center points and sectors
    const bridgeItem = regionModal.locator('li').filter({ hasText: 'Northern Bridge' });
    await expect(bridgeItem).toBeVisible();
    await expect(bridgeItem.getByText(/Center: R2/)).toBeVisible();
    await expect(bridgeItem.getByText(/Sector: North/)).toBeVisible();

    await expect(regionModal.getByText(/Walled Manor & Fountain/)).toBeVisible();
    await expect(regionModal.getByText(/Harbor Docks & Wavechaser/)).toBeVisible();

    // 5. Verify regions appear in geographic order: Northern Bridge (Row 2, North) should precede Harbor Docks (Row 8, East)
    const optionTexts = await regionModal.locator('li button strong').allTextContents();
    const bridgeIndex = optionTexts.findIndex(t => t.includes('Northern Bridge'));
    const docksIndex = optionTexts.findIndex(t => t.includes('Harbor Docks'));
    expect(bridgeIndex).toBeGreaterThanOrEqual(0);
    expect(docksIndex).toBeGreaterThanOrEqual(0);
    expect(bridgeIndex).toBeLessThan(docksIndex);

    // 6. Run Axe accessibility scan on open modal
    await checkA11y(encounterPage, 'Jump to Region Modal');

    // 7. Verify Escape key closes modal and restores focus to trigger button
    await encounterPage.keyboard.press('Escape');
    await expect(regionModal).not.toBeVisible();
    await expect(regionJumpBtn).toBeFocused();

    // 8. Re-open via keyboard shortcut Alt+L and teleport to Northern Bridge
    await encounterPage.keyboard.press('Alt+l');
    await expect(regionModal).toBeVisible();

    const bridgeOption = regionModal.locator('button').filter({ hasText: /Northern Bridge/ });
    await bridgeOption.click();

    // 9. Modal closes and focus is teleported to cell R2 (17, 1)
    await expect(regionModal).not.toBeVisible();
    const targetCell = encounterPage.locator('[data-cell="17-1"]');
    await expect(targetCell).toBeFocused();
    await expect(targetCell).toHaveAttribute('aria-label', /Northern Bridge - P5/);

    await encounterPage.close();
  });

  test('Wavechaser (Map 5.2) segments upper and lower decks and enables region jump across ship compartments', async ({ page, context }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Map 5\.2: Wavechaser/ }).click()
    ]);
    await encounterPage.waitForLoadState();

    // Start combat
    const startBtn = encounterPage.getByRole('button', { name: 'Start Combat' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await expect(startBtn).not.toBeVisible();

    // 1. Weather Deck Forecastle at (7, 3) -> H4
    const foreCell = encounterPage.locator('[data-cell="7-3"]');
    await expect(foreCell).toHaveAttribute('aria-label', /Forecastle & Bowsprit - W-FORE/);

    // 2. Below Deck Captain's Cabin at (23, 17) -> X18
    const captCell = encounterPage.locator('[data-cell="23-17"]');
    await expect(captCell).toHaveAttribute('aria-label', /Captain's Cabin \(Three Earrings\) - W-CAPT/);

    // 3. Open Jump to Region
    const regionJumpBtn = encounterPage.getByRole('button', { name: 'Jump to Region (Alt+L)' });
    await expect(regionJumpBtn).toBeVisible();
    await regionJumpBtn.click();

    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();
    await expect(regionModal.getByRole('heading', { name: 'Jump to Region' })).toBeFocused();

    // 4. Verify ship compartments are displayed
    await expect(regionModal.getByText(/Forecastle & Bowsprit/)).toBeVisible();
    await expect(regionModal.getByText(/Quarterdeck, Helm & Ballistae/)).toBeVisible();
    await expect(regionModal.getByText(/Captain's Cabin \(Three Earrings\)/)).toBeVisible();

    // 5. Run Axe scan
    await checkA11y(encounterPage, 'Wavechaser Map with Ship Compartments');

    // 6. Teleport to Captain's Cabin
    const captBtn = regionModal.locator('button').filter({ hasText: /Captain's Cabin/ });
    await captBtn.click();
    await expect(regionModal).not.toBeVisible();

    const targetCell = encounterPage.locator('[data-cell="23-17"]');
    await expect(targetCell).toBeFocused();
    await expect(targetCell).toHaveAttribute('aria-label', /Captain's Cabin \(Three Earrings\) - W-CAPT/);

    await encounterPage.close();
  });

  test('Ruined Palma Flora (Map 5.3) segments sunken trench regions and enables region jump', async ({ page, context }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    const [encounterPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /Run Map 5\.3: Ruined Palma Flora/ }).click()
    ]);
    await encounterPage.waitForLoadState();

    // Start combat
    const startBtn = encounterPage.getByRole('button', { name: 'Start Combat' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await expect(startBtn).not.toBeVisible();

    // 1. Verify Northern Bridge Ruins at (15, 1) -> P2
    const bridgeCell = encounterPage.locator('[data-cell="15-1"]');
    await expect(bridgeCell).toHaveAttribute('aria-label', /Northern Bridge Ruins - P5/);

    // 2. Verify Central Plaza & Statue of Kord ritual site at (15, 9) -> P10
    const plazaCell = encounterPage.locator('[data-cell="15-9"]');
    await expect(plazaCell).toHaveAttribute('aria-label', /Central Plaza & Statue of Kord - P10/);

    // 3. Open Jump to Region via Alt+L
    await encounterPage.keyboard.press('Alt+l');
    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();

    await expect(regionModal.getByText(/Northern Bridge Ruins/)).toBeVisible();
    await expect(regionModal.getByText(/Central Plaza & Statue of Kord/)).toBeVisible();

    // 4. Run Axe scan
    await checkA11y(encounterPage, 'Ruined Palma Flora Map with Sunken Trench Regions');

    // 5. Teleport to Central Plaza
    const plazaOption = regionModal.locator('button').filter({ hasText: /Central Plaza & Statue of Kord/ });
    await plazaOption.click();
    await expect(regionModal).not.toBeVisible();

    const targetPlaza = encounterPage.locator('[data-cell="15-9"]');
    await expect(targetPlaza).toBeFocused();
    await expect(targetPlaza).toHaveAttribute('aria-label', /Central Plaza & Statue of Kord - P10/);

    await encounterPage.close();
  });
});
