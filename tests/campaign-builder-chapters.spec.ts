import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

test.describe('Campaign Builder Chapters', () => {
  const campaign = {
    id: 'test-campaign-chapters',
    name: 'Test Campaign Chapters',
    description: 'A campaign for testing chapters.',
    chapters: [
      { id: 'chap-1', title: 'Chapter 1', content: '# Section One\n\nContent of Chapter 1\n\n## Subsection A', order: 0 },
      { id: 'chap-2', title: 'Chapter 2', content: 'Content of Chapter 2', order: 1 }
    ],
    assets: [
      { id: 'asset-a', name: 'Asset A', type: 'NPC', description: 'From Chapter 1', chapterIds: ['chap-1'] },
      { id: 'asset-b', name: 'Asset B', type: 'Location', description: 'From Chapter 2', chapterIds: ['chap-2'] },
      { id: 'asset-c', name: 'Asset C', type: 'Item', description: 'Global Asset', chapterIds: [] }
    ],
    players: [],
    encounters: [
      { id: 'enc-a', name: 'Encounter A', units: [], chapterIds: ['chap-1'] },
      { id: 'enc-b', name: 'Encounter B', units: [], chapterIds: ['chap-2'] },
      { id: 'enc-c', name: 'Encounter C', units: [], chapterIds: [] }
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
      if (!window.sessionStorage.getItem('initialized')) {
        window.sessionStorage.setItem('initialized', 'true');
        window.localStorage.clear();
        window.localStorage.setItem('crits_active_campaign', id);
      }
    }, 'test-campaign-chapters');

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
  });

  test('should display chapter-specific items in "Chapters" view', async ({ page }) => {
    // Assert "Chapters" tab is active by default
    const chaptersTab = page.getByRole('button', { name: /Chapters/i });
    await expect(chaptersTab).toHaveAttribute('aria-current', 'page');

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
    await page.getByRole('button', { name: /All Assets/i }).click();

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
    await page.getByRole('button', { name: /All Assets/i }).click();
    await expect(page.getByText('New Chapter Asset (NPC)')).toBeVisible();
  });

  test('preserves selected chapter when switching between Create Mode and Run Mode and on app reload', async ({ page }) => {
    // 1. In Create Mode, select Chapter 2
    const chapterSelect = page.getByLabel(/Current Chapter:/i);
    await chapterSelect.selectOption('chap-2');
    await expect(page.getByText('Content of Chapter 2')).toBeVisible();

    // 2. Switch to Run Mode (Alt+m)
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    // 3. Verify Run Mode shows Chapter 2 selected in the sidebar dropdown and its content
    const runChapterSelect = page.getByLabel('Chapters');
    await expect(runChapterSelect).toHaveValue('chap-2');
    await expect(page.getByRole('heading', { level: 3, name: 'Chapter 2' })).toBeVisible();
    await expect(page.getByText('Content of Chapter 2')).toBeVisible();

    // 4. In Run Mode, switch to Chapter 1
    await runChapterSelect.selectOption('chap-1');
    await expect(page.getByRole('heading', { level: 3, name: 'Chapter 1' })).toBeVisible();
    await expect(page.getByText('Content of Chapter 1')).toBeVisible();

    // 5. Switch back to Create Mode (Alt+m)
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('button', { name: /Chapters/i })).toBeVisible();

    // 6. Verify Create Mode now shows Chapter 1
    const createChapterSelect = page.getByLabel(/Current Chapter:/i);
    await expect(createChapterSelect).toHaveValue('chap-1');
    await expect(page.getByText('Content of Chapter 1')).toBeVisible();

    // Switch back to Chapter 2
    await createChapterSelect.selectOption('chap-2');
    await expect(createChapterSelect).toHaveValue('chap-2');

    // 7. Reload the page (simulating closing and reopening the app)
    await page.reload();
    await page.waitForSelector('header');

    // 8. Verify Chapter 2 is still selected on restart
    const reloadedSelect = page.getByLabel(/Current Chapter:/i);
    await expect(reloadedSelect).toHaveValue('chap-2');
    await expect(page.getByText('Content of Chapter 2')).toBeVisible();
  });

  test('verifies correct heading hierarchy in Run Mode (H3 chapter title, H4 markdown headings, H3 assets and encounters)', async ({ page }) => {
    // Switch to Run Mode
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();

    // Select Chapter 1 (which has markdown headings)
    const runChapterSelect = page.getByLabel('Chapters');
    await runChapterSelect.selectOption('chap-1');

    // Verify Chapter Title is an H3
    const chapterHeading = page.getByRole('heading', { level: 3, name: 'Chapter 1' });
    await expect(chapterHeading).toBeVisible();

    // Verify markdown top heading (# Section One) is an H4
    const sectionHeading = page.getByRole('heading', { level: 4, name: 'Section One' });
    await expect(sectionHeading).toBeVisible();

    // Verify markdown sub heading (## Subsection A) is an H5
    const subsectionHeading = page.getByRole('heading', { level: 5, name: 'Subsection A' });
    await expect(subsectionHeading).toBeVisible();

    // Verify Chapter Assets is an H3
    const assetsHeading = page.getByRole('heading', { level: 3, name: 'Chapter Assets' });
    await expect(assetsHeading).toBeVisible();

    // Verify Chapter Encounters is an H3
    const encountersHeading = page.getByRole('heading', { level: 3, name: 'Chapter Encounters' });
    await expect(encountersHeading).toBeVisible();

    // Run Axe accessibility scan
    await checkA11y(page, 'Run Mode - Chapter Headings Hierarchy');
  });
});
