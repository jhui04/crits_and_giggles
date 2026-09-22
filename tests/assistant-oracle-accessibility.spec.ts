import { test, expect } from '@playwright/test';
import { getSeedState } from './seed-data';
import { checkA11y } from './utils/axe-helper';

const SUITE_ID = 'assistant-suite';
const suiteSeed = getSeedState(SUITE_ID);

test.describe('Assistant Oracle Accessibility & Interaction', () => {
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

  test('Alt+A shortcut instantly opens Assistant Oracle and focuses chat input', async ({ page }) => {
    // Focus a specific button first to test restoration
    const headerBtn = page.getByRole('button', { name: 'Open Assistant Oracle (Alt+A)' });
    await headerBtn.focus();
    await expect(headerBtn).toBeFocused();

    // Trigger Alt+A shortcut
    await page.keyboard.press('Alt+a');

    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    // Verify chat input is focused
    const chatInput = page.locator('#assistant-oracle-input');
    await expect(chatInput).toBeFocused();

    // Verify Axe accessibility
    await checkA11y(page, 'Assistant Oracle Modal via Shortcut');

    // Close via Escape key
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Focus restoration verification
    await expect(headerBtn).toBeFocused();
  });

  test('Open via Main Menu, verify dialog landmarks, ask question, and verify focus retention & aria-live', async ({ page }) => {
    const mainMenuBtn = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuBtn.click();

    const assistantMenuBtn = page.getByRole('button', { name: 'Assistant Oracle (Alt+A)' });
    await expect(assistantMenuBtn).toBeVisible();
    await assistantMenuBtn.click();

    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    // Heading lands focus and has shortened text "Oracle AI"
    const heading = page.locator('#assistant-oracle-title');
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText('Oracle AI');

    // Check accessibility
    await checkA11y(page, 'Assistant Oracle Modal via Main Menu');

    // Verify proper ARIA landmarks: conversation history has role="log"
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toBeVisible();

    // Fill chat question
    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('What does the Fireball spell do?');
    await expect(chatInput).toHaveValue('What does the Fireball spell do?');

    // Submit question
    const askBtn = modal.getByRole('button', { name: 'Ask' });
    await askBtn.click();

    // Verify messages are encapsulated in article elements with accessible name (owner + timestamp)
    const articles = logRegion.locator('article');
    await expect(articles.first()).toBeVisible();
    await expect(articles.first()).toHaveAttribute('aria-label', /^Assistant Oracle, \d+:\d+/);

    // Verify message header text is hidden from screen readers to prevent duplicate reading
    await expect(articles.first().locator('header')).toHaveAttribute('aria-hidden', 'true');

    // Wait for Oracle response to appear in conversation log
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    const lastResponse = oracleResponses.last();
    await expect(lastResponse).toContainText('Fireball');
    await expect(lastResponse).toHaveAttribute('aria-label', /^Assistant Oracle, \d+:\d+/);

    // Verify focus is not artificially forced back to the input box, avoiding screen reader interruption
    await expect(chatInput).not.toBeFocused();

    // Verify oracle response only appears in chat history and not as a separate section above the heading
    const aboveHeadingSections = modal.locator('.modal-content').locator('xpath=preceding-sibling::*');
    await expect(aboveHeadingSections).toHaveCount(0);

    // Close with Close button
    const closeBtn = modal.getByRole('button', { name: 'Close Assistant Oracle' });
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    // Focus restored
    await expect(mainMenuBtn).toBeFocused();
  });

  test('Knowledge passages retrieved link to accessible modal dialogs with strict focus restoration', async ({ page }) => {
    // Intercept chat API with knowledge passages
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Fireball is an evocation spell of 3rd level.',
          passages: [
            {
              id: 'spell-fireball',
              source: 'spell',
              entityId: 'fireball',
              title: 'Spell: Fireball (Level 3 Evocation)',
              content: 'A bright streak flashes from your pointing finger to a point you choose...',
              metadata: { name: 'Fireball', level: 3, school: 'Evocation' },
            },
          ],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Tell me about fireball');
    await modal.getByRole('button', { name: 'Ask' }).click();

    // Wait for passage details disclosure to appear
    const passageDisclosure = modal.locator('details').filter({ hasText: 'Knowledge Passages Retrieved' });
    await expect(passageDisclosure).toBeVisible();

    // Open disclosure
    await passageDisclosure.locator('summary').click();

    // Verify passage is a clickable button linking to its modal
    const passageBtn = passageDisclosure.getByRole('button', { name: /View details for Spell: Fireball/i });
    await expect(passageBtn).toBeVisible();
    await passageBtn.click();

    // Verify passage modal dialog opens
    const passageModal = page.locator('[role="dialog"][aria-labelledby="passage-modal-heading"]');
    await expect(passageModal).toBeVisible();

    // Heading lands focus
    const passageHeading = passageModal.locator('#passage-modal-heading');
    await expect(passageHeading).toBeFocused();
    await expect(passageHeading).toHaveText('Spell: Fireball (Level 3 Evocation)');

    // Axe scan of the open passage modal
    await checkA11y(page, 'Knowledge Passage Detail Modal');

    // Close passage modal via Escape key
    await page.keyboard.press('Escape');
    await expect(passageModal).not.toBeVisible();

    // Verify focus is strictly restored to the passage trigger button
    await expect(passageBtn).toBeFocused();

    // Close Assistant Oracle
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Model switcher allows switching between Qwen3.5-9B, Qwen3.5-4B, and Llama 3 with accessible name', async ({ page }) => {
    await page.keyboard.press('Alt+a');

    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const modelSelect = modal.locator('#assistant-model-select');
    await expect(modelSelect).toBeVisible();
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Qwen3.5-9B');

    // Switch to fallback 4B model
    await modelSelect.selectOption('qwen3.5:4b');
    await expect(modelSelect).toHaveValue('qwen3.5:4b');
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Qwen3.5-4B');

    // Switch to competitor Llama 3 (8B) model
    await modelSelect.selectOption('llama3');
    await expect(modelSelect).toHaveValue('llama3');
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Llama 3 (8B)');

    // Verify accessible state with Axe
    await checkA11y(page, 'Assistant Oracle with Llama 3 selected');

    // Close modal via Escape
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // Verify localStorage has persisted the model selection
    const persistedModel = await page.evaluate(() => localStorage.getItem('crits_assistant_model'));
    expect(persistedModel).toBe('llama3');

    // Reopen modal and verify the model choice remains persisted
    const openBtn = page.getByRole('button', { name: 'Open Assistant Oracle (Alt+A)' });
    await openBtn.click();
    await expect(modal).toBeVisible();
    await expect(modelSelect).toHaveValue('llama3');
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Llama 3 (8B)');

    // Switch back to primary 9B model
    await modelSelect.selectOption('qwen3.5:9b');
    await expect(modelSelect).toHaveValue('qwen3.5:9b');
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Qwen3.5-9B');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Renders rich markdown (tables, headings, lists, links) with full accessibility and proper heading hierarchy', async ({ page }) => {
    // Intercept chat API to supply rich markdown containing tables and headings
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: [
            '# Spell Slots and Damage',
            'Here is the breakdown of damage by spell level:',
            '',
            '| Level | Dice | Save |',
            '| :--- | :--- | :--- |',
            '| 3rd | 8d6 | Dex half |',
            '| 4th | 9d6 | Dex half |',
            '',
            '## Key Notes',
            '- Affects all targets in a **20-foot radius**',
            '- See official details at [SRD Rules](https://example.com/srd)',
          ].join('\n'),
          passages: [],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Show fireball damage table');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    const lastResponse = oracleResponses.last();

    // Verify H1 in markdown was shifted to H3 (preventing skipped heading levels under modal H2)
    const h3 = lastResponse.locator('h3');
    await expect(h3).toBeVisible();
    await expect(h3).toHaveText('Spell Slots and Damage');

    // Verify H2 in markdown was shifted to H4
    const h4 = lastResponse.locator('h4');
    await expect(h4).toBeVisible();
    await expect(h4).toHaveText('Key Notes');

    // Verify no h1 exists in the response
    await expect(lastResponse.locator('h1')).toHaveCount(0);

    // Verify table scroll wrapper is an accessible focusable region for keyboard users
    const tableRegion = lastResponse.locator('div[role="region"][aria-label="Table data"]');
    await expect(tableRegion).toBeVisible();
    await expect(tableRegion).toHaveAttribute('tabindex', '0');

    // Verify GFM table rendering and scope="col" attributes for screen reader matrix reading
    const table = tableRegion.locator('table');
    await expect(table).toBeVisible();
    const ths = table.locator('th');
    await expect(ths).toHaveCount(3);
    for (const th of await ths.all()) {
      await expect(th).toHaveAttribute('scope', 'col');
    }

    // Verify link has secure attributes and screen reader notification
    const link = lastResponse.locator('a');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link.locator('.sr-only')).toHaveText(' (opens in a new tab)');

    // Strict Axe accessibility check
    await checkA11y(page, 'Assistant Oracle Rich Markdown & GFM Table');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Renders GFM task lists, strikethrough, and pre code blocks with full accessibility and form-mode avoidance', async ({ page }) => {
    // Intercept chat API with task lists, strikethrough, and fenced code
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: [
            '### Combat Action Checklist',
            '- [x] Action Surge activated',
            '- [ ] Bonus Action: Second Wind',
            '',
            'Damage dealt: ~~28~~ 14 points (Halved on successful save).',
            '',
            '```text',
            'Dice Roll: 8d6 -> [4, 6, 2, 5, 3, 1, 4, 3] = 28',
            '```',
          ].join('\n'),
          passages: [],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Action surge checklist and damage');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    const lastResponse = oracleResponses.last();

    // Verify task list checkboxes have explicit aria-labels and are non-focusable to avoid trapping form mode
    const checkboxes = lastResponse.locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(2);

    const checkedBox = checkboxes.first();
    await expect(checkedBox).toBeChecked();
    await expect(checkedBox).toHaveAttribute('aria-label', 'Completed item');
    await expect(checkedBox).toHaveAttribute('tabindex', '-1');
    await expect(checkedBox).toBeDisabled();

    const uncheckedBox = checkboxes.nth(1);
    await expect(uncheckedBox).not.toBeChecked();
    await expect(uncheckedBox).toHaveAttribute('aria-label', 'Incomplete item');
    await expect(uncheckedBox).toHaveAttribute('tabindex', '-1');
    await expect(uncheckedBox).toBeDisabled();

    // Verify accessible strikethrough with sr-only deleted text indicator
    const del = lastResponse.locator('del');
    await expect(del).toBeVisible();
    await expect(del).toContainText('28');
    const delSrOnly = del.locator('.sr-only');
    await expect(delSrOnly.first()).toHaveText('[deleted: ');
    await expect(delSrOnly.last()).toHaveText(']');

    // Verify pre block has tabindex="0" and aria-label="Code block" for keyboard scrollability
    const pre = lastResponse.locator('pre');
    await expect(pre).toBeVisible();
    await expect(pre).toHaveAttribute('tabindex', '0');
    await expect(pre).toHaveAttribute('aria-label', 'Code block');

    // Strict Axe accessibility check
    await checkA11y(page, 'Assistant Oracle Task Lists and Code Blocks');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Renders semantic_search tool call execution disclosure with full accessibility', async ({ page }) => {
    // Intercept chat API returning a response that used semantic_search
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'For a desert biome with creatures emerging from beneath the sand, the **Purple Worm** or **Ankheg** are strong candidates.',
          passages: [],
          toolCalls: [
            {
              toolName: 'semantic_search',
              args: { query: 'burrowing desert monster', limit: 3 },
            },
          ],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('What is a good monster for a desert biome where it comes out of the ground?');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    // Verify tool execution disclosure appears
    const toolDisclosure = modal.locator('details').filter({ hasText: 'Authoritative Data Reads Executed (1)' });
    await expect(toolDisclosure).toBeVisible();

    // Open disclosure
    await toolDisclosure.locator('summary').click();

    // Verify semantic_search tool call is listed
    await expect(toolDisclosure).toContainText('semantic_search');
    await expect(toolDisclosure).toContainText('burrowing desert monster');

    // Run Axe scan on tool disclosure
    await checkA11y(page, 'Assistant Oracle with semantic_search tool disclosure');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Renders get_chapter_outline and read_chapter_section tool call execution disclosures with full accessibility', async ({ page }) => {
    // Intercept chat API returning response with chapter tools
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'The chapter outline has 3 main areas. In Room 1: Entrance, cobwebs line the stone pillars and a goblin patrol guards the passage.',
          passages: [],
          toolCalls: [
            {
              toolName: 'get_chapter_outline',
              args: {},
            },
            {
              toolName: 'read_chapter_section',
              args: { headingName: 'Room 1: Entrance' },
            },
          ],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('What is in Room 1 of the fortress?');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    // Verify tool execution disclosure appears with 2 executed tools
    const toolDisclosure = modal.locator('details').filter({ hasText: 'Authoritative Data Reads Executed (2)' });
    await expect(toolDisclosure).toBeVisible();

    // Open disclosure
    await toolDisclosure.locator('summary').click();

    // Verify both tools are listed
    await expect(toolDisclosure).toContainText('get_chapter_outline');
    await expect(toolDisclosure).toContainText('read_chapter_section');
    await expect(toolDisclosure).toContainText('Room 1: Entrance');

    // Run Axe scan on tool disclosure
    await checkA11y(page, 'Assistant Oracle with chapter reading tools disclosure');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Renders get_current_map tool execution with annotated map image and accessible combatant coordinate table', async ({ page }) => {
    // Intercept chat API returning get_current_map tool execution with image and coordinates
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Here is the tactical map for Palma Flora. Grog Strongjaw is holding the line at cell M9, and the Sahuagin Raider is positioned at cell P9.',
          passages: [],
          toolCalls: [
            {
              toolName: 'get_current_map',
              args: { include_combatants: true },
              result: {
                success: true,
                encounterId: 'enc-palma-flora',
                encounterName: 'Palma Flora Ambush',
                mapName: 'Palma Flora Ambush',
                grid: { columns: 33, rows: 21 },
                combatantsCount: 2,
                combatants: [
                  { name: 'Grog Strongjaw', team: 'Player', cell: 'M9', hp: '68/68' },
                  { name: 'Sahuagin Raider', team: 'Monster/Enemy', cell: 'P9', hp: '22/22' },
                ],
                // 1x1 valid red PNG pixel data URI for testing
                image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                imageAttached: true,
              },
            },
          ],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Show me the combat map with everyone positions');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    // Verify tool execution disclosure appears
    const toolDisclosure = modal.locator('details').filter({ hasText: 'Authoritative Data Reads Executed (1)' });
    await expect(toolDisclosure).toBeVisible();

    // Open disclosure
    await toolDisclosure.locator('summary').click();

    // Verify get_current_map tool execution and map details
    await expect(toolDisclosure).toContainText('get_current_map');
    await expect(toolDisclosure).toContainText('Tactical Map: Palma Flora Ambush (33x21 grid)');

    // Verify map image has accessible alt text and is visible
    const mapImg = toolDisclosure.locator('img[alt="Tactical combat map for Palma Flora Ambush with character locations"]');
    await expect(mapImg).toBeVisible();

    // Verify accessible combatant locations table
    const table = toolDisclosure.locator('table[aria-label="Combatant coordinates on Palma Flora Ambush"]');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Grog Strongjaw');
    await expect(table).toContainText('Player');
    await expect(table).toContainText('M9');
    await expect(table).toContainText('Sahuagin Raider');
    await expect(table).toContainText('Monster/Enemy');
    await expect(table).toContainText('P9');

    // Strict Axe accessibility verification
    await checkA11y(page, 'Assistant Oracle with Tactical Map Preview and Combatant Locations');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Model thought process is rendered in an accessible, collapsed disclosure with only final answer in the main log', async ({ page }) => {
    // Mock assistant chat response with both thinking and final answer
    await page.route('**/api/assistant/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Fireball is a 3rd-level evocation spell that deals 8d6 fire damage.',
          thinking: 'User is asking about Fireball.\n1. Verify spell level: 3rd level evocation.\n2. Verify damage: 8d6 fire damage on failed Dexterity save.\n3. Formulate clear final response.',
          passages: [],
          toolCalls: [],
          modelUsed: 'qwen3.5:9b',
        }),
      });
    });

    await page.keyboard.press('Alt+a');
    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('Tell me about Fireball');
    await modal.getByRole('button', { name: 'Ask' }).click();

    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    const lastMessage = oracleResponses.last();

    // 1. Verify main log contains the final answer
    await expect(lastMessage).toContainText('Fireball is a 3rd-level evocation spell that deals 8d6 fire damage.');

    // 2. Verify thoughts disclosure is present and collapsed by default
    const thoughtsDisclosure = lastMessage.locator('details.oracle-thoughts-disclosure');
    await expect(thoughtsDisclosure).toBeVisible();
    await expect(thoughtsDisclosure).not.toHaveAttribute('open', '');

    // Verify summary accessibility
    const summary = thoughtsDisclosure.locator('summary');
    await expect(summary).toHaveAttribute('aria-label', 'Oracle Thought Process');
    await expect(summary).toContainText('Thought Process');

    // 3. Open the disclosure
    await summary.click();
    await expect(thoughtsDisclosure).toHaveAttribute('open', '');

    // 4. Verify thought process contents and accessible region
    const thoughtRegion = thoughtsDisclosure.locator('[role="region"][aria-label="Expanded Thought Process"]');
    await expect(thoughtRegion).toBeVisible();
    await expect(thoughtRegion).toContainText('Verify spell level: 3rd level evocation');
    await expect(thoughtRegion).toHaveAttribute('tabindex', '0');

    // 5. Verify Axe scan passes with expanded thoughts disclosure
    await checkA11y(page, 'Assistant Oracle with Collapsed Thought Process');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
