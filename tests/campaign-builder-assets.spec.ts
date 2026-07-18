import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const SUITE_ID = 'asset-management-suite';

const seedData = {
  id: SUITE_ID,
  name: 'Asset Management Campaign',
  description: 'Testing asset viewer and editing',
  players: [],
  chapters: [
    { id: 'chap-1', title: 'Chapter 1', content: 'See @Asset[custom-npc]{My NPC}', order: 0 }
  ],
  assets: [
    { id: 'custom-npc', name: 'My NPC', type: 'NPC', description: 'This is a custom description', chapterIds: ['chap-1'] },
    { id: 'scraped-npc', name: 'Scraped NPC', type: 'NPC', description: 'Scraped from D&D Beyond', chapterIds: ['chap-1'] },
    { id: 'spell-asset', name: 'Custom Fire Blast', type: 'Spell', description: 'Custom notes on fireball', chapterIds: ['chap-1'] }
  ],
  encounters: []
};

test.describe('Asset Management and Viewer', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    // Reset to ensure isolation from other suites in the same worker run
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: seedData });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);

    await page.goto('/');
    await page.waitForSelector('header');
    // Ensure app is hydrated and correct campaign is loaded
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
    await expect(page.locator('header')).toContainText('Campaign: Asset Management Campaign');
  });

  test('should open viewer when clicking asset and show Edit button', async ({ page }) => {
    // 1. Click asset in Chapter Assets list
    const assetBtn = page.getByRole('button', { name: 'My NPC (NPC)' });
    await expect(assetBtn).toBeVisible();
    await assetBtn.click();

    // 2. Verify viewer modal opens
    const viewerHeading = page.getByRole('heading', { name: 'My NPC (NPC)' });
    await expect(viewerHeading).toBeVisible();
    await expect(viewerHeading).toBeFocused();
    
    // 3. Verify Edit Asset button is present
    const editBtn = page.getByRole('button', { name: 'Edit Asset' });
    await expect(editBtn).toBeVisible();

    // 4. Verify Notes section
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(page.getByText('This is a custom description')).toBeVisible();

    await checkA11y(page, 'Asset Viewer Modal');
  });

  test('should not show Notes section for scraped content', async ({ page }) => {
    await page.getByRole('button', { name: 'Scraped NPC (NPC)' }).click();
    await expect(page.getByRole('heading', { name: 'Notes' })).not.toBeVisible();
    await expect(page.getByText('Scraped from D&D Beyond')).not.toBeVisible();
  });

  test('should transition from Viewer to Edit Form and back', async ({ page }) => {
    await page.getByRole('button', { name: 'My NPC (NPC)' }).click();
    await page.getByRole('button', { name: 'Edit Asset' }).click();

    // Verify Edit Form opens
    const editHeading = page.getByRole('heading', { name: 'Edit Asset' });
    await expect(editHeading).toBeVisible();
    await expect(editHeading).toBeFocused();

    // Change name
    await page.getByLabel('Asset Name').fill('Updated NPC');
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify form closes and list updates
    await expect(editHeading).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Updated NPC (NPC)' })).toBeVisible();
  });

  test('should show notes for Spells with custom descriptions', async ({ page }) => {
    await page.getByRole('button', { name: 'Custom Fire Blast (Spell)' }).click();
    
    // Custom Fire Blast matches our custom asset, fallback view is used
    await expect(page.getByRole('heading', { name: /Custom Fire Blast \(Spell\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(page.getByText('Custom notes on fireball')).toBeVisible();
  });
});
