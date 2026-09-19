import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const COVER_SUITE_ID = 'map-cover-suite';

const coverSeed = {
  id: COVER_SUITE_ID,
  name: 'Palma Flora Tactical Cover Campaign',
  description: 'Test campaign verifying dynamic walls and cover detection',
  chapters: [
    { id: 'chap-cover-1', title: 'Chapter 1', content: 'Invasion of Palma Flora', order: 0 }
  ],
  assets: [],
  players: [
    { id: 'player-cover-1', name: 'Valeros', description: 'Fighter' }
  ],
  encounters: [
    {
      id: 'enc-cover-1',
      name: 'Skirmish at Walled Manor',
      chapterIds: ['chap-cover-1'],
      dmMapUrl: '/maps/5.1-palma-flora-player.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 33, height: 21 },
      units: [
        {
          instanceId: 'unit-valeros',
          playerId: 'player-cover-1',
          name: 'Valeros',
          dexMod: 1,
          initiative: 20,
          isPlayer: true,
          position: { x: 22, y: 1 } // North of Walled Manor outside fence
        },
        {
          instanceId: 'unit-goblin-manor',
          name: 'Goblin Scout',
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          isPlayer: false,
          position: { x: 22, y: 4 } // Inside garden behind Manor Stone Fence
        },
        {
          instanceId: 'unit-pirate-open',
          name: 'Pirate Scout',
          hpDice: '2d8',
          dexMod: 1,
          initiative: 12,
          isPlayer: false,
          position: { x: 24, y: 1 } // Open terrain north of Manor with clear line of sight
        },
        {
          instanceId: 'unit-orc-beach',
          name: 'Orc Raider',
          hpDice: '2d8+6',
          dexMod: 1,
          initiative: 10,
          isPlayer: false,
          position: { x: 18, y: 16 } // On South Shore beach across Manor House
        }
      ]
    }
  ]
};

test.describe('Tactical Map Walls & Dynamic Cover System', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: coverSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: coverSeed });
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, COVER_SUITE_ID);
  });

  test('Radar calculates and announces Half, Total, and No Cover across map structures', async ({ page }) => {
    await page.goto('/?encounter=enc-cover-1');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('header');

    // Start combat
    const startBtn = page.getByRole('button', { name: 'Start Combat' });
    await startBtn.click();
    await expect(page.getByRole('heading', { name: 'Initiative Track' })).toBeVisible();

    // Focus combat board via Alt+B and open Nearby Entities Radar via Alt+E
    await page.keyboard.press('Alt+b');
    await page.keyboard.press('Alt+e');

    // Verify Radar dialog opened and heading is focused
    const radarDialog = page.getByRole('dialog', { name: 'Nearby Entities (Radar)' });
    await expect(radarDialog).toBeVisible();
    const radarHeading = page.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(radarHeading).toBeVisible();
    await expect(radarHeading).toBeFocused();

    // 1. Verify Goblin Scout in radar has Half Cover behind Manor Stone Fence (+2 AC)
    const goblinItem = radarDialog.locator('li', { hasText: 'Goblin Scout' });
    await expect(goblinItem).toBeVisible();
    await expect(goblinItem).toContainText('Cover: Half Cover behind Manor Stone Fence (+2 AC)');

    // Verify Move Towards button has full accessible description with cover info
    const moveBtn = goblinItem.getByRole('button', { name: /Move towards Goblin Scout \(Half Cover behind Manor Stone Fence \(\+2 AC\)\)/ });
    await expect(moveBtn).toBeVisible();

    // 2. Verify Orc Raider on beach has Total Cover because the solid Manor House blocks line-of-sight
    const orcItem = radarDialog.locator('li', { hasText: 'Orc Raider' });
    await expect(orcItem).toBeVisible();
    await expect(orcItem).toContainText('Cover: Total Cover behind Manor House Wall (Line of sight blocked)');

    // 3. Verify Pirate Scout in open terrain has No Cover (no cover badge rendered)
    const pirateItem = radarDialog.locator('li', { hasText: 'Pirate Scout' });
    await expect(pirateItem).toBeVisible();
    await expect(pirateItem).not.toContainText('Cover:');

    // Run Axe accessibility scan on the Radar modal displaying cover information
    await checkA11y(page, 'Radar Modal with Cover Information');

    // Press Escape to close Radar and verify focus restoration
    await page.keyboard.press('Escape');
    await expect(radarHeading).not.toBeVisible();
  });
});
