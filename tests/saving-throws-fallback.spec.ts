import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const seedState = {
  id: 'test-campaign-saves',
  name: 'Test Campaign Saves',
  description: 'Test Description',
  chapters: [],
  assets: [],
  players: [],
  encounters: [
    {
      id: 'test-encounter',
      name: 'Test Encounter',
      units: [
        {
          instanceId: 'unit-1',
          name: 'Save Test Monster',
          maxHp: 10,
          currentHp: 10,
          hpDice: '2d6',
          dexMod: 2,
          initiative: 15,
          passivePerception: 12,
          isPlayer: false,
          fullData: {
            id: 'monster-1',
            name: 'Save Test Monster',
            meta: { size: 'Medium', type: 'humanoid', tags: [], alignment: 'Neutral' },
            attributes: { ac: { value: 10 }, hp: { value: 10, dice: '2d6' }, speeds: { walk: 30 } },
            stats: {
              STR: { score: 18, modifier: 4, save: 7 }, // Explicit save
              DEX: { score: 10, modifier: 0 },         // No save, fallback to 0
              CON: { score: 14, modifier: 2 },         // No save, fallback to 2
              INT: { score: 10, modifier: 0 },
              WIS: { score: 10, modifier: 0 },
              CHA: { score: 10, modifier: 0 }
            },
            skills: [],
            vulnerabilities: [],
            resistances: [],
            immunities: { damage: [], condition: [] },
            senses: [],
            languages: [],
            cr: '1',
            traits: [],
            actions: [],
            legendary_actions: [],
            reactions: []
          }
        }
      ]
    }
  ]
};

const setupApp = async (page: Page) => {
  await page.addInitScript((data) => {
    window.localStorage.setItem('crits_campaigns', JSON.stringify([data]));
    window.localStorage.setItem('crits_active_campaign', data.id);
  }, seedState);
  await page.goto('/');
  await page.waitForSelector('main');
};

test('Monster Saving Throws Fallback in Operations Modal', async ({ page }) => {
  await setupApp(page);
  await page.getByRole('button', { name: 'Switch to Run Mode' }).click();
  await page.getByRole('button', { name: 'Combat' }).click();
  await page.getByRole('button', { name: /Load "Test Encounter"/ }).click();
  await page.getByRole('button', { name: 'Start Combat' }).click();
  
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('button', { name: 'Saving Throws' }).click();

  // STR should show +7 (explicit)
  await expect(page.getByRole('button', { name: 'STR: +7' })).toBeVisible();
  
  // DEX should show +0 (fallback)
  await expect(page.getByRole('button', { name: 'DEX: +0' })).toBeVisible();
  
  // CON should show +2 (fallback)
  await expect(page.getByRole('button', { name: 'CON: +2' })).toBeVisible();

  await checkA11y(page, 'Monster Operations Saving Throws Fallback');
  
  // Test rolling one
  await page.getByRole('button', { name: 'CON: +2' }).click();
  await expect(page.getByRole('heading', { name: 'CON Save' })).toBeVisible();
  await expect(page.getByText(/Save Test Monster rolled CON Save:/)).toBeVisible();
});
