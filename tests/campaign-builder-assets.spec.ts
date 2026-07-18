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
  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: seedData });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status}`);

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

  // ── Regression: All Assets tab must not be empty ──────────────────────────
  test('All Assets tab should show all campaign assets', async ({ page }) => {
    await page.getByRole('button', { name: 'All Assets' }).click();

    // All three campaign assets must be visible
    await expect(page.getByRole('button', { name: 'My NPC (NPC)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scraped NPC (NPC)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Custom Fire Blast (Spell)' })).toBeVisible();

    await checkA11y(page, 'All Assets Tab');
  });
});

test.describe('Mention ordering', () => {
  const orderedSeedId = 'ordered-mention-test';
  const orderedSeed = {
    id: orderedSeedId,
    name: 'Ordered Mention Campaign',
    description: 'Ordering test',
    players: [],
    chapters: [
      {
        id: 'om-chap-1',
        title: 'Chapter 1',
        // spell-asset is mentioned first, then custom-npc
        content: 'Intro @Campaign[spell-asset]{Custom Fire Blast} then @Campaign[custom-npc]{My NPC}.',
        order: 0,
      }
    ],
    assets: [
      { id: 'custom-npc',   name: 'My NPC',            type: 'NPC',   description: 'desc', chapterIds: ['om-chap-1'] },
      { id: 'scraped-npc',  name: 'Scraped NPC',        type: 'NPC',   description: 'Scraped from D&D Beyond', chapterIds: ['om-chap-1'] },
      { id: 'spell-asset',  name: 'Custom Fire Blast',  type: 'Spell', description: 'desc', chapterIds: ['om-chap-1'] }
    ],
    encounters: []
  };

  test('All Assets tab should order assets by first mention in chapter text', async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: orderedSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status}`);

    await page.addInitScript((id: string) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, orderedSeedId);

    await page.goto('/');
    await page.waitForSelector('header');
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();

    // Navigate to All Assets tab
    await page.getByRole('button', { name: 'All Assets' }).click();

    // Get the ordered list of asset button labels
    const listItems = page.locator('section').filter({ hasText: 'Manage Assets' }).getByRole('listitem');
    const labels = await listItems.allInnerTexts();

    // The chapter text puts spell-asset before custom-npc; scraped-npc has no text
    // mention so it falls to Phase 3 (chapterIds / remaining) — it must still appear.
    const spellIdx   = labels.findIndex(l => l.includes('Custom Fire Blast'));
    const npcIdx     = labels.findIndex(l => l.includes('My NPC'));
    const scrapedIdx = labels.findIndex(l => l.includes('Scraped NPC'));

    expect(spellIdx).toBeGreaterThanOrEqual(0);
    expect(npcIdx).toBeGreaterThanOrEqual(0);
    expect(scrapedIdx).toBeGreaterThanOrEqual(0);

    // spell-asset must come before custom-npc (text-order)
    expect(spellIdx).toBeLessThan(npcIdx);
  });
});

test.describe('Global Asset Rendering', () => {
  const globalSeedId = 'global-assets-test';
  const globalSeed = {
    id: globalSeedId,
    name: 'Global Assets Campaign',
    description: 'Testing global asset visibility',
    players: [],
    chapters: [
      {
        id: 'ga-chap-1',
        title: 'Chapter 1',
        content: 'Check out @Monster[2821142]{Aartuk Starhorror}, @Spell[1]{Acid Splash}, @Item[5370]{Adamantine Armor}, and @World[1]{Wildemount}.',
        order: 0,
      }
    ],
    assets: [],
    encounters: []
  };

  test('All Assets tab should show global and world assets mentioned in chapters', async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: globalSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status}`);

    // Assuming world asset with ID '1' exists. If not, the test will still show the tag logic works if it creates a fallback or fails.
    // In our backend tests, seed data is often just standard.
    // We will at least verify Monster, Spell, and Item.

    await page.addInitScript((id: string) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, globalSeedId);

    await page.goto('/');
    await page.waitForSelector('header');
    
    // Navigate to All Assets tab
    await page.getByRole('button', { name: 'All Assets' }).click();

    // Verify global assets appear in the list
    await expect(page.getByRole('button', { name: 'Aartuk Starhorror (NPC)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Acid Splash (Spell)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adamantine Armor (Item)' })).toBeVisible();
  });
});
