import { test, expect, Page, Locator, APIRequestContext } from '@playwright/test';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-mappatch-e2e-suite';
const ENCOUNTER_ID = 'hitl-mappatch-enc-1';
const API = 'http://localhost:3005/api';

const seed = {
  id: SUITE_ID,
  name: 'HITL Map Patch Campaign',
  description: 'Map correction proposal verification suite',
  chapters: [
    { id: `${SUITE_ID}-chap-1`, title: 'Chapter 1: Palma Flora', content: `Harbor @Encounter[${ENCOUNTER_ID}]{Palma Flora Correction}`, order: 0 },
  ],
  assets: [],
  players: [],
  encounters: [
    {
      id: ENCOUNTER_ID,
      name: 'Palma Flora Correction',
      chapterIds: [`${SUITE_ID}-chap-1`],
      dmMapUrl: '/maps/5.1-palma-flora.png',
      playerMapUrl: '/maps/5.1-palma-flora-player.png',
      mapSize: { width: 67, height: 43 },
      runningState: {
        isCombatStarted: true,
        round: 1,
        turnIndex: 0,
        combatants: [
          { instanceId: 'mp-grog', name: 'Grog Strongjaw', currentHp: 45, maxHp: 45, initiative: 16, isPlayer: true, position: { x: 26, y: 17 } },
        ],
      },
      units: [
        { instanceId: 'mp-grog', name: 'Grog Strongjaw', currentHp: 45, maxHp: 45, dexMod: 2, initiative: 16, isPlayer: true, position: { x: 26, y: 17 } },
      ],
    },
  ],
};

async function stage(request: APIRequestContext, toolName: string, args: Record<string, unknown>) {
  const res = await request.post(`${API}/test/stage-proposal`, {
    data: { toolName, args, context: { campaignId: SUITE_ID, encounterId: ENCOUNTER_ID } },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function openAssistantWith(page: Page, proposal: unknown): Promise<{ modal: Locator; chatInput: Locator }> {
  await page.route('**/api/assistant/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'I staged a correction to the map data.', proposals: [proposal], toolCalls: [], modelUsed: 'qwen3.5:9b' }),
    });
  });
  await page.keyboard.press('Alt+a');
  const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
  await expect(modal).toBeVisible();
  const chatInput = page.locator('#assistant-oracle-input');
  await chatInput.fill('Cells M4 and M5 are mud');
  await modal.getByRole('button', { name: 'Ask' }).click();
  return { modal, chatInput };
}

test.describe('Phase 9: map correction proposals', () => {
  test.beforeAll(async ({ request }) => {
    await request.delete(`${API}/danger/reset`);
    const res = await request.post(`${API}/campaigns`, { data: seed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page, request }) => {
    await request.post(`${API}/campaigns`, { data: seed });
    await request.delete(`${API}/test/proposals`);
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto(`/?encounter=${ENCOUNTER_ID}`);
    await page.waitForSelector('header, main');
  });

  test('MP-E2E-01: shows the correction as a plain list, passes Axe, and Deny changes nothing', async ({ page, request }) => {
    const staged = await stage(request, 'propose_map_patch', { change: 'set_terrain', cells: ['M4', 'M5'], terrain: 'mud' });
    expect(staged.proposal.payloadType).toBe('map_patch');

    const { modal } = await openAssistantWith(page, staged.proposal);
    const box = modal.locator('[data-testid="hitl-confirmation-box"]');
    await expect(box).toBeVisible();

    const card = box.locator('[data-testid="hitl-map-patch-card"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Palma Flora');
    await expect(card.locator('dt', { hasText: 'Change' })).toBeVisible();
    await expect(card.locator('dd', { hasText: 'Set terrain' })).toBeVisible();
    await expect(card.locator('dd', { hasText: 'M4 and M5' })).toBeVisible();
    await expect(card.locator('dd', { hasText: 'mud' })).toBeVisible();
    await expect(box.getByRole('button', { name: /Approve/i })).toBeVisible();

    await checkA11y(page, 'HITL Map Patch Proposal Confirmation Box');

    await box.getByRole('button', { name: /Deny/i }).click();
    await expect(box).not.toBeVisible();

    const probe = await stage(request, 'find_positions', { terrain: ['mud'] });
    expect(probe.results.map((r: { cell: string }) => r.cell)).not.toContain('M4');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('MP-E2E-02: Approve stores the correction, announces it, and the map tools then use it', async ({ page, request }) => {
    const staged = await stage(request, 'propose_map_patch', { change: 'set_terrain', cells: ['M4'], terrain: 'mud' });
    const { modal, chatInput } = await openAssistantWith(page, staged.proposal);
    const box = modal.locator('[data-testid="hitl-confirmation-box"]');
    await expect(box).toBeVisible();

    await box.getByRole('button', { name: /Approve/i }).click();
    await expect(box).not.toBeVisible();
    await expect(modal.locator('[role="log"]')).toContainText('Action Approved & Applied');
    await expect(modal.locator('#hitl-live-announcement')).toContainText('Action approved');
    await expect(chatInput).toBeFocused();

    const probe = await stage(request, 'find_positions', { terrain: ['mud'] });
    expect(probe.results.map((r: { cell: string }) => r.cell)).toContain('M4');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('MP-E2E-03: a second proposal staged before the first was approved becomes stale', async ({ request }) => {
    const first = await stage(request, 'propose_map_patch', { change: 'set_terrain', cells: ['N4'], terrain: 'mud' });
    const second = await stage(request, 'propose_map_patch', { change: 'set_terrain', cells: ['N5'], terrain: 'mud' });
    const ok = await request.post(`${API}/assistant/confirm`, { data: { proposalId: first.proposal.proposalId, action: 'approve' } });
    expect(ok.ok()).toBe(true);
    const stale = await request.post(`${API}/assistant/confirm`, { data: { proposalId: second.proposal.proposalId, action: 'approve' } });
    expect(stale.ok()).toBe(false);
    expect(JSON.stringify(await stale.json())).toMatch(/no longer be applied/);
  });
});
