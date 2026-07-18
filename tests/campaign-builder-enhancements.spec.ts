import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

const SUITE_ID = 'enhancements-suite';

const setupApp = async (page: Page) => {
  const seedData = {
    id: SUITE_ID,
    name: 'Enhancements Test Campaign',
    description: 'Testing smart sorting and cascading delete',
    players: [],
    chapters: [
      { id: 'chap-1', title: 'Chapter 1', content: 'See @Asset[asset-B]{Asset B}', order: 0 },
      { id: 'chap-2', title: 'Chapter 2', content: 'See @Asset[asset-C]{Asset C}', order: 1 },
      { id: 'chap-3', title: 'Chapter 3', content: 'Empty', order: 2 }
    ],
    assets: [
      { id: 'asset-A', name: 'Asset A', type: 'NPC', description: 'Associated with Chap 1', chapterIds: ['chap-1'] },
      { id: 'asset-B', name: 'Asset B', type: 'Location', description: 'Referenced in Chap 1', chapterIds: ['chap-1'] },
      { id: 'asset-C', name: 'Asset C', type: 'Item', description: 'Referenced in Chap 2', chapterIds: ['chap-2'] },
      { id: 'asset-D', name: 'Asset D', type: 'Spell', description: 'Global Asset', chapterIds: [] },
      { id: 'asset-E', name: 'Asset E', type: 'NPC', description: 'Shared Asset', chapterIds: ['chap-1', 'chap-2'] }
    ],
    encounters: [
      { id: 'enc-1', name: 'Enc 1', units: [], chapterIds: ['chap-1'] },
      { id: 'enc-2', name: 'Enc 2', units: [], chapterIds: ['chap-1', 'chap-2'] }
    ]
  };

  // Seed data via API first (consistent with other tests)
  const apiBase = 'http://localhost:3005/api';
  await page.request.post(`${apiBase}/campaigns`, { data: seedData });

  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);

  await page.goto('/');
  await page.waitForSelector('header');
};

test.describe('Campaign Builder Enhancements', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Smart Sorting in All Assets View', async ({ page }) => {
    await page.getByRole('button', { name: 'All Assets' }).click();

    const assetList = page.locator('section').filter({ hasText: 'Manage Assets' }).locator('li');
    const assetNames = await assetList.allInnerTexts();
    
    // Expected Order:
    // 1. Asset B (Referenced in Chap 1 text)
    // 2. Asset A (Associated with Chap 1)
    // 3. Asset E (Shared with Chap 1 - first appearance)
    // 4. Asset C (Referenced in Chap 2 text)
    // 5. Asset D (Global)
    
    // We check the start of the strings since they contain type and toggle icons
    expect(assetNames[0]).toContain('Asset B');
    expect(assetNames[1]).toContain('Asset A');
    expect(assetNames[2]).toContain('Asset E');
    expect(assetNames[3]).toContain('Asset C');
    expect(assetNames[4]).toContain('Asset D');
    
    // Verify "Manage Chapters" is NOT present in this view
    await expect(page.getByRole('heading', { name: 'Manage Chapters' })).not.toBeVisible();
  });

  test('Chapter Options Modal & Cascading Delete', async ({ page }) => {
    // 1. Verify "Chapter Options" button exists and opens modal
    const trigger = page.getByRole('button', { name: 'Chapter Options' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const modalHeading = page.getByRole('heading', { name: 'Chapter Options' });
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toBeFocused();
    await checkA11y(page, 'Chapter Options Modal');

    // 2. Test focus restoration on Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(modalHeading).not.toBeVisible();
    await expect(trigger).toBeFocused();

    // 3. Test "Edit Chapter" from options
    await trigger.click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Chapter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edit Chapter' })).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // 4. Test Cascading Delete
    // Assets associated with Chapter 1: Asset A (exclusive), Asset B (exclusive), Asset E (shared)
    // Encounters associated with Chapter 1: Enc 1 (exclusive), Enc 2 (shared)
    
    await trigger.click();
    page.on('dialog', dialog => dialog.accept()); // Handle confirmation
    await page.getByRole('button', { name: 'Delete Chapter' }).click();

    // Verify Chapter 1 is gone
    await expect(page.locator('#chapter-select')).not.toContainText('Chapter 1');
    
    // Switch to All Assets view to verify deletions
    await page.getByRole('button', { name: 'All Assets' }).click();
    
    const assetSection = page.locator('section').filter({ hasText: 'Manage Assets' });
    await expect(assetSection).not.toContainText('Asset A');
    await expect(assetSection).not.toContainText('Asset B');
    await expect(assetSection).toContainText('Asset C');
    await expect(assetSection).toContainText('Asset D');
    await expect(assetSection).toContainText('Asset E'); // Shared, should remain

    const encounterSection = page.locator('section').filter({ hasText: 'Manage Encounters' });
    await expect(encounterSection).not.toContainText('Enc 1');
    await expect(encounterSection).toContainText('Enc 2'); // Shared, should remain
  });
});
