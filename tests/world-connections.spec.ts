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
    const addRelationBtn = connSection.getByRole('button', { name: 'Add Connection' });
    await addRelationBtn.click();
    const relationDialog = page.getByRole('dialog', { name: /Add Connection for Elminster/ });
    await expect(relationDialog.getByRole('heading', { name: /Add Connection for Elminster/ })).toBeFocused();
    await checkA11y(page, 'Add Connection Modal');
    await relationDialog.getByLabel('Relationship:').fill('is located in');
    await relationDialog.getByLabel('Target Asset:').selectOption({ label: 'Waterdeep' });
    await relationDialog.getByRole('button', { name: 'Add Connection' }).click();
    await expect(relationDialog).toBeHidden();
    await expect(addRelationBtn).toBeFocused();

    // Verify connection is displayed on Elminster
    await expect(connSection.locator('li', { hasText: 'is located in Waterdeep (Location)' })).toBeVisible();

    // Close Elminster details modal
    await page.getByRole('button', { name: 'Close (Esc)' }).click();

    // 3. Open Waterdeep details modal and verify reverse connection is displayed
    await page.getByRole('button', { name: 'Waterdeep', exact: false }).click();
    
    const waterdeepConnSection = page.getByRole('dialog').locator('div').filter({ has: page.getByRole('heading', { name: 'Connections' }) }).first();
    await expect(waterdeepConnSection).toBeVisible();
    await expect(waterdeepConnSection.locator('li', { hasText: 'contains Elminster (NPC)' })).toBeVisible();

    // 4. Remove connection from Waterdeep side
    const optionsBtn = waterdeepConnSection.getByRole('button', { name: /^Options for / });
    await optionsBtn.click();
    const optionsDialog = page.getByRole('dialog', { name: /^Options for / });
    await expect(optionsDialog.getByRole('heading', { name: /Options for/ })).toBeFocused();
    await checkA11y(page, 'Connection Options Modal');

    // The reverse label was derived automatically; customize both directions
    await expect(optionsDialog.getByLabel(/^Relationship: Elminster to Waterdeep/)).toHaveValue('is located in');
    await expect(optionsDialog.getByLabel(/^Reverse relationship: Waterdeep to Elminster/)).toHaveValue('contains');
    await optionsDialog.getByLabel(/^Relationship: Elminster to Waterdeep/).fill('hates');
    await optionsDialog.getByLabel(/^Reverse relationship: Waterdeep to Elminster/).fill('is hated by');

    // Add a description, then reopen to confirm it was saved
    await optionsDialog.getByLabel('Connection Description:').fill('Has lived there for decades');
    await optionsDialog.getByRole('button', { name: 'Save' }).click();
    await expect(optionsDialog).toBeHidden();
    await expect(optionsBtn).toBeFocused();
    await expect(waterdeepConnSection.locator('li', { hasText: 'is hated by Elminster (NPC)' })).toBeVisible();
    await expect(waterdeepConnSection.locator('li', { hasText: 'Has lived there for decades' })).toBeVisible();

    // Escape closes only the options modal and restores focus
    await optionsBtn.click();
    await page.keyboard.press('Escape');
    await expect(optionsDialog).toBeHidden();
    await expect(optionsBtn).toBeFocused();
    await expect(waterdeepConnSection).toBeVisible();

    await optionsBtn.click();
    await optionsDialog.getByRole('button', { name: 'Delete Connection' }).click();
    
    // Connection should disappear from Waterdeep
    await expect(waterdeepConnSection.locator('li', { hasText: 'contains Elminster (NPC)' })).not.toBeVisible();

    // Close Waterdeep details modal
    await page.getByRole('button', { name: 'Close (Esc)' }).click();

    // Verify connection disappeared from Elminster side as well
    await page.getByRole('button', { name: 'Elminster', exact: false }).click();
    const finalElminsterConnSection = page.getByRole('dialog').locator('div').filter({ has: page.getByRole('heading', { name: 'Connections' }) }).first();
    await expect(finalElminsterConnSection.locator('li', { hasText: 'is located in Waterdeep (Location)' })).not.toBeVisible();
  });
});
