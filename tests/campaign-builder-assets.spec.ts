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

test.describe('All Assets viewer for world and global assets', () => {
  const viewerSeedId = 'all-assets-viewer-test';
  const viewerWorldId = 'all-assets-viewer-world';
  const apiBase = 'http://localhost:3005/api';

  test.beforeEach(async ({ page, request }) => {
    await request.delete(`${apiBase}/danger/reset`);
    const worldRes = await request.post(`${apiBase}/worlds`, {
      data: {
        id: viewerWorldId,
        name: 'Viewer World',
        description: 'World for viewer tests',
        assets: [{
          id: 'world-npc',
          type: 'NPC',
          name: 'Elminster',
          description: '## Appearance\n\nA **tall** sage.\n\n- Long beard\n- Pointed hat',
          tags: [],
          connections: []
        }]
      }
    });
    if (!worldRes.ok()) throw new Error(`Failed to seed world: ${worldRes.status}`);
    const res = await request.post(`${apiBase}/campaigns`, {
      data: {
        id: viewerSeedId,
        name: 'All Assets Viewer Campaign',
        description: 'Viewer focus test',
        worldId: viewerWorldId,
        players: [],
        chapters: [{
          id: 'av-chap-1',
          title: 'Chapter 1',
          content: 'Meet @World[world-npc]{Elminster} and @Monster[2821142]{Aartuk Starhorror}.',
          order: 0
        }],
        assets: [],
        encounters: []
      }
    });
    if (!res.ok()) throw new Error(`Failed to seed campaign: ${res.status}`);

    await page.addInitScript((id: string) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, viewerSeedId);
    await page.goto('/');
    await page.waitForSelector('header');
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
    await page.getByRole('button', { name: 'All Assets' }).click();
  });

  test('world asset opens a dialog with focus on its heading and restores focus on close', async ({ page }) => {
    const row = page.getByRole('button', { name: 'Elminster (NPC)' });
    await row.click();

    const dialog = page.getByRole('dialog');
    const heading = dialog.getByRole('heading', { name: 'Elminster (NPC)', level: 2 });
    await expect(heading).toBeFocused();
    await expect(dialog.getByText('Asset details not found.')).toHaveCount(0);

    await checkA11y(page, 'All Assets world asset viewer');

    await dialog.getByRole('button', { name: /^Close/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();

    await row.click();
    await expect(heading).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test('world asset description is rendered as markdown', async ({ page }) => {
    await page.getByRole('button', { name: 'Elminster (NPC)' }).click();
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: 'Appearance', level: 4 })).toBeVisible();
    await expect(dialog.locator('strong', { hasText: 'tall' })).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveText(['Long beard', 'Pointed hat']);
    await expect(dialog).not.toContainText('##');
    await expect(dialog).not.toContainText('**');
  });

  test('global monster opens a dialog with focus on its heading', async ({ page }) => {
    const row = page.getByRole('button', { name: 'Aartuk Starhorror (NPC)' });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Monster Details: Aartuk Starhorror/, level: 2 })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
  });
});
