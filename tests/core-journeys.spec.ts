import { test, expect } from '@playwright/test';

test.describe('Core User Journeys', () => {

  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
  });

  test.beforeEach(async ({ page }) => {
    // Clear state before each test to ensure we start from scratch
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/');
    await page.waitForSelector('header');
  });

  test('User can create a new campaign and switch to it', async ({ page }) => {
    // Open Main Menu
    await page.click('button[aria-label="Open Main Menu"]');
    
    // Open Switch Campaign modal
    await page.click('text=Switch Campaign');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Click Create New Campaign
    await page.click('text=Create New Campaign');
    
    // Fill out the form
    await page.fill('#new-camp-name', 'The Lost Mines of Phandelver');
    await page.fill('#new-camp-desc', 'A perilous journey.');
    
    // Submit
    await page.click('button:has-text("Create & Select")');

    // Verify modal closed and campaign is active
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    await expect(page.locator('header')).toContainText('Campaign: The Lost Mines of Phandelver');
  });

  test('User can toggle between Create and Run mode', async ({ page }) => {
    // By default, should be in Create Mode
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
 
    // Switch to Run Mode
    await page.keyboard.press('Alt+m');
     
    // Verify Run Mode UI
    await expect(page.locator('text=Run Mode')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();
 
    // Switch back
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Create Mode' })).toBeVisible();
  });

  test('User can create an encounter for a chapter and view it in Run Mode', async ({ page }) => {
    // 1. Setup: Create a new blank campaign
    await page.click('button[aria-label="Open Main Menu"]');
    await page.click('text=Switch Campaign');
    await page.click('text=Create New Campaign');
    await page.fill('#new-camp-name', 'Encounter Test Campaign');
    await page.click('button:has-text("Create & Select")');

    // 2. Create Chapter
    await page.click('button:has-text("+ Add Chapter")');
    await page.fill('#chap-title', 'Chapter 1: The Ambush');
    await page.fill('#chap-content', 'The party travels through a dark forest.');
    await page.click('button:has-text("Save")');
    await expect(page.getByRole('heading', { name: 'Chapter 1: The Ambush', level: 3 })).toBeVisible();

    // 3. Create Encounter
    await page.click('button:has-text("+ Create Encounter")');
    await page.fill('#encounter-name', 'Goblin Ambush');

    // 4. Add Monster
    await page.click('button:has-text("Add Monster...")');
    // MonsterBrowser search
    await page.fill('input[placeholder="Search monsters..."]', 'Goblin');
    // Select the Goblin from the list (this opens preview)
    await page.getByRole('button', { name: 'Goblin', exact: false }).first().click();
    // Click "Add to Encounter" in the preview modal
    await page.getByRole('button', { name: 'Add to Encounter' }).click();
    await expect(page.locator('section[aria-label="Current Units"]')).toContainText('Goblin 1');

    // 5. Save Encounter (handle alert)
    page.once('dialog', dialog => dialog.dismiss()); // Just dismiss the success alert
    await page.click('button:has-text("Save Encounter")');

    // 6. Switch to Run Mode
    await page.keyboard.press('Alt+m');
    await expect(page.locator('text=Run Mode')).toBeVisible();

    // 7. Verify link is visible in Run Mode for the chapter
    await expect(page.getByRole('link', { name: 'Run Goblin Ambush' })).toBeVisible();
  });
});
