import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';
import { checkA11y } from './utils/axe-helper';

const SUITE_ID = 'asset-insertion-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Asset Insertion Modal', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    // Ensure absolute isolation by resetting
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);

    await page.goto('/');
    // Verify we are in Campaign Builder
    await expect(page.getByRole('heading', { name: 'Campaign Builder' })).toBeVisible();
  });

  test('should trigger modal when typing @, manage focus, and set aria-hidden', async ({ page }) => {
    // Open chapter edit modal
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await textarea.type('Go to ');

    // Verify main content is NOT aria-hidden before opening modal
    // The main container in CampaignBuilder has aria-hidden={!!isAnyModalOpen}
    // When Edit Chapter modal is open, it IS aria-hidden.
    // So we check the state before and after.
    const mainContent = page.locator('div[aria-hidden="true"]').first();
    await expect(mainContent).toBeVisible();

    await page.keyboard.press('@');

    // Modal should be open
    const modal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    await expect(modal).toBeVisible();

    // Verify aria-hidden is true on the main content area (which contains 'Current Chapter' or 'Manage Assets')
    await expect(page.locator('div[aria-hidden="true"]').filter({ hasText: /Current Chapter|Manage Assets/ })).toBeVisible();

    // Focus should be on search input
    const searchInput = page.getByPlaceholder('Search assets...');
    await expect(searchInput).toBeFocused();

    // Accessibility check
    await checkA11y(page, 'Asset Insertion Modal');

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Focus should be restored to textarea
    await expect(textarea).toBeFocused();
  });

  test('should restore focus to textarea when clicking Cancel button', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    await expect(assetModal).toBeVisible();

    await assetModal.getByRole('button', { name: 'Cancel' }).click();

    // Modal should close
    await expect(assetModal).not.toBeVisible();

    // Focus should be restored to textarea
    await expect(textarea).toBeFocused();
  });

  test('should restore focus to Create button when navigating Back from Create Mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    const createBtn = assetModal.getByRole('button', { name: '+ Create New Asset' });
    await createBtn.click();

    // Now in Create Mode
    const createModal = page.getByRole('dialog', { name: 'Create & Insert Asset' });
    await expect(createModal).toBeVisible();
    
    const nameInput = createModal.getByLabel('Asset Title');
    await expect(nameInput).toBeFocused();

    // Click Back
    await createModal.getByRole('button', { name: 'Back' }).click();

    // Should be back in List Mode
    await expect(assetModal).toBeVisible();
    await expect(createBtn).toBeFocused();
  });

  test('should trap focus within the modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    const searchInput = assetModal.getByPlaceholder('Search assets...');
    const cancelBtn = assetModal.getByRole('button', { name: 'Cancel' });

    // Focus last element
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();

    // Tab forward
    await page.keyboard.press('Tab');
    // Should wrap to first element
    await expect(searchInput).toBeFocused();

    // Shift+Tab backward
    await page.keyboard.press('Shift+Tab');
    // Should wrap to last element
    await expect(cancelBtn).toBeFocused();
  });

  test('should search and insert an existing campaign asset', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    const searchInput = assetModal.getByPlaceholder('Search assets...');
    await searchInput.pressSequentially('Test Asset', { delay: 50 });

    // Wait for list to update and button to be visible
    const assetButton = assetModal.getByRole('button', { name: /Test Asset/ });
    await expect(assetButton).toBeVisible();
    await assetButton.click();

    // Modal should close
    await expect(assetModal).not.toBeVisible();

    // Content should be updated
    const content = await textarea.inputValue();
    expect(content).toContain(`@Asset[${SUITE_ID}-asset-1]{Test Asset}`);

    // Focus should be in textarea
    await expect(textarea).toBeFocused();
  });

  test('should create a new asset and insert it', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    await assetModal.getByRole('button', { name: '+ Create New Asset' }).click();

    // Now in Create Mode
    const createModal = page.getByRole('dialog', { name: 'Create & Insert Asset' });
    await expect(createModal).toBeVisible();
    
    const nameInput = createModal.getByLabel('Asset Title');
    await expect(nameInput).toBeFocused();
    await nameInput.fill('New NPC');
    
    await createModal.getByLabel('Type').selectOption('NPC');
    await createModal.getByLabel('Description').fill('A newly created NPC');

    await createModal.getByRole('button', { name: 'Save & Insert' }).click();

    // Modal should close
    await expect(createModal).not.toBeVisible();

    // Content should be updated
    const content = await textarea.inputValue();
    expect(content).toContain('New NPC');
    expect(content).toMatch(/@Asset\[[a-z0-9-]+\]{New NPC}/);

    // Verify it was added to campaign assets
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: /New NPC \(NPC\)/ })).toBeVisible();
  });

  test('should search and insert a global monster', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    // Uncheck "Only campaign"
    await assetModal.getByLabel('Only show assets already in the campaign').uncheck();

    const searchInput = assetModal.getByPlaceholder('Search assets...');
    await searchInput.pressSequentially('Aartuk Starhorror', { delay: 50 });

    const monsterButton = assetModal.getByRole('button', { name: /Aartuk Starhorror/ }).first();
    await expect(monsterButton).toBeVisible();
    await monsterButton.click();

    // Modal should close
    await expect(assetModal).not.toBeVisible();

    // Content should be updated
    const content = await textarea.inputValue();
    expect(content).toContain('Aartuk Starhorror');

    // Verify it was added to campaign assets
    await page.getByRole('button', { name: 'Save' }).click();
    // Use specific name pattern for campaign assets (which are now buttons)
    await expect(page.getByRole('button', { name: /Aartuk Starhorror \(NPC\)/ })).toBeVisible();
  });

  test('should search and insert a global magic item', async ({ page }) => {
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();

    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    
    // Uncheck "Only campaign" to search global assets
    await assetModal.getByLabel('Only show assets already in the campaign').uncheck();

    const searchInput = assetModal.getByPlaceholder('Search assets...');
    await searchInput.pressSequentially('Acheron Blade', { delay: 50 });

    const itemButton = assetModal.getByRole('button', { name: /Acheron Blade/ }).first();
    await expect(itemButton).toBeVisible();
    await itemButton.click();

    // Modal closes and links magic item
    await expect(assetModal).not.toBeVisible();
    const content = await textarea.inputValue();
    expect(content).toContain('Acheron Blade');

    // Save chapter
    await page.getByRole('button', { name: 'Save' }).click();

    // Item should now display as a campaign asset button
    await expect(page.getByRole('button', { name: /Acheron Blade \(Item\)/ })).toBeVisible();
  });
});
