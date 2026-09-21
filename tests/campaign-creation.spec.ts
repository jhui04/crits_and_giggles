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
    
    // Should be in Create Mode by default, showing Create Mode heading
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
    
    // Verify accessibility of the main view after creation
    await checkA11y(page, 'Create Mode View after Creation');
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

  test('should render asset links in default adventure chapters with proper whitespace and separation', async ({ page }) => {
    // 1. Ensure we are on a Tide of Retribution campaign
    const headerText = await page.locator('header').innerText();
    if (!headerText.includes('Tide of Retribution')) {
      await page.getByRole('button', { name: 'Open Main Menu' }).click();
      await page.getByRole('button', { name: /Switch Campaign/i }).click();
      const campaignBtn = page.getByRole('button', { name: /Tide of Retribution/i }).first();
      await campaignBtn.click();
    }

    // 2. Select "Hunger of the Deep" chapter which contains monster and item links
    const chapterSelect = page.getByLabel(/Current Chapter:/i);
    await expect(chapterSelect).toBeVisible();
    await chapterSelect.selectOption({ label: 'Hunger of the Deep' });

    // 3. Verify chapter heading is visible
    const chapterHeading = page.getByRole('heading', { name: 'Hunger of the Deep', level: 3 });
    await expect(chapterHeading).toBeVisible();

    // 4. Verify asset buttons exist in the chapter content
    const assetBtns = page.locator('button.asset-link-btn');
    const count = await assetBtns.count();
    expect(count).toBeGreaterThan(0);

    // 5. Verify the full paragraph text around druid and Three Earrings has spaces
    const paragraphs = page.locator('p');
    const pCount = await paragraphs.count();
    let foundApothecary = false;

    for (let i = 0; i < pCount; i++) {
      const pText = await paragraphs.nth(i).innerText();
      if (pText.includes('Aldageam')) {
        foundApothecary = true;
        // Verify "female sea elf druid named Aldageam." has space before and after "druid"
        expect(pText).toContain('sea elf druid named');
        // Verify "Three Earrings saved Aldageam" has space before and after "Three Earrings"
        expect(pText).toContain('named Aldageam. Three Earrings saved');
        // Verify no smooshing into druid or Three Earrings
        expect(pText).not.toContain('elfdruid');
        expect(pText).not.toContain('druidnamed');
        expect(pText).not.toContain('Aldageam.Three');
        expect(pText).not.toContain('Earringssaved');
      }
    }
    expect(foundApothecary).toBe(true);

    // 6. Check Axe accessibility scan of the view with links
    await checkA11y(page, 'Create Mode Chapter Content with Asset Links');
  });
});
