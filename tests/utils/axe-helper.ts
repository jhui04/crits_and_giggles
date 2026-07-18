import { Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Runs an accessibility scan on the current page state.
 * @param page The Playwright page instance.
 * @param contextName A descriptive name for the view/state being scanned.
 */
export async function checkA11y(page: Page, contextName: string) {
  const isCreateMode = await page.evaluate(() => {
    return !!document.querySelector('.layout-create');
  }).catch(() => false);

  const builder = new AxeBuilder({ page });
  if (isCreateMode) {
    builder.disableRules(['landmark-one-main', 'region']);
  }

  const accessibilityScanResults = await builder.analyze();

  if (accessibilityScanResults.violations.length > 0) {
    // Generate a readable summary for the logs
    const summary = accessibilityScanResults.violations
      .map((v, i) => `${i + 1}. [${v.id}] ${v.help}\n   Impact: ${v.impact}\n   Nodes: ${v.nodes.length}`)
      .join('\n');
    
    console.error(`\n[Axe Violation] Accessibility violations in "${contextName}":\n${summary}\n`);
    
    // Log full details for the first violation to help debugging
    console.error('Detailed first violation:', JSON.stringify(accessibilityScanResults.violations[0], null, 2));
  }

  expect(accessibilityScanResults.violations, `Found ${accessibilityScanResults.violations.length} accessibility violations in "${contextName}"`).toEqual([]);
}

/**
 * Navigates from the app root to the Change World picker modal.
 * Use this in beforeEach hooks instead of repeating the three-step sequence.
 * @param page The Playwright page instance.
 */
export async function navigateToChangeWorld(page: Page) {
  await page.getByRole('button', { name: 'Open Main Menu' }).click();
  await page.getByRole('button', { name: 'Campaign Settings' }).click();
  await page.getByRole('button', { name: 'Change World' }).click();
  await expect(page.locator('#world-picker-title')).toBeVisible();
}

/**
 * After selecting a world in the Change World modal, waits for it to close
 * then dismisses Campaign Settings cleanly.
 * @param page The Playwright page instance.
 */
export async function closeCampaignSettingsAfterWorldSelect(page: Page) {
  await expect(page.locator('#world-picker-title')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#campaign-modal-title')).not.toBeVisible();
}
