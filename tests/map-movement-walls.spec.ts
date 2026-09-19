import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const MOVEMENT_SUITE_ID = 'map-movement-walls-suite';

const movementSeed = {
  id: MOVEMENT_SUITE_ID,
  name: 'Palma Flora Wall Movement Campaign',
  description: 'Test campaign verifying radar pathfinding around walls and arrow-key wall blocking with Ctrl bypass',
  chapters: [
    { id: 'chap-move-1', title: 'Chapter 1', content: 'Invasion of Palma Flora', order: 0 }
  ],
  assets: [],
  players: [
    { id: 'player-move-1', name: 'Valeros', description: 'Fighter' }
  ],
  encounters: [
    {
      id: 'enc-move-radar',
      name: 'Radar Pathfinding Encounter',
      chapterIds: ['chap-move-1'],
      dmMapUrl: '/maps/5.1-palma-flora-player.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 33, height: 21 },
      units: [
        {
          instanceId: 'unit-valeros-radar',
          playerId: 'player-move-1',
          name: 'Valeros',
          dexMod: 1,
          initiative: 20,
          isPlayer: true,
          position: { x: 22, y: 1 } // North of Manor Stone Fence (cell W2)
        },
        {
          instanceId: 'unit-goblin-radar',
          name: 'Goblin Scout',
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          isPlayer: false,
          position: { x: 22, y: 4 } // Inside garden behind Manor Stone Fence (cell W5)
        }
      ]
    },
    {
      id: 'enc-move-arrow',
      name: 'Arrow Movement Wall Blocking Encounter',
      chapterIds: ['chap-move-1'],
      dmMapUrl: '/maps/5.1-palma-flora-player.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 33, height: 21 },
      units: [
        {
          instanceId: 'unit-valeros-arrow',
          playerId: 'player-move-1',
          name: 'Valeros',
          dexMod: 1,
          initiative: 20,
          isPlayer: true,
          position: { x: 22, y: 2 } // Immediately adjacent to North Manor Stone Fence (cell W3)
        },
        {
          instanceId: 'unit-goblin-arrow',
          name: 'Goblin Scout',
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          isPlayer: false,
          position: { x: 22, y: 4 } // Inside garden (cell W5)
        }
      ]
    }
  ]
};

test.describe('Tactical Map Movement & Wall Collisions', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: movementSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: movementSeed });
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, MOVEMENT_SUITE_ID);
  });

  test('Radar "Move Towards" calculates path around walls and avoids clipping through fence', async ({ page }) => {
    await page.goto('/?encounter=enc-move-radar');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('header');

    // Start combat
    const startBtn = page.getByRole('button', { name: 'Start Combat' });
    await startBtn.click();
    await expect(page.getByRole('heading', { name: 'Initiative Track' })).toBeVisible();

    // Focus combat board via Alt+B and open Radar via Alt+E
    await page.keyboard.press('Alt+b');
    await page.keyboard.press('Alt+e');

    // Verify Radar dialog opened
    const radarDialog = page.getByRole('dialog', { name: 'Nearby Entities (Radar)' });
    await expect(radarDialog).toBeVisible();

    // Click "Move towards Goblin Scout"
    const moveBtn = radarDialog.getByRole('button', { name: /Move towards Goblin Scout/ });
    await expect(moveBtn).toBeVisible();
    await moveBtn.click();

    // Verify Move Towards modal opened and heading is focused
    const moveModal = page.getByRole('dialog', { name: /Move Towards/ });
    await expect(moveModal).toBeVisible();
    const moveHeading = page.getByRole('heading', { name: /Move Towards Goblin Scout/ });
    await expect(moveHeading).toBeVisible();
    await expect(moveHeading).toBeFocused();

    // Accessibility check on Move Towards modal
    await checkA11y(page, 'Move Towards Modal with Path Around Walls');

    // Verify destination column is routed around the fence (not column W / index 22 directly through the fence)
    const colSelect = page.locator('#dest-col-select');
    await expect(colSelect).toBeVisible();
    const selectedColValue = await colSelect.inputValue();
    // Col 22 is W. Due to Manor Stone Fence blocking [22, 2] <-> [22, 3], pathfinder routes around it (e.g. col != 22)
    // or outcome avoids the direct blocked wall transition
    const outcomeStatus = page.locator('[role="status"]');
    await expect(outcomeStatus).toBeVisible();
    const outcomeText = await outcomeStatus.innerText();
    expect(outcomeText).toContain('Will move');

    // If destination column is not 22, it navigated laterally around fence
    // Or destination cell does not cross through [22,3] directly
    const rowSelect = page.locator('#dest-row-select');
    const selectedRowValue = await rowSelect.inputValue();
    // Confirm that it didn't just step straight into W4 if at column 22
    if (selectedColValue === '22') {
      expect(selectedRowValue).not.toBe('4');
    }

    // Confirm Move
    const confirmBtn = page.getByRole('button', { name: 'Confirm Move' });
    await confirmBtn.click();

    // Verify modals close and live announcement confirms placement
    await expect(moveModal).not.toBeVisible();
    await expect(radarDialog).not.toBeVisible();

    const liveRegion = page.locator('.combat-map-section .sr-only[aria-live="polite"]');
    await expect(liveRegion).toContainText('Valeros moved');
  });

  test('Arrow movement in Move Mode blocks moving through walls and allows Ctrl bypass', async ({ page }) => {
    await page.goto('/?encounter=enc-move-arrow');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('header');

    // Start combat
    const startBtn = page.getByRole('button', { name: 'Start Combat' });
    await startBtn.click();
    await expect(page.getByRole('heading', { name: 'Initiative Track' })).toBeVisible();

    // Focus combat board via Alt+B
    await page.keyboard.press('Alt+b');

    // Jump to Valeros
    const jumpButton = page.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const jumpDialog = page.getByRole('dialog', { name: 'Jump to Creature' });
    await expect(jumpDialog).toBeVisible();
    await jumpDialog.getByRole('button', { name: /Valeros/ }).click();
    await expect(jumpDialog).not.toBeVisible();

    // Press Enter on Valeros cell (W3, coordinate 22, 2) to open Action Menu
    await page.keyboard.press('Enter');
    const actionDialog = page.getByRole('dialog', { name: /Options/ });
    await expect(actionDialog).toBeVisible();

    // Select "Move on Map"
    const moveOnMapBtn = actionDialog.getByRole('button', { name: /Move on Map/ });
    await moveOnMapBtn.click();
    await expect(actionDialog).not.toBeVisible();

    // Move Mode status banner should appear
    await expect(page.getByRole('status')).toContainText('Moving Valeros');

    const liveRegion = page.locator('.combat-map-section .sr-only[aria-live="polite"]');

    // 1. Attempt to move South through Manor Stone Fence (from W3 / [22, 2] to W4 / [22, 3]) WITHOUT Ctrl
    await page.keyboard.press('ArrowDown');

    // Assert movement was blocked by Manor Stone Fence and instruction to hold Ctrl is announced
    await expect(liveRegion).toContainText('Cannot move through Manor Stone Fence. Hold Ctrl while pressing arrow keys to pass through.');

    // Verify focus remains on W3 ([22, 2])
    const focusedCell = page.locator('td[tabindex="0"]');
    await expect(focusedCell).toHaveAttribute('data-cell', '22-2');

    // 2. Move through Manor Stone Fence WITH Ctrl modifier
    await page.keyboard.down('Control');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Control');

    // Assert movement bypass was successful and announced
    await expect(liveRegion).toContainText('Moved Valeros through Manor Stone Fence (Ctrl bypass) to W4');

    // Verify focus advanced to W4 ([22, 3])
    await expect(focusedCell).toHaveAttribute('data-cell', '22-3');

    // 3. Confirm placement via Enter
    await page.keyboard.press('Enter');
    await expect(liveRegion).toContainText('Valeros placed at W4');

    // Move Mode is now deactivated
    await expect(page.getByRole('status')).not.toBeVisible();
  });
});
