import fs from 'fs';
import path from 'path';
import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';
import { columnIndexToLabel, coordinateToLabel, getRegionCenter, getRegionSector, sortRegionsByLocation } from '../src/utils/mapUtils';
import type { MapRegion } from '../src/types';

const SUITE_ID = 'map-grid-integration-suite';
const baseSeed = getSeedState(SUITE_ID);

// The maps are compiled by tools/maps (public/data/maps). Expectations are read from the compiled files,
// so these tests check that regions and the grid reach the UI and are navigable, and keep working when
// the maps are rebuilt with better data.
interface CompiledMap {
  mapId: string;
  grid: { columns: number; rows: number };
  regions: Array<{ id: string; name: string; cells: string[] }>;
}

const loadMap = (file: string): CompiledMap =>
  JSON.parse(fs.readFileSync(path.resolve('public/data/maps', file), 'utf-8'));

const palma = loadMap('egtw-5.1-palma-flora.json');
const wavechaser = loadMap('egtw-5.2-wavechaser.json');
const ruined = loadMap('egtw-5.3-ruined-palma-flora.json');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function region(map: CompiledMap, id: string): MapRegion {
  const r = map.regions.find((x) => x.id === id);
  if (!r || r.cells.length === 0) throw new Error(`Compiled map ${map.mapId} has no cells for region ${id}`);
  return { id: r.id, name: r.name, cells: r.cells };
}

const centre = (map: CompiledMap, id: string) => getRegionCenter(region(map, id));
const cellSelector = (p: { x: number; y: number }) => `[data-cell="${p.x}-${p.y}"]`;
const regionLabel = (map: CompiledMap, id: string) => new RegExp(`${escapeRe(region(map, id).name)} - ${id}`);
const mapSizeOf = (map: CompiledMap) => ({ width: map.grid.columns, height: map.grid.rows });

const encounterFor = (id: string, name: string, map: CompiledMap, dm: string, player: string | undefined, units: unknown[]) => ({
  id,
  name,
  chapterIds: [`${SUITE_ID}-chap-1`],
  dmMapUrl: dm,
  ...(player ? { playerMapUrl: player } : {}),
  mapSize: mapSizeOf(map),
  units,
});

const west = centre(palma, 'P2');

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
    encounterFor('palma-flora-encounter', 'Map 5.1: Palma Flora', palma, '/maps/5.1-palma-flora.png', '/maps/5.1-palma-flora-player.png', [
      {
        instanceId: `${SUITE_ID}-unit-sahuagin`,
        monsterId: '17003',
        name: 'Sahuagin Raider',
        maxHp: 22,
        currentHp: 22,
        dexMod: 0,
        initiative: 12,
        isPlayer: false,
        position: west
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
        position: { x: west.x + 1, y: west.y }
      }
    ]),
    encounterFor('wavechaser-encounter', 'Map 5.2: Wavechaser', wavechaser, '/maps/5.2-wavechaser.png', undefined, [
      {
        instanceId: `${SUITE_ID}-unit-pirate`,
        name: 'Pirate Sailor',
        maxHp: 16,
        currentHp: 16,
        dexMod: 1,
        initiative: 14,
        isPlayer: false,
        position: centre(wavechaser, 'W-FORE')
      }
    ]),
    encounterFor('ruined-palma-encounter', 'Map 5.3: Ruined Palma Flora', ruined, '/maps/5.3-ruined-palma-flora.png', '/maps/5.3-ruined-palma-flora-player.png', [
      {
        instanceId: `${SUITE_ID}-unit-selachai`,
        name: 'Selachai',
        maxHp: 45,
        currentHp: 45,
        dexMod: 2,
        initiative: 15,
        isPlayer: false,
        position: centre(ruined, 'P10')
      }
    ])
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

/** Opens Run Mode, follows the link to an encounter, and starts combat on the new page. */
async function openEncounter(page: Page, context: import('@playwright/test').BrowserContext, linkName: RegExp) {
  await page.keyboard.press('Alt+m');
  await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

  const [encounterPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: linkName }).click()
  ]);
  await encounterPage.waitForLoadState();

  const startBtn = encounterPage.getByRole('button', { name: 'Start Combat' });
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(startBtn).not.toBeVisible();
  return encounterPage;
}

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
    const encounterPage = await openEncounter(page, context, /Run Map 5\.1: Palma Flora/);
    const { columns, rows } = palma.grid;

    // Heading reflects the compiled grid: one 5-foot square per cell
    const mapHeading = encounterPage.getByRole('heading', { name: new RegExp(`Combat Map \\(${columns * 5}x${rows * 5} ft\\)`) });
    await expect(mapHeading).toBeVisible();

    // ARIA grid has the compiled row and column counts
    const grid = encounterPage.getByRole('grid', { name: 'Combat Map' });
    await expect(grid).toHaveAttribute('aria-rowcount', String(rows));
    await expect(grid).toHaveAttribute('aria-colcount', String(columns));

    // The last column header exists
    const lastColumn = encounterPage.locator('th').filter({ hasText: columnIndexToLabel(columns - 1) });
    await expect(lastColumn.first()).toBeAttached();

    // Verify backdrop element exists and has aligned background styling
    const backdrop = encounterPage.locator('.combat-map-section [aria-hidden="true"]').filter({
      has: encounterPage.locator('xpath=self::div[contains(@style, "background-image")]')
    }).first();
    await expect(backdrop).toBeVisible();

    // Verify art toggle button is available for DM vs Player view
    const artToggleBtn = encounterPage.getByRole('button', { name: /Art: DM View/ });
    await expect(artToggleBtn).toBeVisible();
    await artToggleBtn.click();
    await expect(encounterPage.getByRole('button', { name: /Art: Player View/ })).toBeVisible();

    // Focus board using Alt+B and navigate
    await encounterPage.keyboard.press('Alt+b');
    const cellA1 = encounterPage.locator('[data-cell="0-0"]');
    await expect(cellA1).toBeFocused();

    // Jump to the creature token
    await encounterPage.keyboard.press('Alt+j');
    const jumpHeading = encounterPage.getByRole('heading', { name: 'Jump to Creature' });
    await expect(jumpHeading).toBeVisible();
    await expect(jumpHeading).toBeFocused();

    const sahuaginJump = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Sahuagin Raider/ }).first();
    await sahuaginJump.click();
    await expect(jumpHeading).not.toBeVisible();

    // Focused cell is now the creature's cell with the Sahuagin Raider token
    const tokenCell = encounterPage.locator('td[role="gridcell"]:focus');
    await expect(tokenCell).toBeVisible();
    await expect(tokenCell).toHaveAttribute('aria-label', /Sahuagin Raider/);

    await checkA11y(encounterPage, 'Combat Map with Aligned Battlemap Art');
    await encounterPage.close();
  });

  test('Combat Map identifies and announces book regions on navigation, jump, and radar', async ({ page, context }) => {
    const encounterPage = await openEncounter(page, context, /Run Map 5\.1: Palma Flora/);

    // 1. Cells inside three regions announce the region name and book key
    for (const id of ['P5', 'P7', 'P8']) {
      const cell = encounterPage.locator(cellSelector(centre(palma, id)));
      await expect(cell).toHaveAttribute('aria-label', regionLabel(palma, id));
    }

    // 2. Jump to Creature displays the creature's region (the seeded Sahuagin stands in West Shore, P2)
    await encounterPage.keyboard.press('Alt+j');
    const jumpModal = encounterPage.getByRole('dialog', { name: 'Jump to Creature' });
    await expect(jumpModal).toBeVisible();
    await expect(jumpModal.getByText(regionLabel(palma, 'P2')).first()).toBeVisible();
    await encounterPage.keyboard.press('Escape');
    await expect(jumpModal).not.toBeVisible();

    // 3. Radar scan displays region names
    const radarBtn = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await expect(radarBtn).toBeVisible();
    await radarBtn.click();
    const radarModal = encounterPage.getByRole('dialog', { name: 'Nearby Entities (Radar)' });
    await expect(radarModal).toBeVisible();
    await expect(radarModal.getByText(regionLabel(palma, 'P2')).first()).toBeVisible();
    await encounterPage.keyboard.press('Escape');
    await expect(radarModal).not.toBeVisible();

    await checkA11y(encounterPage, 'Combat Map with Book Regions');
    await encounterPage.close();
  });

  test('Jump to Region dialog orders regions by location, displays center points, teleports focus, and passes Axe scan', async ({ page, context }) => {
    const encounterPage = await openEncounter(page, context, /Run Map 5\.1: Palma Flora/);
    const size = mapSizeOf(palma);
    const bridge = region(palma, 'P5');
    const docks = region(palma, 'P8');

    // 1. Toolbar button, then dialog with the heading focused
    const regionJumpBtn = encounterPage.getByRole('button', { name: 'Jump to Region (Alt+L)' });
    await expect(regionJumpBtn).toBeVisible();
    await regionJumpBtn.click();

    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();
    const heading = encounterPage.getByRole('heading', { name: 'Jump to Region' });
    await expect(heading).toBeFocused();

    // 2. Regions show their center points and sectors, computed the same way the app does
    const bridgeItem = regionModal.locator('li').filter({ hasText: bridge.name }).first();
    await expect(bridgeItem).toBeVisible();
    const bridgeCentre = getRegionCenter(bridge);
    await expect(bridgeItem.getByText(`Center: ${coordinateToLabel(bridgeCentre)}`)).toBeVisible();
    await expect(bridgeItem.getByText(`Sector: ${getRegionSector(bridgeCentre, size)}`)).toBeVisible();
    await expect(regionModal.getByText(docks.name).first()).toBeVisible();

    // 3. Regions appear in map order (top to bottom, then left to right)
    const expectedOrder = sortRegionsByLocation([bridge, docks], size).map((r) => r.region.name);
    const optionTexts = await regionModal.locator('li button strong').allTextContents();
    const at = (name: string) => optionTexts.findIndex((t) => t.includes(name));
    expect(at(bridge.name)).toBeGreaterThanOrEqual(0);
    expect(at(docks.name)).toBeGreaterThanOrEqual(0);
    expect(at(expectedOrder[0])).toBeLessThan(at(expectedOrder[1]));

    await checkA11y(encounterPage, 'Jump to Region Modal');

    // 4. Escape closes the modal and restores focus to the trigger
    await encounterPage.keyboard.press('Escape');
    await expect(regionModal).not.toBeVisible();
    await expect(regionJumpBtn).toBeFocused();

    // 5. Reopen with Alt+L and teleport to the bridge
    await encounterPage.keyboard.press('Alt+l');
    await expect(regionModal).toBeVisible();
    await regionModal.locator('button').filter({ hasText: new RegExp(escapeRe(bridge.name)) }).first().click();

    await expect(regionModal).not.toBeVisible();
    const targetCell = encounterPage.locator(cellSelector(bridgeCentre));
    await expect(targetCell).toBeFocused();
    await expect(targetCell).toHaveAttribute('aria-label', regionLabel(palma, 'P5'));

    await encounterPage.close();
  });

  test('Wavechaser (Map 5.2) segments the ship into compartments and enables region jump', async ({ page, context }) => {
    const encounterPage = await openEncounter(page, context, /Run Map 5\.2: Wavechaser/);
    const capt = region(wavechaser, 'W-CAPT');

    // 1. Compartment cells announce their names
    await expect(encounterPage.locator(cellSelector(centre(wavechaser, 'W-FORE')))).toHaveAttribute('aria-label', regionLabel(wavechaser, 'W-FORE'));
    await expect(encounterPage.locator(cellSelector(centre(wavechaser, 'W-CAPT')))).toHaveAttribute('aria-label', regionLabel(wavechaser, 'W-CAPT'));

    // 2. Jump to Region lists the compartments
    const regionJumpBtn = encounterPage.getByRole('button', { name: 'Jump to Region (Alt+L)' });
    await expect(regionJumpBtn).toBeVisible();
    await regionJumpBtn.click();
    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();
    await expect(regionModal.getByRole('heading', { name: 'Jump to Region' })).toBeFocused();
    for (const id of ['W-FORE', 'W-STERN', 'W-CAPT']) {
      await expect(regionModal.getByText(region(wavechaser, id).name).first()).toBeVisible();
    }

    await checkA11y(encounterPage, 'Wavechaser Map with Ship Compartments');

    // 3. Teleport to the captain's cabin
    await regionModal.locator('button').filter({ hasText: new RegExp(escapeRe(capt.name)) }).first().click();
    await expect(regionModal).not.toBeVisible();
    const target = encounterPage.locator(cellSelector(centre(wavechaser, 'W-CAPT')));
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('aria-label', regionLabel(wavechaser, 'W-CAPT'));

    await encounterPage.close();
  });

  test('Ruined Palma Flora (Map 5.3) exposes its regions and enables region jump', async ({ page, context }) => {
    const encounterPage = await openEncounter(page, context, /Run Map 5\.3: Ruined Palma Flora/);
    const square = region(ruined, 'P10');

    // 1. Region cells announce the region name and key
    await expect(encounterPage.locator(cellSelector(centre(ruined, 'P5')))).toHaveAttribute('aria-label', regionLabel(ruined, 'P5'));
    await expect(encounterPage.locator(cellSelector(centre(ruined, 'P10')))).toHaveAttribute('aria-label', regionLabel(ruined, 'P10'));

    // 2. Jump to Region via Alt+L
    await encounterPage.keyboard.press('Alt+l');
    const regionModal = encounterPage.getByRole('dialog', { name: 'Jump to Region' });
    await expect(regionModal).toBeVisible();
    await expect(regionModal.getByText(region(ruined, 'P5').name).first()).toBeVisible();
    await expect(regionModal.getByText(square.name).first()).toBeVisible();

    await checkA11y(encounterPage, 'Ruined Palma Flora Map with Regions');

    // 3. Teleport to the central square
    await regionModal.locator('button').filter({ hasText: new RegExp(escapeRe(square.name)) }).first().click();
    await expect(regionModal).not.toBeVisible();
    const target = encounterPage.locator(cellSelector(centre(ruined, 'P10')));
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('aria-label', regionLabel(ruined, 'P10'));

    await encounterPage.close();
  });
});
