import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

test.describe('Monster Lore Visibility', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the state with a campaign
    await page.addInitScript(() => {
      const campaign = {
        id: 'test-campaign',
        name: 'Test Campaign',
        description: 'Test',
        chapters: [],
        assets: [],
        players: [],
        encounters: []
      };
      localStorage.setItem('crits_campaigns', JSON.stringify([campaign]));
      localStorage.setItem('crits_current_campaign_id', 'test-campaign');
    });

    await page.goto('/');
    // Ensure data is loaded
    await page.waitForLoadState('networkidle');
  });

  test('should display monster description and lore sections in Oracle', async ({ page }) => {
    // Open Oracle
    await page.keyboard.press('Alt+O');
    await expect(page.locator('#oracle-title')).toBeVisible();
    
    // Wait for monsters to load
    await expect(page.locator('text=Loading monsters...')).not.toBeVisible({ timeout: 15000 });

    // Search for Adult Black Dragon to make it visible
    await page.getByPlaceholder(/Search monsters.../i).fill('Adult Black Dragon');

    // Select "Adult Black Dragon" (which we know has lore)
    const dragonLink = page.getByRole('button', { name: /Adult Black Dragon/i }).first();
    await dragonLink.click();

    // Check for Description heading
    await expect(page.getByRole('heading', { name: 'Description' })).toBeVisible();
    
    // Check for Lair Actions heading (lore section)
    await expect(page.getByRole('heading', { name: 'Lair Actions' })).toBeVisible();
    
    // Check for Regional Effects heading
    await expect(page.getByRole('heading', { name: 'Regional Effects' })).toBeVisible();

    // Verify accessibility
    await checkA11y(page, 'Monster Details with Lore');
  });
});
