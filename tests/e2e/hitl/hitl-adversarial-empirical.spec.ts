import { test, expect } from '@playwright/test';
import { getSeedState } from '../../seed-data';

const SUITE_ID = 'hitl-adv-suite';
const suiteSeed = getSeedState(SUITE_ID);

const mockProposal = {
  proposalId: 'prop-adversarial-test-1',
  toolName: 'move_combatant',
  description: 'Move Grog Strongjaw from L8 to M9',
  requiresConfirmation: true,
  status: 'pending',
  createdAt: Date.now(),
  payloadType: 'movement',
  payload: {
    combatantId: 'c-grog-1',
    combatantName: 'Grog Strongjaw',
    origin: { x: 12, y: 8, label: 'L8', regionName: 'Shoreline' },
    destination: { x: 13, y: 9, label: 'M9', regionName: 'Shoreline' },
    originAdjacencies: { allies: [], enemies: [], neutral: [] },
    destinationAdjacencies: { allies: [], enemies: [], neutral: [] },
  },
};

test.describe('Adversarial Frontend & Shortcut Probes', () => {
  test.beforeAll(async ({ request }) => {
    const apiBase = 'http://localhost:3005/api';
    await request.delete(`${apiBase}/danger/reset`);
    const res = await request.post(`${apiBase}/campaigns`, { data: suiteSeed });
    if (!res.ok()) throw new Error(`Failed to seed suite: ${res.status()}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SUITE_ID);
    await page.goto('/');
    await page.waitForSelector('header');
  });

  test('ADV-FRONT-01: Probes whether single Alt+Y press triggers single or duplicate /confirm calls', async ({ page }) => {
    const confirmCalls: unknown[] = [];

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Tactical move ready.',
          proposals: [mockProposal],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      confirmCalls.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Moved Grog',
        }),
      });
    });

    // Open Oracle Modal
    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Move Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const box = page.locator('#hitl-confirmation-box');
    await expect(box).toBeVisible();

    // Verify where focus landed on proposal arrival
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    console.log(`[Focus Landing] Active tag: ${focusedTag}, Active ID: ${focusedId}`);

    // Now press Alt+Y ONCE
    await page.keyboard.press('Alt+y');

    await expect(box).not.toBeVisible();
    console.log(`[Confirm Dispatch Count] Single Alt+Y triggered ${confirmCalls.length} requests.`);

    // Expect exactly ONE confirm call
    expect(confirmCalls.length, 'Single Alt+Y must trigger exactly ONE /confirm call').toBe(1);

    // Verify focus restoration to input
    await expect(chatInput).toBeFocused();
  });

  test('ADV-FRONT-02: Rapid shortcut hammer test (multiple Alt+Y / Alt+N)', async ({ page }) => {
    const confirmCalls: unknown[] = [];

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Tactical move ready.',
          proposals: [{ ...mockProposal, proposalId: 'prop-rapid-hammer-1' }],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    // Add artificial delay to /confirm response to simulate network latency
    await page.route('**/api/assistant/confirm', async (route) => {
      confirmCalls.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 100));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Moved Grog',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Move Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const box = page.locator('#hitl-confirmation-box');
    await expect(box).toBeVisible();

    // Rapidly hammer Alt+Y three times in rapid succession
    await page.keyboard.press('Alt+y');
    await page.keyboard.press('Alt+y');
    await page.keyboard.press('Alt+y');

    await expect(box).not.toBeVisible();
    console.log(`[Rapid Hammer Result] /confirm received ${confirmCalls.length} calls`);

    // Only ONE confirmation should have been dispatched despite rapid hammering
    expect(confirmCalls.length).toBe(1);
    await expect(chatInput).toBeFocused();
  });

  test('ADV-FRONT-03: Escape key behavior and focus restoration check', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Tactical move ready.',
          proposals: [{ ...mockProposal, proposalId: 'prop-escape-test-1' }],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    // Record the trigger button or active element before opening modal
    const oracleBtn = page.getByRole('button', { name: /Oracle/i });
    if (await oracleBtn.isVisible()) {
      await oracleBtn.focus();
    }

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Move Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const box = page.locator('#hitl-confirmation-box');
    await expect(box).toBeVisible();

    // Now press Escape
    await page.keyboard.press('Escape');

    // Modal should close without throwing error or leaving focus trapped in void
    await expect(modal).not.toBeVisible();

    // Active element must not be null or undefined
    const activeExists = await page.evaluate(() => document.activeElement !== null);
    expect(activeExists).toBe(true);
  });

  test('ADV-FRONT-04: Live region persistence and announcement content', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Tactical move ready.',
          proposals: [{ ...mockProposal, proposalId: 'prop-live-region-1' }],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Grog advanced to M9',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');

    // Live region must exist in DOM before any action
    const liveRegion = page.locator('#hitl-live-announcement');
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveAttribute('role', 'status');
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    await chatInput.fill('Move Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const box = page.locator('#hitl-confirmation-box');
    await expect(box).toBeVisible();

    // Approve action
    await page.keyboard.press('Alt+y');
    await expect(box).not.toBeVisible();

    // Verify live region received polite announcement text
    await expect(liveRegion).toContainText(/Action approved/i);
    await expect(liveRegion).toContainText(/Grog advanced to M9/i);
  });
});
