import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'world-integration-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
};

test.describe('Campaign and World Integration E2E and A11y', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    
    // Seed a world with some assets
    const testWorld = {
      id: 'integration-test-world',
      name: 'Integration Test World',
      description: 'A world for integration testing',
      assets: [
        {
          id: 'npc-elminster',
          type: 'NPC',
          name: 'Elminster',
          description: 'Sage of Shadowdale.',
          tags: ['wizard', 'legendary'],
          connections: [
            {
              id: 'conn-elminster-loc',
              targetId: 'loc-shadowdale',
              relationship: 'lives in'
            }
          ]
        },
        {
          id: 'loc-shadowdale',
          type: 'Location',
          name: 'Shadowdale',
          description: 'A quiet valley.',
          tags: ['dale'],
          connections: []
        }
      ]
    };
    const res = await request.post(`${apiBase}/worlds`, { data: testWorld });
    if (!res.ok()) throw new Error(`Failed to seed world: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('should link campaign to world, link asset, and display world context in Run Mode', async ({ page }) => {
    // 1. Link Campaign to World
    // Click Campaign Settings to open modal
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Campaign Settings' }).click();

    // Locate the World Association area inside Campaign Settings modal
    const worldSection = page.locator('div').filter({ has: page.getByRole('heading', { name: 'World Association', exact: true }) }).first();
    await expect(worldSection).toBeVisible();
    await expect(worldSection).toContainText('Linked to: None');

    // Click Change World
    await worldSection.getByRole('button', { name: 'Change World' }).click();
    await expect(page.locator('#world-picker-title')).toBeVisible();

    // Select Integration Test World
    await page.getByRole('button', { name: 'Integration Test World' }).first().click();
    await expect(page.locator('#world-picker-title')).not.toBeVisible();
    await expect(worldSection).toContainText('Linked to: Integration Test World');

    // Close Campaign Settings Modal
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#campaign-modal-title')).not.toBeVisible();

    // 2. Insert the world asset into the chapter with the "@" picker
    await page.getByRole('button', { name: 'Chapter Options' }).click();
    await page.getByRole('button', { name: 'Edit Chapter' }).click();
    const textarea = page.locator('#chap-content');
    await textarea.focus();
    await page.keyboard.press('@');

    const assetModal = page.getByRole('dialog', { name: 'Insert Asset Link' });
    await assetModal.getByLabel('Only show assets already in the campaign').uncheck();
    await assetModal.getByPlaceholder('Search assets...').fill('Elminster');
    await assetModal.getByRole('button', { name: /Elminster/ }).first().click();
    await expect(assetModal).not.toBeVisible();
    expect(await textarea.inputValue()).toContain('@World[npc-elminster]{Elminster}');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Chapter' })).not.toBeVisible();

    // Verify Elminster is added to the chapter content
    await expect(page.getByRole('button', { name: 'Open asset: Elminster' })).toBeVisible();

    // 3. Switch to Run Mode and view Elminster's details
    // Open Main Menu and switch to Run Mode
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: 'Switch to Run Mode (Alt+M)' }).click();
    await expect(page.locator('.layout-run')).toBeVisible();
    await expect(page.locator('header')).toContainText('World: Integration Test World');

    // View details of Elminster in Run Mode
    // Elminster is not automatically linked to Chapter 1, but we can look in the All Assets view in Create Mode, 
    // or let's click on the link if we want, or look at the active chapter.
    // Wait! Let's check where Elminster is displayed in CampaignRunner.
    // In CampaignBuilder, when we linked Elminster, since we were in chapters view, selectedChapterId was active, so Elminster was linked to Chapter 1 (because selectedChapterId was active on link).
    // Let's verify that Elminster shows in the "Chapter Assets" list in CampaignRunner!
    await expect(page.locator('li', { hasText: 'Elminster' })).toBeVisible();
    
    // Click on Elminster in Chapter Assets list to open Asset Modal
    await page.locator('li', { hasText: 'Elminster' }).getByRole('button').click();
    
    // Modal should open
    const modalHeading = page.locator('#asset-modal-title');
    await expect(modalHeading).toBeVisible();

    // Verify World Context is displayed inside the modal
    const worldContextSection = page.locator('section', { hasText: 'World Context' });
    await expect(worldContextSection).toBeVisible();
    await expect(worldContextSection).toContainText('Type: NPC');
    await expect(worldContextSection).toContainText('Tags: wizard, legendary');
    await expect(worldContextSection).toContainText('lives in Shadowdale (Location)');

    // Run axe scan on asset modal in Run Mode with World Context
    await checkA11y(page, 'Asset Modal in Run Mode with World Context');

    // Close using Escape
    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible();
  });
});
