import { test, expect, Page } from '@playwright/test';
import { checkA11y, navigateToChangeWorld, closeCampaignSettingsAfterWorldSelect } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'world-builder-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
};

test.describe('World Builder Panel CRUD E2E and A11y', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    
    // Seed a world as well
    const testWorld = {
      id: 'builder-test-world',
      name: 'Builder Test World',
      description: 'A world for builder testing',
      assets: []
    };
    const res = await request.post(`${apiBase}/worlds`, { data: testWorld });
    if (!res.ok()) throw new Error(`Failed to seed world: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    // Select the seeded world via the shared helper
    await navigateToChangeWorld(page);
    await page.getByRole('button', { name: 'Builder Test World' }).first().click();
    await closeCampaignSettingsAfterWorldSelect(page);
  });

  test('should support tabs, adding, editing, deleting assets and filtering/searching', async ({ page }) => {
    // 1. Navigate to World tab and verify focus
    const tabWorld = page.getByRole('button', { name: 'World', exact: true });
    await expect(tabWorld).toBeVisible();
    await tabWorld.click();
    await expect(tabWorld).toHaveAttribute('aria-current', 'page');

    const panelWorldHeading = page.locator('#world-info-title');
    await expect(panelWorldHeading).toBeFocused();

    // Run axe check on the main WorldBuilder layout
    await checkA11y(page, 'World Builder View');

    // 2. Click Add World Asset
    const addAssetBtn = page.getByRole('button', { name: '+ Add World Asset' });
    await expect(addAssetBtn).toBeVisible();
    await addAssetBtn.click();

    // Form should focus the name input
    const assetFormName = page.getByLabel('Asset Name:');
    await expect(assetFormName).toBeFocused();

    // Create an NPC
    await page.getByLabel('Asset Type:').selectOption('NPC');
    await assetFormName.fill('Elminster');
    await page.getByLabel('Description:').fill('The Sage of Shadowdale.');
    await page.getByLabel('Tags (comma-separated):').fill('wizard, powerful, ally');

    await page.getByRole('button', { name: 'Create Asset' }).click();

    // Verify it appears in the list
    await expect(page.locator('li', { hasText: 'Elminster' })).toBeVisible();

    // 3. Edit Elminster
    const elminsterBtn = page.locator('ul[aria-label="World assets list"] > li').getByRole('button', { name: 'Elminster', exact: false });
    await elminsterBtn.click();

    // Details modal opens, check accessibility and heading focus
    const detailsHeading = page.getByRole('heading', { name: 'Elminster', level: 2 });
    await expect(detailsHeading).toBeFocused();
    await checkA11y(page, 'World Asset Details Modal');

    // Click Edit inside the modal
    await page.getByRole('button', { name: 'Edit Asset' }).click();
    await expect(page.getByLabel('Asset Name:')).toBeFocused();
    await page.getByLabel('Description:').fill('A very powerful Archmage.');
    await page.getByRole('button', { name: 'Update Asset' }).click();

    // Verify focus is restored to the list trigger button
    await expect(elminsterBtn).toBeFocused();
    
    // Open details again to verify description updated
    await elminsterBtn.click();
    await expect(page.getByText('A very powerful Archmage.')).toBeVisible();
    await page.getByRole('button', { name: 'Close (Esc)' }).click();

    // 4. Create another asset (Location) to test search and filters
    await addAssetBtn.click();
    await page.getByLabel('Asset Type:').selectOption('Location');
    await page.getByLabel('Asset Name:').fill('Waterdeep');
    await page.getByLabel('Description:').fill('The City of Splendors.');
    await page.getByRole('button', { name: 'Create Asset' }).click();

    // Verify both exist
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Elminster$/ }) })).toBeVisible();
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Waterdeep$/ }) })).toBeVisible();

    // Test Search input
    await page.getByLabel('Search assets:').fill('Water');
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Elminster$/ }) })).not.toBeVisible();
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Waterdeep$/ }) })).toBeVisible();

    // Clear Search, test Type Filter
    await page.getByLabel('Search assets:').fill('');
    await page.getByLabel('Filter by Type:').selectOption('NPC');
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Elminster$/ }) })).toBeVisible();
    await expect(page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Waterdeep$/ }) })).not.toBeVisible();

    // Reset filters
    await page.getByLabel('Filter by Type:').selectOption('All');

    // 5. Delete Waterdeep
    const waterdeepBtn = page.locator('ul[aria-label="World assets list"] > li').getByRole('button', { name: 'Waterdeep', exact: false });
    await waterdeepBtn.click();

    // Click Delete inside details modal
    await page.getByRole('button', { name: 'Delete Asset' }).click();

    // Confirms on second click (button text becomes "Confirm Delete")
    await page.getByRole('button', { name: 'Confirm Delete' }).click();
    
    await expect(waterdeepBtn).not.toBeVisible();
  });

  test('should support new asset types Faction, Race, Class, Background', async ({ page }) => {
    // Navigate to World tab
    await page.getByRole('button', { name: 'World', exact: true }).click();
    await page.getByRole('button', { name: '+ Add World Asset' }).click();

    const assetFormName = page.getByLabel('Asset Name:');
    const assetFormType = page.getByLabel('Asset Type:');

    // Verify all new options are present in the dropdown
    const options = await assetFormType.locator('option').allInnerTexts();
    expect(options).toContain('Faction');
    expect(options).toContain('Race');
    expect(options).toContain('Class');
    expect(options).toContain('Background');

    // Create a Faction
    await assetFormType.selectOption('Faction');
    await assetFormName.fill('Cerberus Assembly');
    await page.getByLabel('Description:').fill('A powerful cabal of mages.');
    await page.getByRole('button', { name: 'Create Asset' }).click();

    // Verify it appears in the list
    const factionItem = page.locator('ul[aria-label="World assets list"] > li').filter({ has: page.locator('strong', { hasText: /^Cerberus Assembly$/ }) });
    await expect(factionItem).toBeVisible();
    await expect(factionItem).toContainText('Faction');
  });
});
