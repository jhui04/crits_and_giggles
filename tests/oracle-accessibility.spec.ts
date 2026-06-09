import { test, expect } from '@playwright/test';
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
    // 1. Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await expect(oracle).toBeVisible();

    // 2. Check focus on search input
    const searchInput = page.locator('#monster-search');
    await expect(searchInput).toBeFocused();

    // 3. Search for "Aboleth"
    await searchInput.fill('Aboleth');
    
    // Wait for filtered results
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('Aboleth');

    // 4. Open Detail Modal
    const abolethButton = results.first();
    await abolethButton.click();

    const detailModal = page.locator('[role="dialog"] h3:has-text("Aboleth")');
    await expect(detailModal).toBeVisible();

    // 5. Check focus on detail heading
    await expect(detailModal).toBeFocused();

    // 6. Close Detail Modal with Escape
    await page.keyboard.press('Escape');
    await expect(detailModal).not.toBeVisible();

    // 7. Check focus restoration to the result button
    await expect(abolethButton).toBeFocused();

    // 8. Close Oracle with Escape
    await page.keyboard.press('Escape');
    await expect(oracle).not.toBeVisible();
  });

  test('Oracle type filter updates results', async ({ page }) => {
    // Open Oracle via Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('button:has-text("The Oracle")');

    const oracle = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    
    // Switch to Spells Only
    await page.selectOption('#oracle-type-filter', 'spell');
    
    // Search for a spell
    await page.locator('#spell-search').fill('Aid');
    const results = oracle.locator('ul li button');
    await expect(results.first()).toContainText('Aid');
    
    // Switch back to Monsters
    await page.selectOption('#oracle-type-filter', 'monster');
    await page.locator('#monster-search').fill('Aboleth');
    await expect(page.locator('text=Aboleth')).toBeVisible();
  });
});
