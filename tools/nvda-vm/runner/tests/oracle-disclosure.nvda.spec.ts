import { expect, type Page } from '@playwright/test';
import { expectSpoken, norm, spokenLog, waitForSpeech, type SpeechSource } from './helpers';
import { test, useAppSuite } from './app-fixtures';

// The Oracle's "Search Type" control is a disclosure (src/components/DisclosureSelect.tsx):
// one plain <button aria-expanded> named "Search Type: <value>" (no
// aria-haspopup) that shows a <ul aria-label="Search Type"> right after it,
// whose options are <button aria-pressed>. There are no menu, listbox or
// combobox roles, so NVDA (and JAWS) should stay in browse mode throughout.
// These tests check what NVDA says for it, one key at a time, in browse mode
// and when tabbing.

type Nvda = SpeechSource & { press(key: string, options?: { capture?: boolean }): Promise<unknown> };

/** How many times `word` occurs in `text` (case-insensitive). */
const occurrences = (text: string, word: string) => norm(text).split(norm(word)).length - 1;

/** Asserts NVDA did not switch to focus mode during a step. */
const expectNoFocusMode = (joined: string, label: string) =>
  expect(norm(joined), `${label}: NVDA must stay in browse mode; spoken: ${joined}`).not.toContain('focus mode');

test.describe('Crits & Giggles app: Oracle Search Type disclosure', () => {
  const { note, resetAndOpenApp } = useAppSuite();

  /** Clear the log, press one key through NVDA, wait for `words`, record the step, return the speech. */
  async function press(nvda: Nvda, page: Page, key: string, label: string, words: string[], timeoutMs = 5000) {
    await nvda.clearSpokenPhraseLog();
    await nvda.press(key, { capture: true });
    const joined = await waitForSpeech(nvda, words, { timeoutMs });
    await note(nvda, page, label);
    expectSpoken(joined, words, label);
    return joined;
  }

  /** Alt+O, then wait until focus has settled in the monster search field. */
  async function openOracle(nvda: Nvda, page: Page) {
    const dialog = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await nvda.clearSpokenPhraseLog();
    await nvda.press('Alt+o', { capture: true });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#monster-search')).toBeFocused();
    const joined = await waitForSpeech(nvda, ['the oracle', 'dialog', 'focus mode'], { timeoutMs: 15_000 });
    await note(nvda, page, 'Alt+O');
    expectSpoken(joined, ['the oracle', 'dialog'], 'Alt+O');
    return dialog;
  }

  test('Browse mode: Down Arrow reaches one button; Enter opens the list in browse mode; Down Arrow and Enter choose', async ({ nvda, page, request }) => {
    await resetAndOpenApp(request, page, nvda);
    const dialog = await openOracle(nvda, page);
    const typeButton = page.locator('#oracle-type-filter');
    const list = page.locator('ul[aria-label="Search Type"]');

    // Focus is in the search field (focus mode); Escape returns to browse mode.
    await press(nvda, page, 'Escape', 'Escape', ['browse mode']);
    await expect(dialog).toBeVisible();

    // To the top of the dialog, then down one browse-mode stop at a time.
    await press(nvda, page, 'Control+Home', 'Control+Home', ['heading', 'the oracle']);
    let joined = await press(nvda, page, 'ArrowDown', 'ArrowDown 1', ['button', 'close']);
    expect(norm(joined), 'ArrowDown 1 must not reach the Search Type control yet').not.toContain('search type');

    // The Search Type control is the very next stop: one button, label and value together, value once.
    joined = await press(nvda, page, 'ArrowDown', 'ArrowDown 2', ['search type', 'monsters', 'button', 'collapsed']);
    expect(occurrences(joined, 'monsters'), `the value must be spoken once; spoken: ${joined}`).toBe(1);
    expect(occurrences(joined, 'search type'), `the label must be spoken once; spoken: ${joined}`).toBe(1);
    // No aria-haspopup on the button, so NVDA must not announce a submenu.
    expect(norm(joined), 'the button must not announce a popup').not.toContain('sub menu');

    // One Enter opens the list with focus on the pressed option; NVDA stays in browse mode.
    joined = await press(nvda, page, 'Enter', 'Enter (open)', ['monsters', 'pressed']);
    expectNoFocusMode(joined, 'Enter (open)');
    expect(norm(joined), 'the open list must not be announced as a menu').not.toContain('menu');
    await expect(list).toBeVisible();
    await expect(typeButton).toHaveAttribute('aria-expanded', 'true');
    await expect(list.getByRole('button', { name: 'Monsters', exact: true })).toBeFocused();

    // Down Arrow moves NVDA's browse cursor to the next option.
    joined = await press(nvda, page, 'ArrowDown', 'ArrowDown (Spells)', ['spells', 'not pressed']);
    expectNoFocusMode(joined, 'ArrowDown (Spells)');

    // Enter chooses it: the list closes, focus is back on the button with the new value.
    joined = await press(nvda, page, 'Enter', 'Enter (choose)', ['search type', 'spells', 'button', 'collapsed']);
    expectNoFocusMode(joined, 'Enter (choose)');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(typeButton).toHaveAttribute('aria-expanded', 'false');
    await expect(typeButton).toHaveAccessibleName('Search Type: Spells');
    expect(occurrences(joined, 'spells'), `the value must be spoken once; spoken: ${joined}`).toBe(1);

    // Still in browse mode: Up Arrow reads the previous content of the dialog.
    joined = await press(nvda, page, 'ArrowUp', 'ArrowUp 1 after choosing', ['button', 'close']);
    expectNoFocusMode(joined, 'ArrowUp 1 after choosing');
    joined = await press(nvda, page, 'ArrowUp', 'ArrowUp 2 after choosing', ['heading', 'the oracle']);
    expectNoFocusMode(joined, 'ArrowUp 2 after choosing');
    await expect(list).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('Tab path: Shift+Tab to the button, Space opens, Escape cancels, Enter opens, Tab to Spells, Enter chooses, Tab and Shift+Tab', async ({ nvda, page, request }) => {
    await resetAndOpenApp(request, page, nvda);
    const dialog = await openOracle(nvda, page);
    const typeButton = page.locator('#oracle-type-filter');
    const list = page.locator('ul[aria-label="Search Type"]');
    const option = (name: string) => list.getByRole('button', { name, exact: true });

    // From the monster search field back to the Search Type button. NVDA
    // leaves focus mode on a button, so arrows now belong to NVDA's browse
    // cursor and do not move DOM focus; Tab and Shift+Tab do, and Space or
    // Enter activate the focused button.
    let joined = await press(nvda, page, 'Shift+Tab', 'Shift+Tab to the button', ['search type', 'monsters', 'button', 'collapsed']);
    await expect(typeButton).toBeFocused();
    expect(occurrences(joined, 'monsters'), `the value must be spoken once; spoken: ${joined}`).toBe(1);

    // Space opens the list on the pressed option.
    joined = await press(nvda, page, 'Space', 'Space (open)', ['monsters', 'pressed']);
    expectNoFocusMode(joined, 'Space (open)');
    await expect(option('Monsters')).toBeFocused();
    await expect(option('Monsters')).toHaveAttribute('aria-pressed', 'true');

    // Escape closes it without a change; the Oracle stays open.
    joined = await press(nvda, page, 'Escape', 'Escape (cancel)', ['search type', 'monsters', 'button', 'collapsed']);
    expect(occurrences(joined, 'monsters'), `the value must be spoken once; spoken: ${joined}`).toBe(1);
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(typeButton).toHaveAccessibleName('Search Type: Monsters');
    await expect(dialog).toBeVisible();

    // Enter opens it again.
    joined = await press(nvda, page, 'Enter', 'Enter (open)', ['monsters', 'pressed']);
    expectNoFocusMode(joined, 'Enter (open)');
    await expect(list).toBeVisible();
    await expect(option('Monsters')).toBeFocused();

    // Tab moves DOM focus to the next option button.
    joined = await press(nvda, page, 'Tab', 'Tab (Spells)', ['spells', 'not pressed']);
    expectNoFocusMode(joined, 'Tab (Spells)');
    await expect(option('Spells')).toBeFocused();

    // Enter chooses: the list closes, focus is back on the button with the new value.
    joined = await press(nvda, page, 'Enter', 'Enter (choose)', ['search type', 'spells', 'button', 'collapsed']);
    expectNoFocusMode(joined, 'Enter (choose)');
    await expect(list).toHaveCount(0);
    await expect(typeButton).toBeFocused();
    await expect(typeButton).toHaveAccessibleName('Search Type: Spells');
    expect(occurrences(joined, 'spells'), `the value must be spoken once; spoken: ${joined}`).toBe(1);

    await press(nvda, page, 'Tab', 'Tab to the spell search', ['search spells', 'edit']);
    await expect(page.locator('#spell-search')).toBeFocused();

    joined = await press(nvda, page, 'Shift+Tab', 'Shift+Tab back', ['search type', 'spells', 'button', 'collapsed']);
    await expect(typeButton).toBeFocused();
    expect(occurrences(joined, 'spells'), `the value must be spoken once; spoken: ${joined}`).toBe(1);
    expect((await spokenLog(nvda)).join(' | ')).not.toMatch(/\bmenu\b/i);
  });
});
