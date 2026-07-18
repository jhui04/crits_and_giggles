import { test, expect, Page } from '@playwright/test';
import { checkA11y, navigateToChangeWorld, closeCampaignSettingsAfterWorldSelect } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'world-connections-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
};

test.describe('World Asset Connections E2E and A11y', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    
    // Seed a world with two assets: Elminster (NPC) and Waterdeep (Location)
    const testWorld = {
      id: 'conn-test-world',
      name: 'Connections Test World',
      description: 'A world for connection testing',
      assets: [
        {
          id: 'npc-elminster',
          type: 'NPC',
          name: 'Elminster',
          description: 'Sage of Shadowdale.',
          tags: ['wizard'],
          connections: []
        },
        {
          id: 'loc-waterdeep',
          type: 'Location',
          name: 'Waterdeep',
          description: 'City of Splendors.',
          tags: ['city'],
          connections: []
        }
      ]
    };
    const res = await request.post(`${apiBase}/worlds`, { data: testWorld });
    if (!res.ok()) throw new Error(`Failed to seed world: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    // Select the seeded world via the shared helper
    await navigateToChangeWorld(page);
    await page.getByRole('button', { name: 'Connections Test World' }).first().click();
    await closeCampaignSettingsAfterWorldSelect(page);
    // Switch to World Tab
    await page.getByRole('button', { name: 'World', exact: true }).click();
  });

  test('should create bidirectional connections and remove them correctly', async ({ page }) => {
    // 1. Click Elminster to open details modal
    await page.getByRole('button', { name: 'Elminster', exact: false }).click();
    
    const connSection = page.getByRole('dialog').locator('div').filter({ has: page.getByRole('heading', { name: 'Connections' }) }).first();
    await expect(connSection).toBeVisible();

    // Check accessibility of details modal
    await checkA11y(page, 'World Asset Details Modal');

    // 2. Add connection: "is located in" -> Waterdeep
    await connSection.getByLabel('Relationship:').fill('is located in');
    await connSection.getByLabel('Target Asset:').selectOption({ label: 'Waterdeep' });
    await connSection.getByRole('button', { name: 'Add Connection' }).click();

    // Verify connection is displayed on Elminster
    await expect(connSection.locator('li', { hasText: '"is located in" → Waterdeep (Location)' })).toBeVisible();

    // Close Elminster details modal
    await page.getByRole('button', { name: 'Close (Esc)' }).click();

    // 3. Open Waterdeep details modal and verify reverse connection is displayed
    await page.getByRole('button', { name: 'Waterdeep', exact: false }).click();
    
    const waterdeepConnSection = page.getByRole('dialog').locator('div').filter({ has: page.getByRole('heading', { name: 'Connections' }) }).first();
    await expect(waterdeepConnSection).toBeVisible();
    await expect(waterdeepConnSection.locator('li', { hasText: 'Elminster (NPC) "is located in" → this' })).toBeVisible();

    // 4. Remove connection from Waterdeep side
    await waterdeepConnSection.getByRole('button', { name: 'Remove connection: Elminster is located in to this' }).click();
    
    // Connection should disappear from Waterdeep
    await expect(waterdeepConnSection.locator('li', { hasText: 'Elminster (NPC) "is located in" → this' })).not.toBeVisible();

    // Close Waterdeep details modal
    await page.getByRole('button', { name: 'Close (Esc)' }).click();

    // Verify connection disappeared from Elminster side as well
    await page.getByRole('button', { name: 'Elminster', exact: false }).click();
    const finalElminsterConnSection = page.getByRole('dialog').locator('div').filter({ has: page.getByRole('heading', { name: 'Connections' }) }).first();
    await expect(finalElminsterConnSection.locator('li', { hasText: '"is located in" → Waterdeep (Location)' })).not.toBeVisible();
  });
});
