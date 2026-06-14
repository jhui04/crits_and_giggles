import { test, expect } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';

test.describe('Campaign Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start with a clean slate
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto('/');
  });

  test('should create a new blank campaign from the main menu', async ({ page }) => {
    // 1. Open Main Menu
    const mainMenuBtn = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuBtn.click();
    
    // Verify Main Menu is open and accessible
    const mainMenuHeading = page.getByRole('heading', { name: 'Main Menu' });
    await expect(mainMenuHeading).toBeVisible();
    await expect(mainMenuHeading).toBeFocused();
    await checkA11y(page, 'Main Menu Modal');

    // 2. Open Switch Campaign Modal
    await page.getByRole('button', { name: /Switch Campaign/i }).click();
    
    // Verify Select Campaign Modal is open
    const selectCampHeading = page.getByRole('heading', { name: 'Select Campaign' });
    await expect(selectCampHeading).toBeVisible();
    await expect(selectCampHeading).toBeFocused();
    await checkA11y(page, 'Select Campaign Modal');

    // 3. Click + Create New Campaign
    await page.getByRole('button', { name: /\+ Create New Campaign/i }).click();
    
    // Verify New Campaign view is open
    const newCampHeading = page.getByRole('heading', { name: 'New Campaign' });
    await expect(newCampHeading).toBeVisible();
    await expect(newCampHeading).toBeFocused();
    await checkA11y(page, 'New Campaign Modal');

    // 4. Fill in Campaign Details
    const campaignName = 'My Awesome Adventure';
    const campaignDesc = 'An epic quest into the unknown.';
    
    await page.getByLabel('Campaign Name:').fill(campaignName);
    await page.getByLabel('Description:').fill(campaignDesc);
    await page.getByLabel('Select Template (Optional):').selectOption('none'); // Blank Campaign

    // 5. Create and Select
    await page.getByRole('button', { name: /Create & Select/i }).click();

    // 6. Verify Campaign is created and active
    await expect(page.locator('header')).toContainText(`Campaign: ${campaignName}`);
    
    // Should be in Create Mode by default, showing Campaign Builder
    await expect(page.getByRole('heading', { name: 'Campaign Builder' })).toBeVisible();
    
    // Verify accessibility of the main view after creation
    await checkA11y(page, 'Campaign Builder View after Creation');
  });

  test('should create a new campaign from a template', async ({ page }) => {
    // 1. Navigate to New Campaign modal
    await page.getByRole('button', { name: 'Open Main Menu' }).click();
    await page.getByRole('button', { name: /Switch Campaign/i }).click();
    await page.getByRole('button', { name: /\+ Create New Campaign/i }).click();

    // 2. Fill in Details and Select a Template
    const campaignName = 'Tide of Retribution Test';
    await page.getByLabel('Campaign Name:').fill(campaignName);
    
    // Wait for templates to load (they are fetched from a JSON file)
    const templateSelect = page.getByLabel('Select Template (Optional):');
    // We expect at least one template to be available from scraped_campaign.json
    // Tide of Retribution is one of the adventures we saw in the scraper output earlier
    await expect(async () => {
      const options = await templateSelect.locator('option').allInnerTexts();
      expect(options.some(opt => opt.includes('Tide of Retribution'))).toBeTruthy();
    }).toPass();

    await templateSelect.selectOption({ label: 'Adventures in Wildemount - Tide of Retribution' });

    // 3. Create and Select
    await page.getByRole('button', { name: /Create & Select/i }).click();

    // 4. Verify Campaign is active and contains content from template
    await expect(page.locator('header')).toContainText(`Campaign: ${campaignName}`);
    
    // Template should have chapters, verify first chapter is visible
    // "Tide of Retribution" usually starts with a specific chapter title
    // Let's just check if "Current Chapter:" select has options
    const chapterSelect = page.getByLabel(/Current Chapter:/i);
    await expect(chapterSelect).toBeVisible();
    const chapterOptions = await chapterSelect.locator('option').allInnerTexts();
    expect(chapterOptions.length).toBeGreaterThan(0);
  });
});
