import { test, expect, Page } from '@playwright/test';
import { getSeedState } from './seed-data';
import { checkA11y } from './utils/axe-helper';

// Screen-aware Assistant Oracle (docs/CONTEXT_AWARE_ASSISTANT.md, section 6.4).
// For each registered screen: the dialog opens with focus on the heading, its accessible
// description carries the context line, axe passes, the chat request reports the right
// `screen`, and closing restores focus. Follows tests/modal-accessibility.spec.ts.

const SUITE_ID = 'assistant-context-suite';
const suiteSeed = getSeedState(SUITE_ID);
const encounterId = suiteSeed.encounters[0].id;

const dialog = (page: Page) => page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');

const setupApp = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
  await expect(page.locator('header')).toContainText(`Campaign: ${suiteSeed.name}`);
};

/** Opens the assistant from the Main Menu (heading receives focus, focus returns to the menu button). */
const openViaMainMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'Open Main Menu' }).click();
  await page.getByRole('button', { name: 'Assistant Oracle (Alt+A)' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#assistant-oracle-title')).toBeFocused();
};

const closeViaEscape = async (page: Page) => {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Main Menu' })).toBeFocused();
};

/** Asks a question and returns the `screen` the client sent plus the profile the server applied. */
const askAndCapture = async (page: Page, question: string) => {
  const requestPromise = page.waitForRequest((r) => r.url().includes('/api/assistant/chat') && r.method() === 'POST');
  const responsePromise = page.waitForResponse((r) => r.url().includes('/api/assistant/chat') && r.request().method() === 'POST');
  await page.locator('#assistant-oracle-input').fill(question);
  await dialog(page).getByRole('button', { name: 'Ask' }).click();
  const request = await requestPromise;
  const response = await responsePromise;
  const body = await response.json();
  return { sentScreen: request.postDataJSON().screen, appliedProfile: body.contextProfile, proposals: body.proposals };
};

test.describe('Assistant Oracle: screen context', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('Create > Chapters: context line, description, screen sent, focus restored', async ({ page }) => {
    await openViaMainMenu(page);

    await expect(page.locator('#assistant-oracle-context')).toHaveText('Context: Create mode, chapters. Focus: story and encounter ideas.');
    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Create mode, chapters\. Focus: story and encounter ideas\./);
    // The context line is a plain paragraph inside the dialog: no new landmark or heading level.
    await expect(dialog(page).locator('#assistant-oracle-context')).toHaveJSProperty('tagName', 'P');
    await checkA11y(page, 'Assistant Oracle: Create > Chapters');

    const { sentScreen, appliedProfile } = await askAndCapture(page, 'Give me a hook for this chapter');
    expect(sentScreen).toBe('create.chapters');
    expect(appliedProfile).toBe('create_story');

    await closeViaEscape(page);
  });

  test('Create > All Assets (campaign overview)', async ({ page }) => {
    await page.getByRole('button', { name: 'All Assets' }).click();
    await openViaMainMenu(page);

    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Create mode, campaign overview\./);
    await checkA11y(page, 'Assistant Oracle: Create > Campaign overview');
    const { sentScreen, appliedProfile } = await askAndCapture(page, 'What assets do I have?');
    expect(sentScreen).toBe('create.campaign_overview');
    expect(appliedProfile).toBe('create_story');

    await closeViaEscape(page);
  });

  test('Create > World', async ({ page }) => {
    await page.getByRole('button', { name: 'World', exact: true }).click();
    await openViaMainMenu(page);

    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Create mode, world\. Focus: worldbuilding\./);
    await checkA11y(page, 'Assistant Oracle: Create > World');
    const { sentScreen, appliedProfile } = await askAndCapture(page, 'Suggest a faction');
    expect(sentScreen).toBe('create.world');
    expect(appliedProfile).toBe('create_world');

    await closeViaEscape(page);
  });

  test('Create > Encounter Builder takes over from the chapter view and yields back on close', async ({ page }) => {
    await page.getByRole('button', { name: '+ Create Encounter' }).click();
    await openViaMainMenu(page);

    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Create mode, encounter builder\. Focus: encounter design\./);
    await checkA11y(page, 'Assistant Oracle: Create > Encounter Builder');
    const { sentScreen, appliedProfile } = await askAndCapture(page, 'Design a fair encounter for four level 3 PCs');
    expect(sentScreen).toBe('create.encounter_builder');
    expect(appliedProfile).toBe('create_encounter');
    await closeViaEscape(page);
  });

  test('Run > Story: context, screen sent, and no proposal card shown', async ({ page }) => {
    await page.keyboard.press('Alt+m');
    await expect(page.locator('.layout-run')).toBeVisible();
    await openViaMainMenu(page);

    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Run mode, story\. Focus: live table support\./);
    await checkA11y(page, 'Assistant Oracle: Run > Story');

    const { sentScreen, appliedProfile, proposals } = await askAndCapture(page, 'Move Grog to C4');
    expect(sentScreen).toBe('run.story');
    expect(appliedProfile).toBe('run_story');
    // (Tool filtering itself is asserted in the vitest adversarial suite; the mock returns no proposals.)
    expect(proposals ?? []).toHaveLength(0);
    await expect(page.locator('[role="region"][aria-labelledby="hitl-proposal-title"]')).toHaveCount(0);

    await closeViaEscape(page);
  });

  test('Run > Combat (encounter tab): Alt+A opens with the context, sends run.combat, restores focus', async ({ page }) => {
    await page.goto(`/?encounter=${encounterId}`);
    await expect(page.getByRole('heading', { name: `Running: ${suiteSeed.encounters[0].name}` })).toBeVisible();

    const trigger = page.getByRole('button').first();
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Alt+a');
    await expect(dialog(page)).toBeVisible();
    // Alt+A intentionally focuses the chat input (existing behavior); the dialog is still named and described.
    await expect(page.locator('#assistant-oracle-input')).toBeFocused();
    await expect(dialog(page)).toHaveAccessibleName('Oracle AI');
    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Run mode, combat\. Focus: running the encounter\./);
    await checkA11y(page, 'Assistant Oracle: Run > Combat');

    const { sentScreen, appliedProfile } = await askAndCapture(page, 'Who is next in initiative?');
    expect(sentScreen).toBe('run.combat');
    expect(appliedProfile).toBe('run_combat');

    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test('Run > Combat, choosing an encounter (picker)', async ({ page }) => {
    await page.goto('/?encounter=does-not-exist');
    await expect(page.getByRole('heading', { name: 'Load Encounter' })).toBeVisible();

    await page.keyboard.press('Alt+a');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleDescription(/Context: Run mode, combat, choosing an encounter\./);
    const { sentScreen, appliedProfile } = await askAndCapture(page, 'Set up an ambush');
    expect(sentScreen).toBe('run.encounter_picker');
    expect(appliedProfile).toBe('run_combat');
  });

  test('switching screens between opens appends a polite "Context changed" notice; reopening on the same screen does not', async ({ page }) => {
    const log = () => dialog(page).locator('[role="log"]');

    await openViaMainMenu(page);
    await expect(log()).not.toContainText('Context changed');
    await closeViaEscape(page);

    // Same screen again: no notice.
    await openViaMainMenu(page);
    await expect(log()).not.toContainText('Context changed');
    await closeViaEscape(page);

    // Change screen (Create -> Run) and reopen: the notice is appended to the existing log region.
    await page.keyboard.press('Alt+m');
    await expect(page.locator('.layout-run')).toBeVisible();
    await openViaMainMenu(page);
    await expect(log()).toContainText('Context changed: now Run mode, story. Answers and available actions are focused on live table support.');
    await expect(log()).toHaveAttribute('aria-label', 'Assistant Oracle Conversation History');
    // No second announcement channel: the status live region stays quiet, and the heading keeps focus.
    await expect(page.locator('#hitl-live-announcement')).toHaveText('');
    await expect(page.locator('#assistant-oracle-title')).toBeFocused();
    await checkA11y(page, 'Assistant Oracle: after context change');
    await closeViaEscape(page);

    // Reopening again without a change adds no further notice.
    await openViaMainMenu(page);
    await expect(log().getByText('Context changed:')).toHaveCount(1);
    await closeViaEscape(page);
  });
});
