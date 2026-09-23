import { test, expect } from '@playwright/test';
import { getSeedState } from '../../seed-data';
import { checkA11y } from '../../utils/axe-helper';

const SUITE_ID = 'hitl-deep-adv-suite';
const suiteSeed = getSeedState(SUITE_ID);

const mockPassageItem = {
  id: 'passage-shield',
  source: 'spell',
  entityId: 'spell-shield',
  title: 'Spell: Shield (Level 1 Abjuration)',
  content: 'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC.',
  metadata: { name: 'Shield' },
};

const mockMovementProposal = {
  proposalId: 'prop-deep-adv-move',
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
    originAdjacencies: { allies: [], enemies: ['Goblin 1'], neutral: [] },
    destinationAdjacencies: { allies: ['Vex'], enemies: [], neutral: [] },
  },
};

const mockMultiTargetDamageProposal = {
  proposalId: 'prop-deep-adv-damage',
  toolName: 'apply_combat_damage',
  description: 'Cast Fireball dealing 28 fire damage to 5 targets',
  requiresConfirmation: true,
  status: 'pending',
  createdAt: Date.now(),
  payloadType: 'damage',
  payload: {
    actionType: 'damage',
    amount: 28,
    damageType: 'fire',
    targets: [
      {
        combatantId: 'c-elemental',
        combatantName: 'Fire Elemental',
        actionType: 'damage',
        amount: 28,
        damageType: 'fire',
        currentHp: 100,
        currentTempHp: 15,
        maxHp: 100,
        projectedHp: 100,
        projectedTempHp: 15,
        effectiveChange: 'Immune (0 damage)',
      },
      {
        combatantId: 'c-tiefling',
        combatantName: 'Tiefling Warlock',
        actionType: 'damage',
        amount: 28,
        damageType: 'fire',
        currentHp: 40,
        currentTempHp: 10,
        maxHp: 40,
        projectedHp: 36,
        projectedTempHp: 0,
        effectiveChange: '-10 temp, -4 HP (resisted)',
      },
      {
        combatantId: 'c-mummy',
        combatantName: 'Mummy',
        actionType: 'damage',
        amount: 28,
        damageType: 'fire',
        currentHp: 58,
        currentTempHp: 0,
        maxHp: 58,
        projectedHp: 2,
        projectedTempHp: 0,
        effectiveChange: '-56 HP (vulnerable)',
      },
      {
        combatantId: 'c-beast',
        combatantName: 'Mutant Beast',
        actionType: 'damage',
        amount: 28,
        damageType: 'fire',
        currentHp: 60,
        currentTempHp: 0,
        maxHp: 60,
        projectedHp: 32,
        projectedTempHp: 0,
        effectiveChange: '-28 HP (resisted & vulnerable)',
      },
      {
        combatantId: 'c-bat',
        combatantName: 'Giant Bat',
        actionType: 'damage',
        amount: 28,
        damageType: 'fire',
        currentHp: 12,
        currentTempHp: 0,
        maxHp: 22,
        projectedHp: 0,
        projectedTempHp: 0,
        effectiveChange: '-12 HP',
      },
    ],
  },
};

test.describe('Tier 5 Deep Adversarial Frontend Probes', () => {
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

  test('DEEP-ADV-01: Nested modal Escape key hierarchy does not prematurely close parent Oracle modal', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Retrieved defensive spell information.',
          proposals: [mockMovementProposal],
          passages: [mockPassageItem],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    // Open Oracle modal via Alt+A
    await page.keyboard.press('Alt+a');
    const oracleModal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(oracleModal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Check shield spell and move');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();

    // Verify confirmation box is visible
    const hitlBox = page.locator('#hitl-confirmation-box');
    await expect(hitlBox).toBeVisible();

    // Open Knowledge Passages disclosure and click Shield
    const disclosure = oracleModal.getByText(/Knowledge Passages Retrieved/i);
    await expect(disclosure).toBeVisible();
    await disclosure.click();

    const passageBtn = page.getByRole('button', { name: /View details for Spell: Shield/i });
    await expect(passageBtn).toBeVisible();
    await passageBtn.click();

    // Verify passage modal is open
    const passageModal = page.locator('[role="dialog"][aria-labelledby="passage-modal-heading"]');
    await expect(passageModal).toBeVisible();

    // Press Escape once: ONLY passage modal should close!
    await page.keyboard.press('Escape');
    await expect(passageModal).not.toBeVisible();

    // Parent Oracle modal and HITL box must remain OPEN!
    await expect(oracleModal).toBeVisible();
    await expect(hitlBox).toBeVisible();

    // Verify focus was restored to the passage button that opened the modal
    await expect(passageBtn).toBeFocused();

    // Now press Escape again: parent Oracle modal should close cleanly
    await page.keyboard.press('Escape');
    await expect(oracleModal).not.toBeVisible();
  });

  test('DEEP-ADV-02: Focus preservation on confirmation box unmount across all 4 interaction pathways', async ({ page }) => {
    let proposalCounter = 1;

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Proposal ready.',
          proposals: [{ ...mockMovementProposal, proposalId: `prop-pathway-${proposalCounter++}` }],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      const data = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: data.action === 'approve' ? 'Applied move' : 'Cancelled move',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const oracleModal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');

    // Pathway 1: Approve via Button Click
    await chatInput.fill('Step 1');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();
    const hitlBox = page.locator('#hitl-confirmation-box');
    await expect(hitlBox).toBeVisible();
    await page.locator('#hitl-approve-btn').click();
    await expect(hitlBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Pathway 2: Deny via Button Click
    await chatInput.fill('Step 2');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();
    await expect(hitlBox).toBeVisible();
    await page.locator('#hitl-deny-btn').click();
    await expect(hitlBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Pathway 3: Approve via Alt+Y Shortcut
    await chatInput.fill('Step 3');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();
    await expect(hitlBox).toBeVisible();
    await page.keyboard.press('Alt+y');
    await expect(hitlBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();

    // Pathway 4: Deny via Alt+N Shortcut
    await chatInput.fill('Step 4');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();
    await expect(hitlBox).toBeVisible();
    await page.keyboard.press('Alt+n');
    await expect(hitlBox).not.toBeVisible();
    await expect(chatInput).toBeFocused();
  });

  test('DEEP-ADV-03: Rapid conflicting shortcut triggers (Alt+Y followed immediately by Alt+N)', async ({ page }) => {
    const confirmCalls: Array<{ proposalId: string; action: string }> = [];

    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Proposal ready.',
          proposals: [{ ...mockMovementProposal, proposalId: 'prop-conflict-1' }],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    // Simulate 150ms network delay on /confirm
    await page.route('**/api/assistant/confirm', async (route) => {
      confirmCalls.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: 'Resolved',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const oracleModal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');

    await chatInput.fill('Move quickly');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();

    const hitlBox = page.locator('#hitl-confirmation-box');
    await expect(hitlBox).toBeVisible();

    // User presses Alt+Y then immediately Alt+N in rapid conflict
    await page.keyboard.press('Alt+y');
    await page.keyboard.press('Alt+n');

    await expect(hitlBox).not.toBeVisible();

    // Crucial Invariant: exactly 1 request dispatched (the first one: approve), second blocked by isConfirming
    expect(confirmCalls.length).toBe(1);
    expect(confirmCalls[0].action).toBe('approve');
    await expect(chatInput).toBeFocused();
  });

  test('DEEP-ADV-04: Screen reader live region transitions across rapid proposal lifecycle', async ({ page }) => {
    let proposalIndex = 0;
    const proposals = [
      { ...mockMovementProposal, proposalId: 'prop-sr-1', description: 'Advance Grog to M9' },
      { ...mockMovementProposal, proposalId: 'prop-sr-2', description: 'Advance Vex to N10' },
    ];

    await page.route('**/api/assistant/chat', async (route) => {
      const prop = proposals[proposalIndex++];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Next move staged.',
          proposals: [prop],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    await page.route('**/api/assistant/confirm', async (route) => {
      const req = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionSummary: req.action === 'approve' ? 'Grog advanced' : 'Vex cancelled',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const oracleModal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');
    const liveRegion = page.locator('#hitl-live-announcement');

    // Live region must be ready and polite
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    // Trigger proposal 1
    await chatInput.fill('First move');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();

    const hitlBox = page.locator('#hitl-confirmation-box');
    await expect(hitlBox).toBeVisible();

    // Verify announcement announced proposal 1
    await expect(liveRegion).toContainText(/Action proposed: Advance Grog to M9/i);

    // Approve proposal 1
    await page.keyboard.press('Alt+y');
    await expect(hitlBox).not.toBeVisible();
    await expect(liveRegion).toContainText(/Action approved: Grog advanced/i);

    // Trigger proposal 2
    await chatInput.fill('Second move');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();
    await expect(hitlBox).toBeVisible();

    // Verify announcement switched to proposal 2
    await expect(liveRegion).toContainText(/Action proposed: Advance Vex to N10/i);

    // Deny proposal 2
    await page.keyboard.press('Alt+n');
    await expect(hitlBox).not.toBeVisible();
    await expect(liveRegion).toContainText(/Action denied/i);
  });

  test('DEEP-ADV-05: Complex multi-target damage proposal card renders properly and passes Axe scan', async ({ page }) => {
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Fireball calculated for 5 targets.',
          proposals: [mockMultiTargetDamageProposal],
          toolCalls: [],
          modelUsed: 'mock-model',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const oracleModal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    const chatInput = page.locator('#assistant-oracle-input');

    await chatInput.fill('Cast Fireball on room');
    await oracleModal.getByRole('button', { name: 'Ask' }).click();

    const hitlBox = page.locator('#hitl-confirmation-box');
    await expect(hitlBox).toBeVisible();

    // Check that Damage Card is rendered with all 5 targets
    const damageCard = page.locator('#hitl-confirmation-box [data-testid="hitl-damage-card"]');
    await expect(damageCard).toBeVisible();

    const elementalRow = page.locator('[data-testid="damage-target-c-elemental"]');
    await expect(elementalRow).toBeVisible();
    await expect(elementalRow).toContainText('Fire Elemental');
    await expect(elementalRow).toContainText('Immune (0 damage)');

    const tieflingRow = page.locator('[data-testid="damage-target-c-tiefling"]');
    await expect(tieflingRow).toBeVisible();
    await expect(tieflingRow).toContainText('Tiefling Warlock');
    await expect(tieflingRow).toContainText('-10 temp, -4 HP (resisted)');

    const mummyRow = page.locator('[data-testid="damage-target-c-mummy"]');
    await expect(mummyRow).toBeVisible();
    await expect(mummyRow).toContainText('Mummy');
    await expect(mummyRow).toContainText('-56 HP (vulnerable)');

    const batRow = page.locator('[data-testid="damage-target-c-bat"]');
    await expect(batRow).toBeVisible();
    await expect(batRow).toContainText('Giant Bat');
    await expect(batRow).toContainText('0 / 22');

    // Run Axe Accessibility Scan on the multi-target damage card
    await checkA11y(page, 'Multi-Target Damage Proposal Card');
  });
});
