import { Locator, Page, expect } from '@playwright/test';

/**
 * Chooses an option from a DisclosureSelect (src/components/DisclosureSelect.tsx)
 * by keyboard, the way a user does: focus the toggle button, Enter opens the
 * list with focus on the pressed option, Down Arrow to the wanted option,
 * Enter chooses it. Asserts that the list collapses and that focus returns to
 * the toggle button, whose name now shows the chosen value.
 */
export async function chooseDisclosureOption(page: Page, button: Locator, optionName: string) {
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  const listId = await button.getAttribute('aria-controls');
  expect(listId, 'an expanded disclosure button must point at its list').toBeTruthy();
  const list = page.locator(`[id="${listId}"]`);
  const pressed = list.locator('button[aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  await expect(pressed).toBeFocused();

  const target = list.getByRole('button', { name: optionName, exact: true });
  const count = await list.getByRole('button').count();
  for (let i = 0; i < count && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(list).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
  await expect(button).toContainText(optionName);
}

/**
 * Like chooseDisclosureOption, but for an option that triggers an action (such
 * as opening a dialog) instead of changing the displayed value. Arrowing onto
 * the option must do nothing; only Enter chooses it.
 */
export async function chooseDisclosureAction(page: Page, button: Locator, optionName: string, onArrived?: () => Promise<void>) {
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const list = page.locator(`[id="${await button.getAttribute('aria-controls')}"]`);
  const target = list.getByRole('button', { name: optionName, exact: true });
  const count = await list.getByRole('button').count();
  for (let i = 0; i < count && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(target).toBeFocused();
  if (onArrived) await onArrived();
  await page.keyboard.press('Enter');
}
