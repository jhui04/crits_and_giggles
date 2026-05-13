import { test, expect, Page, Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Seed data
const monstersData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/monsters.json'), 'utf-8'));
const mockMonster = monstersData[0]; 

const seedState = {
  id: 'test-campaign',
  name: 'Test Campaign',
  description: 'Test',
  chapters: [
    {
      id: 'chap-1',
      title: 'Chapter 1',
      content: 'Hello world',
      order: 0
    }
  ],
  assets: [],
  encounters: [
    {
      id: 'test-encounter',
      name: 'Test Encounter',
      units: [
        {
          instanceId: 'unit-1',
          monsterId: mockMonster.id,
          name: mockMonster.name,
          maxHp: 10,
          currentHp: 10,
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          passivePerception: 12,
          isPlayer: false,
          fullData: mockMonster
        },
        {
          instanceId: 'player-1',
          name: 'Player 1',
          dexMod: 3,
          initiative: 18,
          passivePerception: 15,
          isPlayer: true
        }
      ]
    }
  ]
};

test.describe('Oracle Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((seededData) => {
      localStorage.setItem('crits_campaigns', JSON.stringify([seededData]));
      localStorage.setItem('crits_active_campaign', seededData.id);
    }, seedState);
    await page.goto('/');
  });

  test('Oracle opens, search works, and focus management is correct', async ({ page }) => {
    // 1. Open Oracle
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await expect(oracle).toBeVisible();

    // 2. Check focus on heading
    const heading = oracle.locator('#oracle-title');
    await expect(heading).toBeFocused();

    // 3. Search for "Aid"
    const searchInput = page.locator('#oracle-search');
    await searchInput.fill('Aid');
    
    // Wait for filtered results
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('Aid');

    // 4. Open Detail Modal
    const aidButton = results.filter({ hasText: 'Aid' }).first();
    const originalId = await aidButton.evaluate(node => {
        if (!node.id) node.id = 'aid-result-btn';
        return node.id;
    });
    
    await aidButton.click();

    const detailModal = page.locator('[role="dialog"][aria-labelledby="detail-title"]');
    await expect(detailModal).toBeVisible();
    await expect(detailModal.locator('#detail-title')).toContainText('Aid');

    // 5. Check focus on detail heading
    await expect(detailModal.locator('#detail-title')).toBeFocused();

    // 6. Close Detail Modal with Escape
    await page.keyboard.press('Escape');
    await expect(detailModal).not.toBeVisible();

    // 7. Check focus restoration to the result button
    await expect(aidButton).toBeFocused();

    // 8. Close Oracle with Escape
    await page.keyboard.press('Escape');
    await expect(oracle).not.toBeVisible();
  });

  test('Oracle type filter updates results', async ({ page }) => {
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    
    // Switch to Spells Only
    await page.locator('#oracle-filter').selectOption('spell');
    
    // Check that results contain [SPELL]
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('[SPELL]');
    
    // Search for a monster name that shouldn't appear
    await page.locator('#oracle-search').fill('Aboleth');
    await expect(page.locator('text=No results found.')).toBeVisible();
  });
});
