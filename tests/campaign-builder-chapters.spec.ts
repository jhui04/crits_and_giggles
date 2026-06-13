import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

test.describe('Campaign Builder Chapters', () => {
  const campaign = {
    id: 'test-campaign-chapters',
    name: 'Test Campaign Chapters',
    description: 'A campaign for testing chapters.',
    chapters: [
      { id: 'chap-1', title: 'Chapter 1', content: 'Content of Chapter 1', order: 0 },
      { id: 'chap-2', title: 'Chapter 2', content: 'Content of Chapter 2', order: 1 }
    ],
    assets: [
      { id: 'asset-a', name: 'Asset A', type: 'NPC', description: 'From Chapter 1', chapterId: 'chap-1' },
      { id: 'asset-b', name: 'Asset B', type: 'Location', description: 'From Chapter 2', chapterId: 'chap-2' },
      { id: 'asset-c', name: 'Asset C', type: 'Item', description: 'Global Asset' }
    ],
    players: [],
    encounters: [
      { id: 'enc-a', name: 'Encounter A', units: [], chapterId: 'chap-1' },
      { id: 'enc-b', name: 'Encounter B', units: [], chapterId: 'chap-2' },
      { id: 'enc-c', name: 'Encounter C', units: [] }
    ]
  };

  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: campaign });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, 'test-campaign-chapters');

    await page.goto('/');
    // Switch to Create Mode if not already there
    const modeBtn = page.getByRole('button', { name: /Switch to Create Mode/i });
    if (await modeBtn.isVisible()) {
      await modeBtn.click();
    }
  });

  test('should display chapter-specific items in "Chapters" view', async ({ page }) => {
    // Assert "Chapters" tab is active by default
    const chaptersTab = page.getByRole('tab', { name: /Chapters/i });
    await expect(chaptersTab).toHaveAttribute('aria-selected', 'true');

    // Assert "Chapter 1" is selected by default
    const chapterSelect = page.getByLabel(/Current Chapter:/i);
    await expect(chapterSelect).toHaveValue('chap-1');

    // Assert Chapter 1 content is visible
    await expect(page.getByText('Content of Chapter 1')).toBeVisible();

    // Assert Chapter 1 Assets/Encounters are visible
    // Wait for the specific section heading to ensure we are in the right view
    await expect(page.getByRole('heading', { name: 'Chapter Assets' })).toBeVisible();
    
    await expect(page.getByRole('button', { name: /Asset A \(NPC\)/i })).toBeVisible();
    await expect(page.getByText('Encounter A (0 units)')).toBeVisible();

    // Assert other chapter/global items are NOT visible
    await expect(page.getByText('Asset B (Location)')).not.toBeVisible();
    await expect(page.getByText('Encounter B (0 units)')).not.toBeVisible();
    await expect(page.getByText('Asset C (Item)')).not.toBeVisible();
    await expect(page.getByText('Encounter C (0 units)')).not.toBeVisible();

    // Switch to Chapter 2
    await chapterSelect.selectOption('chap-2');

    // Assert Chapter 2 content is visible
    await expect(page.getByText('Content of Chapter 2')).toBeVisible();

    // Assert Chapter 2 Assets/Encounters are visible
    await expect(page.getByRole('button', { name: /Asset B \(Location\)/i })).toBeVisible();
    await expect(page.getByText('Encounter B (0 units)')).toBeVisible();

    // Assert other chapter/global items are NOT visible
    await expect(page.getByText('Asset A (NPC)')).not.toBeVisible();
    await expect(page.getByText('Encounter A (0 units)')).not.toBeVisible();
    await expect(page.getByText('Asset C (Item)')).not.toBeVisible();
    await expect(page.getByText('Encounter C (0 units)')).not.toBeVisible();

    // Accessibility check
    await checkA11y(page, 'Chapters View');
  });

  test('should display all items in "All Assets" view', async ({ page }) => {
    // Click "All Assets" tab
    await page.getByRole('tab', { name: /All Assets/i }).click();

    // Assert all assets are visible
    await expect(page.getByText('Asset A (NPC)')).toBeVisible();
    await expect(page.getByText('Asset B (Location)')).toBeVisible();
    await expect(page.getByText('Asset C (Item)')).toBeVisible();

    // Assert all encounters are visible
    await expect(page.getByText('Encounter A (0 units)')).toBeVisible();
    await expect(page.getByText('Encounter B (0 units)')).toBeVisible();
    await expect(page.getByText('Encounter C (0 units)')).toBeVisible();

    // Accessibility check
    await checkA11y(page, 'All Assets View');
  });

  test('should assign chapterId when creating items from "Chapters" view', async ({ page }) => {
    // Ensure we are in Chapter 1
    const chapterSelect = page.getByLabel(/Current Chapter:/i);
    await chapterSelect.selectOption('chap-1');

    // Add Asset
    await page.getByRole('button', { name: /\+ Add Asset/i }).click();
    await page.getByLabel(/Asset Name/i).fill('New Chapter Asset');
    await page.getByRole('button', { name: /Save/i }).click();

    // Assert it appears in Chapter 1
    await expect(page.getByText('New Chapter Asset (NPC)')).toBeVisible();

    // Switch to Chapter 2 and assert it is NOT there
    await chapterSelect.selectOption('chap-2');
    await expect(page.getByText('New Chapter Asset (NPC)')).not.toBeVisible();

    // Switch to All Assets and assert it IS there
    await page.getByRole('tab', { name: /All Assets/i }).click();
    await expect(page.getByText('New Chapter Asset (NPC)')).toBeVisible();
  });
});
