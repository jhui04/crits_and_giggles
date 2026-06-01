import { Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Runs an accessibility scan on the current page state.
 * @param page The Playwright page instance.
 * @param contextName A descriptive name for the view/state being scanned.
 */
export async function checkA11y(page: Page, contextName: string) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .analyze();

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
