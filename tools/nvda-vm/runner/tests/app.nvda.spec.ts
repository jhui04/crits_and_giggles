import { expect } from '@playwright/test';
import { containsAll, expectSpoken, spokenLog, waitForSpeech } from './helpers';
import { test, useAppSuite } from './app-fixtures';

// Real NVDA against the real Crits & Giggles app. The shared setup (reset,
// seed, NVDA options, spoken-log attachment) is in app-fixtures.ts. The Oracle
// and the dice roller work on any screen.

// The dialog's name as NVDA should speak it.
const oracleName = 'the oracle';

test.describe('Crits & Giggles app', () => {
  const { note, resetAndOpenApp } = useAppSuite();

  test('Oracle: Alt+O speaks the dialog name, Escape closes it and speaks the restored trigger', async ({ nvda, page, request }) => {
    await resetAndOpenApp(request, page, nvda);
    // The trigger to return to. Not the main menu button: that is also where
    // the app sends focus when it has nothing to restore, so landing there
    // would not prove the trigger was restored.
    const trigger = page.getByRole('button', { name: 'Open Assistant Oracle (Alt+A)' });

    // navigateToWebContent leaves NVDA's browse cursor on the main menu
    // button at the top, so Tab moves focus to the next control, the
    // Assistant Oracle button.
    await nvda.clearSpokenPhraseLog();
    await nvda.press('Tab', { capture: true });
    let joined = await waitForSpeech(nvda, ['open assistant oracle', 'button']);
    await note(nvda, page, 'Tab');
    await expect(trigger).toBeFocused();
    expectSpoken(joined, ['open assistant oracle', 'button']);

    // Alt+O, the real shortcut, through NVDA.
    await nvda.clearSpokenPhraseLog();
    await nvda.press('Alt+o', { capture: true });
    const dialog = page.locator('[role="dialog"][aria-labelledby="oracle-title"]');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#monster-search')).toBeFocused();
    // A longer wait than the default 5 s: in one run on a slow VM, the first
    // test after boot heard nothing within 5 s of the dialog opening.
    // waitForSpeech returns as soon as the words arrive, so passing runs are
    // no slower.
    joined = await waitForSpeech(nvda, [oracleName, 'dialog'], { timeoutMs: 15_000 });
    await note(nvda, page, 'Alt+O');
    expectSpoken(joined, [oracleName, 'dialog']);

    // Escape. Focus is in the monster search field, where NVDA switched to
    // focus mode automatically; NVDA's own Escape then only leaves focus mode
    // and swallows the key. A real NVDA user presses Escape again.
    await nvda.clearSpokenPhraseLog();
    await nvda.press('Escape', { capture: true });
    await page.waitForTimeout(500);
    await note(nvda, page, 'Escape 1');
    if (await dialog.isVisible()) {
      joined = (await spokenLog(nvda)).join(' | ');
      expect(containsAll(joined, ['browse mode']), `first Escape neither closed the dialog nor left focus mode; spoken: ${joined}`).toBe(true);
      await nvda.clearSpokenPhraseLog();
      await nvda.press('Escape', { capture: true });
      await note(nvda, page, 'Escape 2');
    }
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    joined = await waitForSpeech(nvda, ['open assistant oracle', 'button']);
    await note(nvda, page, 'after close');
    expectSpoken(joined, ['open assistant oracle', 'button']);
  });

  test('Dice roller: Alt+R speaks the dialog; rolling speaks the result from the live region', async ({ nvda, page, request }) => {
    await resetAndOpenApp(request, page, nvda);

    await nvda.clearSpokenPhraseLog();
    await nvda.press('Alt+r', { capture: true });
    await expect(page.locator('#dice-roller-title')).toBeFocused();
    let joined = await waitForSpeech(nvda, ['quick dice roller']);
    await note(nvda, page, 'Alt+R');
    expectSpoken(joined, ['quick dice roller']);

    // Tab from the heading to the notation field (past the Close button).
    const input = page.locator('#dice-notation-input');
    for (let i = 0; i < 3 && !(await input.evaluate((el) => el === document.activeElement)); i++) {
      await nvda.press('Tab', { capture: true });
    }
    await expect(input).toBeFocused();
    await note(nvda, page, 'Tab to the notation field');

    // 3d1 always totals 3, so the announcement is predictable.
    await nvda.type('3d1');
    await expect(input).toHaveValue('3d1');

    // Enter submits the form; the result is announced by an assertive live
    // region 50 ms later, while focus stays in the field. (NVDA reads the
    // notation "3d1" as "3d 1", so the assertion uses the total and rolls.)
    await nvda.clearSpokenPhraseLog();
    await nvda.press('Enter', { capture: true });
    await expect(page.getByTestId('grand-total')).toHaveText('3');
    joined = await waitForSpeech(nvda, ['result: 3', 'rolls: 1, 1, 1'], { timeoutMs: 6000 });
    await note(nvda, page, 'Enter (roll)');
    expectSpoken(joined, ['result: 3', 'rolls: 1, 1, 1']);
    await expect(input).toBeFocused();
  });
});
