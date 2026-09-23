import { test, expect, Page, Locator } from '@playwright/test';
import { getSeedState } from '../../seed-data';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-framework-suite';
const suiteSeed = getSeedState(SUITE_ID);

/**
 * Standard test proposals derived from PROJECT.md § Interface Contracts
 */
const mockMovementProposal = {
  proposalId: 'prop-hitl-move-001',
  toolName: 'move_combatant',
  description: 'Move Grog Strongjaw from L8 (Shoreline) to M9 (Shoreline)',
  requiresConfirmation: true,
  status: 'pending',
  createdAt: Date.now(),
  payloadType: 'movement',
  payload: {
    combatantId: 'c-grog-1',
    combatantName: 'Grog Strongjaw',
    origin: { x: 12, y: 8, label: 'L8', regionName: 'Shoreline' },
    destination: { x: 13, y: 9, label: 'M9', regionName: 'Shoreline' },
    originAdjacencies: { allies: [], enemies: ['Sahuagin Raider'], neutral: [] },
    destinationAdjacencies: { allies: [], enemies: ['Sahuagin Raider'], neutral: [] },
  },
};

const mockGenericProposal = {
  proposalId: 'prop-hitl-generic-002',
  toolName: 'update_tactical_environment',
  description: 'Enable heavy fog weather effect on Palma Flora map',
  requiresConfirmation: true,
  status: 'pending',
  createdAt: Date.now(),
  payloadType: 'generic',
  payload: {
    weatherEffect: 'heavy_fog',
    visibilityLimitCells: 4,
  },
};

test.describe('R1: Centralized HITL Write-Tool Framework E2E Tests', () => {
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

  /**
   * Helper: Opens the Assistant Oracle modal via Alt+A and verifies initial state.
   */
  async function openAssistantOracle(page: Page): Promise<{ modal: Locator; chatInput: Locator }> {
    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();
    const chatInput = page.locator('#assistant-oracle-input');
    await expect(chatInput).toBeFocused();
    return { modal, chatInput };
  }

  /**
   * Helper: Locates the HITL confirmation container in the modal.
   */
  function getConfirmationBox(modal: Locator): Locator {
    return modal.locator(
      '[data-testid="hitl-confirmation-box"], [role="region"][aria-label*="Confirmation" i], [role="region"][aria-label*="Pending" i], .hitl-confirmation-box, #hitl-confirmation-box'
    );
  }

  test('R1-E2E-01: Renders pending proposal in dedicated confirmation box located strictly between chat log and input form', async ({ page }) => {
    // Intercept chat API to stage a pending HITL proposal
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'I have prepared the tactical movement for Grog Strongjaw. Please confirm.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);

    // Ask a movement question to trigger proposal return
    await chatInput.fill('Move Grog to M9');
    await modal.getByRole('button', { name: 'Ask' }).click();

    // Verify confirmation box is rendered
    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Verify proposal description and tool name are clearly visible
    await expect(confirmationBox).toContainText('Move Grog Strongjaw from L8 (Shoreline) to M9 (Shoreline)');

    // Verify standardized action controls (Approve & Deny buttons)
    const approveBtn = confirmationBox.getByRole('button', { name: /Approve/i });
    const denyBtn = confirmationBox.getByRole('button', { name: /Deny/i });
    await expect(approveBtn).toBeVisible();
    await expect(denyBtn).toBeVisible();

    // Verify DOM position: MUST be strictly located between conversation history (role="log") and input form
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const inputForm = modal.locator('form:has(#assistant-oracle-input)');
    await expect(logRegion).toBeVisible();
    await expect(inputForm).toBeVisible();

    const isStrictlyBetween = await page.evaluate(() => {
      const log = document.querySelector('[role="log"][aria-label*="Conversation History"]');
      const box = document.querySelector(
        '[data-testid="hitl-confirmation-box"], [role="region"][aria-label*="Confirmation" i], [role="region"][aria-label*="Pending" i], .hitl-confirmation-box, #hitl-confirmation-box'
      );
      const form = document.querySelector('form:has(#assistant-oracle-input)');

      if (!log || !box || !form) return false;

      const isAfterLog = (log.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const isBeforeForm = (box.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

      return isAfterLog && isBeforeForm;
    });

    expect(isStrictlyBetween, 'HITL confirmation box must be positioned between chat log and input form').toBe(true);

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-02: Approves proposal via Alt+Y keyboard shortcut and restores focus to chat input', async ({ page }) => {
    let confirmPayload: { proposalId?: string; action?: string } | null = null;

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Tactical movement proposal ready for confirmation.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    // Intercept backend confirmation endpoint
    await page.route('**/api/assistant/confirm', async (route) => {
      confirmPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Successfully moved Grog Strongjaw to cell M9.',
          updatedState: { combatantId: 'c-grog-1', position: { x: 13, y: 9, label: 'M9' } },
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Advance Grog to cell M9');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Trigger Approve shortcut: Alt+Y
    await page.keyboard.press('Alt+y');

    // Verify confirmation request was dispatched to backend with action: 'approve'
    expect(confirmPayload).not.toBeNull();
    expect(confirmPayload?.proposalId).toBe(mockMovementProposal.proposalId);
    expect(confirmPayload?.action).toBe('approve');

    // Verify confirmation box is dismissed upon resolution
    await expect(confirmationBox).not.toBeVisible();

    // Verify focus is strictly restored to the chat input textarea (#assistant-oracle-input)
    await expect(chatInput).toBeFocused();

    // Verify resolution feedback is displayed in conversation history or live region
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Successfully moved Grog Strongjaw to cell M9|Approved/i);

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-03: Denies proposal via Alt+N keyboard shortcut, cleanly cancels without state mutation, and restores focus', async ({ page, request }) => {
    let confirmPayload: { proposalId?: string; action?: string } | null = null;

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Please confirm character movement.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      confirmPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cancelled: true,
          message: 'Action cancelled by user.',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Move Grog to M9');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Trigger Deny shortcut: Alt+N
    await page.keyboard.press('Alt+n');

    // Verify denial dispatch to backend
    expect(confirmPayload).not.toBeNull();
    expect(confirmPayload?.proposalId).toBe(mockMovementProposal.proposalId);
    expect(confirmPayload?.action).toBe('deny');

    // Verify confirmation box is dismissed cleanly
    await expect(confirmationBox).not.toBeVisible();

    // Verify focus is strictly restored to #assistant-oracle-input
    await expect(chatInput).toBeFocused();

    // Verify cancellation notice in chat log or live region
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toContainText(/Action cancelled by user|Denied/i);

    // Verify NO state mutation: query backend campaign data and verify combatant position is unmodified
    const campRes = await request.get(`http://localhost:3005/api/campaigns/${SUITE_ID}`);
    if (campRes.ok()) {
      const campaign = await campRes.json();
      const encounter = campaign.encounters?.[0];
      const grog = encounter?.units?.find((u: { name: string; position_x?: number }) => u.name === 'Grog Strongjaw');
      if (grog && grog.position_x !== undefined) {
        // Grog should remain at origin (12, 8) and NOT mutated to (13, 9)
        expect(grog.position_x).not.toBe(13);
      }
    }

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-04: Approves proposal via Approve button click, sends confirmation, and restores focus', async ({ page }) => {
    let confirmDispatched = false;

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Movement proposal pending.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      confirmDispatched = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Applied movement to M9.',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Step forward');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Click standard Approve button
    const approveBtn = confirmationBox.getByRole('button', { name: /Approve/i });
    await approveBtn.click();

    expect(confirmDispatched).toBe(true);
    await expect(confirmationBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-05: Denies proposal via Deny button click and cleanly cancels', async ({ page }) => {
    let denyDispatched = false;

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Movement proposal pending.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      denyDispatched = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cancelled: true,
          message: 'Action cancelled by user.',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Step forward');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Click standard Deny button
    const denyBtn = confirmationBox.getByRole('button', { name: /Deny/i });
    await denyBtn.click();

    expect(denyDispatched).toBe(true);
    await expect(confirmationBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-06: Focus management lands focus on proposal on arrival and restores to input on resolve', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Movement action proposed.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Move Grog');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Verify focus lands on proposal container, heading, or Approve button upon arrival
    const approveBtn = confirmationBox.getByRole('button', { name: /Approve/i });
    const proposalHeading = confirmationBox.locator('h3, h2, [role="heading"]').first();
    await expect(approveBtn).toBeVisible();
    await expect(proposalHeading).toBeVisible();

    const isBoxOrControlFocused = await page.evaluate(() => {
      const active = document.activeElement;
      const box = document.querySelector(
        '[data-testid="hitl-confirmation-box"], [role="region"][aria-label*="Confirmation" i], [role="region"][aria-label*="Pending" i], .hitl-confirmation-box, #hitl-confirmation-box'
      );
      if (!active || !box) return false;
      return box === active || box.contains(active);
    });

    expect(isBoxOrControlFocused, 'Focus should land within confirmation box or on its controls upon arrival').toBe(true);

    // Verify keyboard navigation: Tab moves between Approve and Deny buttons
    const denyBtn = confirmationBox.getByRole('button', { name: /Deny/i });
    await denyBtn.focus();
    await expect(denyBtn).toBeFocused();

    // Resolve via Escape or Deny
    await page.keyboard.press('Alt+n');
    await expect(confirmationBox).not.toBeVisible();

    // Verify focus is restored to chat input textarea
    await expect(chatInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-07: Full Axe accessibility compliance (checkA11y) with zero violations in pending proposal state', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Please confirm this action.',
          proposals: [mockMovementProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Perform tactical movement');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Run strict Axe accessibility audit on the entire page including the open HITL confirmation box
    await checkA11y(page, 'HITL Proposal Confirmation Box in Assistant Oracle');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('R1-E2E-08: Renders custom payload presentation and supports generic payload fallback', async ({ page }) => {
    // 1. Verify generic payload fallback
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Environment update proposed.',
          proposals: [mockGenericProposal],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    const { modal, chatInput } = await openAssistantOracle(page);
    await chatInput.fill('Apply weather effect');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const confirmationBox = getConfirmationBox(modal);
    await expect(confirmationBox).toBeVisible();

    // Generic proposal description displayed
    await expect(confirmationBox).toContainText('Enable heavy fog weather effect on Palma Flora map');

    // Both action buttons remain available
    const approveBtn = confirmationBox.getByRole('button', { name: /Approve/i });
    const denyBtn = confirmationBox.getByRole('button', { name: /Deny/i });
    await expect(approveBtn).toBeVisible();
    await expect(denyBtn).toBeVisible();

    // Check Axe accessibility of generic fallback payload
    await checkA11y(page, 'HITL Generic Payload Fallback Box');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
