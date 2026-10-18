import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';

const API = 'http://localhost:3005/api';

// Seeds a campaign whose units have NO initiative (stored as NULL by the server) so the
// first Start Combat has to roll for every monster.
const seedWithoutInitiative = (id: string) => {
  const s = getSeedState(id);
  for (const u of s.encounters[0].units) delete (u as { initiative?: number }).initiative;
  const monster = s.encounters[0].units.find(u => !u.isPlayer)!;
  s.encounters[0].units.push({ ...monster, instanceId: `${id}-unit-2`, name: 'Second Monster' });
  return s;
};

test.describe('Run Mode: stale browser copies and initiative after Start Combat', () => {
  test('a stale browser copy from before a DB wipe is ignored (same encounter id, new campaign id)', async ({ page, request }) => {
    const oldId = 'wipe-old-campaign';
    const newId = 'wipe-new-campaign';
    const encId = 'wipe-shared-enc-1';
    const seed = seedWithoutInitiative(newId);
    seed.encounters[0].id = encId;
    await request.delete(`${API}/danger/reset`);
    expect((await request.post(`${API}/campaigns`, { data: seed })).ok()).toBeTruthy();

    const stale = {
      isCombatStarted: true, round: 7, turnIndex: 0, activePhases: [1],
      updatedAt: '2999-01-01T00:00:00.000Z',
      combatants: [{ instanceId: 'old-1', name: 'Ghost Of Old Database', dexMod: 0, isPlayer: true, currentHp: 1, maxHp: 1, initiative: 20, phase: 1 }],
    };
    await page.addInitScript(({ newId, encId, stale, oldId }) => {
      window.localStorage.setItem('crits_active_campaign', newId);
      // New tagged format from a previous DB, and the legacy untagged format.
      window.localStorage.setItem(`crits_encounter_${encId}`, JSON.stringify({ campaignId: oldId, state: stale }));
      window.localStorage.setItem('crits_encounter_orphan-legacy', JSON.stringify(stale));
    }, { newId, encId, stale, oldId });

    await page.goto(`/?encounter=${encId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Initiative Setup')).toBeVisible();
    await expect(page.getByText('Ghost Of Old Database')).toHaveCount(0);
    await expect(page.getByText('Initiative Track')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('crits_encounter_orphan-legacy'))).toBeNull();
  });

  test('a newer browser copy for the same campaign still recovers a refresh the server missed', async ({ page, request }) => {
    const id = 'recover-campaign';
    const seed = seedWithoutInitiative(id);
    await request.delete(`${API}/danger/reset`);
    expect((await request.post(`${API}/campaigns`, { data: seed })).ok()).toBeTruthy();
    const encId = seed.encounters[0].id;
    const local = {
      isCombatStarted: true, round: 3, turnIndex: 0, activePhases: [1],
      updatedAt: '2999-01-01T00:00:00.000Z',
      combatants: [{ instanceId: 'r-1', name: 'Recovered Hero', dexMod: 0, isPlayer: true, currentHp: 1, maxHp: 1, initiative: 12, phase: 1 }],
    };
    await page.addInitScript(({ id, encId, local }) => {
      window.localStorage.setItem('crits_active_campaign', id);
      window.localStorage.setItem(`crits_encounter_${encId}`, JSON.stringify({ campaignId: id, state: local }));
    }, { id, encId, local });
    await page.goto(`/?encounter=${encId}`);
    await expect(page.getByText('Initiative Track')).toBeVisible();
    await expect(page.getByRole('button', { name: /12 - Recovered Hero/ })).toBeVisible();
  });

  test('Start Combat rolls initiative for monsters with no initiative, sorts by it and shows it in each row', async ({ page, request }) => {
    const id = 'init-roll-campaign';
    const seed = seedWithoutInitiative(id);
    await request.delete(`${API}/danger/reset`);
    expect((await request.post(`${API}/campaigns`, { data: seed })).ok()).toBeTruthy();
    // Server hands unset initiatives back as null.
    const fetched = await (await request.get(`${API}/campaigns/${id}`)).json();
    expect(fetched.encounters[0].units.every((u: { initiative: number | null }) => u.initiative == null)).toBeTruthy();

    await page.addInitScript((id) => window.localStorage.setItem('crits_active_campaign', id), id);
    await page.goto(`/?encounter=${seed.encounters[0].id}`);
    await page.waitForLoadState('networkidle');

    // Type a player initiative of 0 so rolled monsters must come first.
    await page.getByLabel(/Player 1/).fill('0');
    await page.getByRole('button', { name: 'Start Combat' }).click();
    await expect(page.getByText('Initiative Track')).toBeVisible();

    const rows = page.locator('ul[role="list"] > li');
    await expect(rows).toHaveCount(3);
    const values: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = await rows.nth(i).locator('button').first().innerText();
      const m = text.match(/(-?\d+) - /);
      expect(m, `row ${i} should start with its initiative: "${text}"`).not.toBeNull();
      values.push(parseInt(m![1], 10));
    }
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(values[2]).toBe(0);

    // Survives a reload (server round trip keeps the rolled numbers).
    await page.reload();
    await page.waitForLoadState('networkidle');
    const afterReload: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = await page.locator('ul[role="list"] > li').nth(i).locator('button').first().innerText();
      afterReload.push(parseInt(text.match(/(-?\d+) - /)![1], 10));
    }
    expect(afterReload).toEqual(values);
  });
});
