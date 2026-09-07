import { test, expect, Page, BrowserContext } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';

const SUITE_ID = 'map-accessibility-suite';
const suiteSeed = getSeedState(SUITE_ID);

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
};

const setupEncounterPage = async (page: Page, context: BrowserContext) => {
  const [encounterPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /Run Test Encounter/ }).click()
  ]);
  await encounterPage.waitForLoadState();
  const startBtn = encounterPage.getByRole('button', { name: 'Start Combat' });
  await expect(startBtn).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    if (await startBtn.isVisible()) {
      await startBtn.click();
    }
    await expect(startBtn).not.toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return encounterPage;
};

test.describe('Combat Map Accessibility Suite', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    await setupApp(page);
    await page.keyboard.press('Alt+m');
    await expect(page.getByRole('heading', { name: 'Run Mode' })).toBeVisible();
  });

  test('Combat Map Grid rendering and empty cells (no middle dot)', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);
    
    // Map section and heading
    const mapHeading = encounterPage.getByRole('heading', { name: /Combat Map/ });
    await expect(mapHeading).toBeVisible();

    // Tactical application container semantics for screen readers (JAWS/NVDA)
    const appContainer = encounterPage.getByRole('application', { name: 'Combat Map Tactical Grid' });
    await expect(appContainer).toBeVisible();

    // Table grid semantics
    const grid = encounterPage.getByRole('grid', { name: 'Combat Map' });
    await expect(grid).toBeVisible();

    // Check that empty cells have aria-hidden on decorative dots and explicitly say Empty
    const cellA1 = encounterPage.locator('[data-cell="0-0"]');
    await expect(cellA1).toHaveAttribute('aria-label', 'A1, Empty');
    const dot = cellA1.locator('span[aria-hidden="true"]');
    await expect(dot).toHaveText('·');
    const srText = cellA1.locator('span.sr-only');
    await expect(srText).toHaveText('Empty');

    // Verify Axe accessibility scan passes on combat map view
    await checkA11y(encounterPage, 'Combat Map View');
    await encounterPage.close();
  });

  test('Grid keyboard navigation with roving tabindex and Alt+B', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);
    
    // Press Alt+b to focus the combat map board
    await encounterPage.keyboard.press('Alt+b');
    const initialCell = encounterPage.locator('[data-cell="0-0"]');
    await expect(initialCell).toBeFocused();
    await expect(initialCell).toHaveAttribute('tabindex', '0');

    // Navigate right (to B1: col 1, row 0)
    await encounterPage.keyboard.press('ArrowRight');
    const cellB1 = encounterPage.locator('[data-cell="1-0"]');
    await expect(cellB1).toBeFocused();
    await expect(cellB1).toHaveAttribute('tabindex', '0');
    await expect(initialCell).toHaveAttribute('tabindex', '-1');

    // Navigate down (to B2: col 1, row 1)
    await encounterPage.keyboard.press('ArrowDown');
    const cellB2 = encounterPage.locator('[data-cell="1-1"]');
    await expect(cellB2).toBeFocused();
    await expect(cellB2).toHaveAttribute('tabindex', '0');

    // Home jumps to start of row (A2: col 0, row 1)
    await encounterPage.keyboard.press('Home');
    const cellA2 = encounterPage.locator('[data-cell="0-1"]');
    await expect(cellA2).toBeFocused();

    // Press Escape to exit the tactical board and restore Virtual PC Cursor
    await encounterPage.keyboard.press('Escape');
    const focusBoardBtn = encounterPage.getByRole('button', { name: 'Focus Board (Alt+B)' });
    await expect(focusBoardBtn).toBeFocused();

    await encounterPage.close();
  });

  test('Nearby Entities Radar Modal (Alt+E and Escape restoration)', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    const radarButton = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await expect(radarButton).toBeVisible();
    await radarButton.click();

    // Verify modal opens and focus lands on heading
    const modalHeading = encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toBeFocused();

    // Run Axe scan on open radar modal
    await checkA11y(encounterPage, 'Nearby Entities Radar Modal');

    // Close via Escape and verify focus restores to trigger
    await encounterPage.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible();
    await expect(radarButton).toBeFocused();

    await encounterPage.close();
  });

  test('Creature Jump Modal (Alt+J, jump to cell)', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();

    // Verify modal opens and focus lands on heading
    const modalHeading = encounterPage.getByRole('heading', { name: 'Jump to Creature' });
    await expect(modalHeading).toBeVisible();
    await expect(modalHeading).toBeFocused();

    // Run Axe scan on open jump modal
    await checkA11y(encounterPage, 'Creature Jump Modal');

    // Jump to the first creature
    const creatureOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Jump/ }).first();
    await creatureOption.click();

    // Modal closes
    await expect(modalHeading).not.toBeVisible();

    // Verify a gridcell is now focused
    const focusedCell = encounterPage.locator('td[role="gridcell"]:focus');
    await expect(focusedCell).toBeVisible();

    await encounterPage.close();
  });

  test('Clicking monster brings up Action Menu and opens Monster Operations', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const creatureOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await creatureOption.click();

    // The focused cell is on a monster; click it or press Enter to open Action Menu
    const monsterCell = encounterPage.locator('td[role="gridcell"]:focus');
    await monsterCell.click();

    // Verify Unit Action Modal opens
    const actionHeading = encounterPage.getByRole('heading', { name: /Options$/ });
    await expect(actionHeading).toBeVisible();
    await expect(actionHeading).toBeFocused();
    await checkA11y(encounterPage, 'Unit Action Modal');

    // Click Actions & Attacks button in menu
    await encounterPage.getByRole('button', { name: /Actions & Attacks/ }).click();

    // Verify Monster Operations Modal opens
    await expect(encounterPage.getByRole('heading', { name: /Actions$/ })).toBeVisible();

    // Close Monster Operations Modal via Escape
    await encounterPage.keyboard.press('Escape');

    await encounterPage.close();
  });

  test('Move Mode from Action Menu: arrow to move, Enter to place', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to creature
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const creatureOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Jump/ }).first();
    await creatureOption.click();

    // Press Enter to open Action Menu
    await encounterPage.keyboard.press('Enter');
    await expect(encounterPage.getByRole('heading', { name: /Options$/ })).toBeVisible();

    // Select "Move on Map"
    await encounterPage.getByRole('button', { name: /Move on Map/ }).click();

    // Move Mode status banner should appear
    await expect(encounterPage.getByRole('status')).toContainText('Moving');

    // Move right by one cell
    await encounterPage.keyboard.press('ArrowRight');

    // Press Escape to cancel move
    await encounterPage.keyboard.press('Escape');

    // Move Mode cancelled
    await expect(encounterPage.getByRole('status')).not.toBeVisible();

    await encounterPage.close();
  });

  test('Move Towards target from Radar with default distance and confirmation', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster to ensure radar origin is a creature
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Open Radar for this creature
    const radarButton = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await radarButton.click();

    // Verify Radar modal is open
    await expect(encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' })).toBeVisible();

    // Locate the "Move Towards" button for the other entity (Player 1)
    const moveTowardsBtn = encounterPage.getByRole('button', { name: /Move towards/ }).first();
    await expect(moveTowardsBtn).toBeVisible();
    await moveTowardsBtn.click();

    // Verify Move Towards Modal opens and focus lands on heading
    const moveHeading = encounterPage.getByRole('heading', { name: /Move Towards/ });
    await expect(moveHeading).toBeVisible();
    await expect(moveHeading).toBeFocused();

    // Check accessibility of Move Towards Modal
    await checkA11y(encounterPage, 'Move Towards Modal');

    // Verify default distance input is present with non-zero value (min of speed or distance)
    const distanceInput = encounterPage.locator('#move-amount-input');
    await expect(distanceInput).toBeVisible();
    const initialVal = await distanceInput.inputValue();
    expect(parseInt(initialVal, 10)).toBeGreaterThan(0);

    // Click Confirm Move
    await encounterPage.getByRole('button', { name: 'Confirm Move' }).click();

    // Both modals close and focus returns to the map cell
    await expect(moveHeading).not.toBeVisible();
    await expect(encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' })).not.toBeVisible();

    // Focus returns directly to the map cell point, NOT the top of the page
    const activeCell = encounterPage.locator('td[tabindex="0"]');
    await expect(activeCell).toBeFocused();

    // Live region announces movement
    const liveRegion = encounterPage.locator('.sr-only[aria-live="polite"]');
    await expect(liveRegion).toContainText('moved');

    await encounterPage.close();
  });

  test('Radar origin selector allows switching to any monster whose turn it is not, and cancelling restores focus', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Open Radar directly from toolbar without jumping to a creature first
    const radarButton = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await radarButton.click();

    // Verify Radar modal is open and heading is focused
    const radarHeading = encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(radarHeading).toBeVisible();
    await expect(radarHeading).toBeFocused();

    // Verify origin selector is present and populated
    const originSelect = encounterPage.getByLabel('Scanning From Creature:');
    await expect(originSelect).toBeVisible();

    // Select a monster from the dropdown
    const options = await originSelect.locator('option').allInnerTexts();
    const monsterOption = options.find(opt => opt.includes('Monster'));
    expect(monsterOption).toBeTruthy();
    await originSelect.selectOption({ label: monsterOption! });

    // Verify targets list has "Move Towards" button
    const moveTowardsBtn = encounterPage.getByRole('button', { name: /Move towards/ }).first();
    await expect(moveTowardsBtn).toBeVisible();

    // Click Move Towards
    await moveTowardsBtn.click();

    // Verify Move Towards popup opens as true popup, heading is focused
    const moveHeading = encounterPage.getByRole('heading', { name: /Move Towards/ });
    await expect(moveHeading).toBeVisible();
    await expect(moveHeading).toBeFocused();

    // Verify destination column and row modifiers are present
    const colSelect = encounterPage.locator('#dest-col-select');
    const rowSelect = encounterPage.locator('#dest-row-select');
    await expect(colSelect).toBeVisible();
    await expect(rowSelect).toBeVisible();

    // Modify distance via +5 ft button
    const plus5Btn = encounterPage.getByRole('button', { name: 'Increase distance by 5 feet' });
    await plus5Btn.click();

    // Cancel Move Towards modal via Escape
    await encounterPage.keyboard.press('Escape');

    // Move Towards modal closes, Radar modal is restored, and focus returns to Move Towards button
    await expect(moveHeading).not.toBeVisible();
    await expect(radarHeading).toBeVisible();
    await expect(moveTowardsBtn).toBeFocused();

    // Close Radar modal via Escape
    await encounterPage.keyboard.press('Escape');
    await expect(radarHeading).not.toBeVisible();

    await encounterPage.close();
  });

  test('Open Radar and Move from Monster Operations Modal for monster whose turn it is not', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Open Options for a monster from initiative track
    const monsterOptionsBtn = encounterPage.getByRole('button', { name: /Options for/ }).first();
    await monsterOptionsBtn.click();

    // Verify Monster Operations Modal opens
    const opsHeading = encounterPage.getByRole('heading', { name: /Actions$/ });
    await expect(opsHeading).toBeVisible();

    // Click Scan Radar & Move on Map button
    const scanRadarBtn = encounterPage.getByRole('button', { name: 'Scan Radar & Move on Map' });
    await expect(scanRadarBtn).toBeVisible();
    await scanRadarBtn.click();

    // Monster Operations closes and Radar Modal opens
    await expect(opsHeading).not.toBeVisible();
    const radarHeading = encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(radarHeading).toBeVisible();
    await expect(radarHeading).toBeFocused();

    // Verify the origin is set to that monster
    const originSelect = encounterPage.getByLabel('Scanning From Creature:');
    const selectedText = await originSelect.locator('option:checked').innerText();
    expect(selectedText).toContain('Monster');

    // Close Radar
    await encounterPage.keyboard.press('Escape');
    await expect(radarHeading).not.toBeVisible();

    await encounterPage.close();
  });

  test('Pressing Escape in Enter menu (Unit Action Modal) on a character closes it and restores focus to cell', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster on the board to focus its cell
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Verify cell is focused
    const monsterCell = encounterPage.locator('td[tabindex="0"]');
    await expect(monsterCell).toBeFocused();

    // Press Enter to open Unit Action Menu
    await encounterPage.keyboard.press('Enter');

    // Verify modal is open and heading is focused
    const menuHeading = encounterPage.getByRole('heading', { name: /Options$/ });
    await expect(menuHeading).toBeVisible();
    await expect(menuHeading).toBeFocused();

    // Check accessibility of Unit Action Modal
    await checkA11y(encounterPage, 'Unit Action Modal');

    // Press Escape to close the menu
    await encounterPage.keyboard.press('Escape');

    // Modal closes and focus is restored to the cell on the map
    await expect(menuHeading).not.toBeVisible();
    await expect(monsterCell).toBeFocused();

    await encounterPage.close();
  });

  test('Move Towards modal captures focus, strictly traps Tab and Shift+Tab, and returns focus to map point on confirm', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Open Radar
    const radarButton = encounterPage.getByRole('button', { name: 'Radar Scan (Alt+E)' });
    await radarButton.click();
    const radarHeading = encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(radarHeading).toBeVisible();

    // Open Move Towards
    const moveTowardsBtn = encounterPage.getByRole('button', { name: /Move towards/ }).first();
    await moveTowardsBtn.click();

    // Heading must be focused on open
    const moveHeading = encounterPage.getByRole('heading', { name: /Move Towards/ });
    await expect(moveHeading).toBeVisible();
    await expect(moveHeading).toBeFocused();

    // Strict Focus Trap: Shift+Tab from heading wraps to the last interactive element (Cancel button)
    await encounterPage.keyboard.press('Shift+Tab');
    const cancelBtn = encounterPage.getByRole('button', { name: 'Cancel (Esc)' });
    await expect(cancelBtn).toBeFocused();

    // Strict Focus Trap: Tab from the last element wraps to the first interactive element (move-amount-input)
    await encounterPage.keyboard.press('Tab');
    const distanceInput = encounterPage.locator('#move-amount-input');
    await expect(distanceInput).toBeFocused();

    // Confirm the move
    const confirmBtn = encounterPage.getByRole('button', { name: 'Confirm Move' });
    await confirmBtn.click();

    // Modals close
    await expect(moveHeading).not.toBeVisible();
    await expect(radarHeading).not.toBeVisible();

    // Screen reader focus is returned to the map point (cell on map), NOT top of page
    const destinationCell = encounterPage.locator('td[tabindex="0"]');
    await expect(destinationCell).toBeFocused();

    await encounterPage.close();
  });

  test('Enter menu -> Actions & Attacks opens Monster Operations with focused heading, and Escape restores focus to map cell', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Verify cell is focused and press Enter
    const monsterCell = encounterPage.locator('td[tabindex="0"]');
    await expect(monsterCell).toBeFocused();
    await encounterPage.keyboard.press('Enter');

    // Unit Action Menu is open
    const menuHeading = encounterPage.getByRole('heading', { name: /Options$/ });
    await expect(menuHeading).toBeVisible();

    // Click "Actions & Attacks"
    const actionsBtn = encounterPage.getByRole('button', { name: /Actions & Attacks/ });
    await actionsBtn.click();

    // Unit Action Menu closes, Monster Operations opens, and focus lands on heading
    await expect(menuHeading).not.toBeVisible();
    const opsHeading = encounterPage.getByRole('heading', { name: /Actions$/ });
    await expect(opsHeading).toBeVisible();
    await expect(opsHeading).toBeFocused();

    // Press Escape to close Monster Operations
    await encounterPage.keyboard.press('Escape');

    // Operations modal closes, and focus is restored to the starting cell on the map
    await expect(opsHeading).not.toBeVisible();
    await expect(monsterCell).toBeFocused();

    await encounterPage.close();
  });

  test('Enter menu -> Actions & Attacks -> Saving Throw executes roll and closing roll restores focus to map cell', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Verify cell is focused and press Enter
    const monsterCell = encounterPage.locator('td[tabindex="0"]');
    await expect(monsterCell).toBeFocused();
    await encounterPage.keyboard.press('Enter');

    // Click Actions & Attacks
    await encounterPage.getByRole('button', { name: /Actions & Attacks/ }).click();
    const opsHeading = encounterPage.getByRole('heading', { name: /Actions$/ });
    await expect(opsHeading).toBeVisible();
    await expect(opsHeading).toBeFocused();

    // Click Saving Throws
    const savesBtn = encounterPage.getByRole('button', { name: 'Saving Throws' });
    await savesBtn.click();

    // Click the first saving throw button (e.g. STR)
    const saveRollBtn = encounterPage.locator('[role="dialog"] button').filter({ hasText: /STR/ }).first();
    await expect(saveRollBtn).toBeVisible();
    await saveRollBtn.click();

    // Roll Result modal opens with focused heading
    const rollHeading = encounterPage.locator('#encounter-roll-result-title');
    await expect(rollHeading).toBeVisible();
    await expect(rollHeading).toBeFocused();

    // Close roll modal via Escape
    await encounterPage.keyboard.press('Escape');

    // Roll modal and operations modal close, and focus is restored to the starting cell on the map
    await expect(rollHeading).not.toBeVisible();
    await expect(opsHeading).not.toBeVisible();
    await expect(monsterCell).toBeFocused();

    await encounterPage.close();
  });

  test('Enter menu -> View Details & Stats opens details with focused heading, and closing restores focus to map cell', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Verify cell is focused and press Enter
    const monsterCell = encounterPage.locator('td[tabindex="0"]');
    await expect(monsterCell).toBeFocused();
    await encounterPage.keyboard.press('Enter');

    // Click View Details & Stats
    await encounterPage.getByRole('button', { name: /View Details & Stats/ }).click();

    // Details modal opens, heading is focused
    const detailHeading = encounterPage.locator('#unit-detail-title');
    await expect(detailHeading).toBeVisible();
    await expect(detailHeading).toBeFocused();

    // Check accessibility of Details Modal
    await checkA11y(encounterPage, 'Unit Details Modal from Map');

    // Press Escape to close Details
    await encounterPage.keyboard.press('Escape');

    // Details modal closes, and focus is restored to the starting cell on the map
    await expect(detailHeading).not.toBeVisible();
    await expect(monsterCell).toBeFocused();

    await encounterPage.close();
  });

  test('Enter menu -> Scan Radar opens radar with focused heading, and closing restores focus to map cell', async ({ page, context }) => {
    const encounterPage = await setupEncounterPage(page, context);

    // Jump to monster
    const jumpButton = encounterPage.getByRole('button', { name: 'Jump to Creature (Alt+J)' });
    await jumpButton.click();
    const monsterOption = encounterPage.locator('[role="dialog"] button').filter({ hasText: /Monster/ }).first();
    await monsterOption.click();

    // Verify cell is focused and press Enter
    const monsterCell = encounterPage.locator('td[tabindex="0"]');
    await expect(monsterCell).toBeFocused();
    await encounterPage.keyboard.press('Enter');

    // Click Scan Radar (Nearby Entities)
    await encounterPage.getByRole('button', { name: /Scan Radar/ }).click();

    // Radar modal opens, heading is focused
    const radarHeading = encounterPage.getByRole('heading', { name: 'Nearby Entities (Radar)' });
    await expect(radarHeading).toBeVisible();
    await expect(radarHeading).toBeFocused();

    // Press Escape to close Radar
    await encounterPage.keyboard.press('Escape');

    // Radar closes, and focus is restored to the starting cell on the map
    await expect(radarHeading).not.toBeVisible();
    await expect(monsterCell).toBeFocused();

    await encounterPage.close();
  });
});

