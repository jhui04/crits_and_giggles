import { test, expect, Page } from '@playwright/test';
import { checkA11y } from './utils/axe-helper';
import { getSeedState } from './seed-data';
import { chooseDisclosureOption } from './utils/disclosure-select-helper';

const SUITE_ID = 'phase-names-suite';
const API = 'http://localhost:3005/api';
const ENC_ID = `${SUITE_ID}-enc-1`;

const seed = getSeedState(SUITE_ID);
// Put the monster unit in phase 2 so the Run Mode toolbar shows two phases.
(seed.encounters[0].units[0] as Record<string, unknown>).phase = 2;

const openBuilder = async (page: Page) => {
  await page.addInitScript((id) => {
    window.localStorage.clear();
    window.localStorage.setItem('crits_active_campaign', id);
  }, SUITE_ID);
  await page.goto('/');
  await page.waitForSelector('header');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Encounter Builder' })).toBeFocused();
};

test.describe('Custom encounter phase names', () => {
  test.beforeAll(async ({ request }) => {
    // Same isolation pattern as the other suites: start from a clean database.
    await request.delete(`${API}/danger/reset`);
  });

  test.beforeEach(async ({ request }) => {
    const res = await request.post(`${API}/campaigns`, { data: seed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test('rename a phase in the builder, persist across reload, and see it in the picker and Run Mode', async ({ page, request }) => {
    page.on('dialog', (d) => d.accept());
    await openBuilder(page);

    // Default names while nothing is customised (old encounters keep working).
    const unitPhase = page.getByRole('button', { name: /^Phase for .+: Phase 2$/ }).first();
    await expect(unitPhase).toBeVisible();
    const unitPhaseId = await unitPhase.getAttribute('id');
    const toggle = page.locator(`[id="${unitPhaseId}"]`);

    await page.getByText('Phase Names (optional)').click();
    const input = page.getByLabel('Name for Phase 2');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('maxlength', '40');
    await expect(input).toHaveAccessibleDescription(/Leave a name blank/);
    await checkA11y(page, 'Encounter Builder Phase Names');

    // The picker updates live and keeps the unit on phase 2.
    await input.fill('   Beach Fight   ');
    await expect(toggle).toHaveAccessibleName(/: Beach Fight$/);
    await page.getByLabel('Name for Phase 3').fill('   ');

    // Choosing another phase by name works; identity stays numeric.
    await chooseDisclosureOption(page, toggle, 'Phase 3');
    await chooseDisclosureOption(page, toggle, 'Beach Fight');

    await page.getByRole('button', { name: 'Save Encounter' }).click();

    const saved = await (await request.get(`${API}/campaigns/${SUITE_ID}`)).json();
    const enc = saved.encounters.find((e: { id: string }) => e.id === ENC_ID);
    expect(enc.phaseNames).toEqual({ '2': 'Beach Fight' });
    expect(enc.units.find((u: { instanceId: string }) => u.instanceId === `${SUITE_ID}-unit-1`).phase).toBe(2);

    // Reload: the name is still there.
    await page.reload();
    await page.waitForSelector('header');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Encounter Builder' })).toBeFocused();
    await expect(page.getByLabel('Name for Phase 2')).toHaveValue('Beach Fight');
    await expect(page.getByRole('button', { name: /^Phase for .+: Beach Fight$/ })).toBeVisible();
    await expect(page.getByLabel('Name for Phase 3')).toHaveValue('');

    // Run Mode toolbar, labels and live region use the custom name.
    await page.goto(`/?encounter=${ENC_ID}`);
    await page.waitForSelector('header');
    const beachSwitch = page.getByRole('switch', { name: /Beach Fight/ });
    await expect(beachSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: /Phase 1/ })).toBeVisible();
    await beachSwitch.click();
    await expect(page.locator('[aria-live="assertive"]')).toContainText('Beach Fight activated');
    await checkA11y(page, 'Run Mode custom phase names');
  });

  test('legacy encounters without names show Phase N everywhere', async ({ page, request }) => {
    const plainId = `${SUITE_ID}-plain`;
    const plain = getSeedState(plainId);
    await request.post(`${API}/campaigns`, { data: plain });
    const fetched = await (await request.get(`${API}/campaigns/${plainId}`)).json();
    expect(fetched.encounters[0].phaseNames).toBeUndefined();
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, plainId);
    await page.goto(`/?encounter=${plainId}-enc-1`);
    await expect(page.getByRole('switch', { name: /^Phase 1:/ })).toBeVisible();
  });
});
