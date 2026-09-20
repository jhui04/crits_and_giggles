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

  test('Open via Main Menu, verify dialog landmarks, ask question, and close', async ({ page }) => {
    const mainMenuBtn = page.getByRole('button', { name: 'Open Main Menu' });
    await mainMenuBtn.click();

    const assistantMenuBtn = page.getByRole('button', { name: 'Assistant Oracle (Alt+A)' });
    await expect(assistantMenuBtn).toBeVisible();
    await assistantMenuBtn.click();

    const modal = page.locator('[role="dialog"][aria-labelledby="assistant-oracle-title"]');
    await expect(modal).toBeVisible();

    // Heading lands focus
    const heading = page.locator('#assistant-oracle-title');
    await expect(heading).toBeFocused();

    // Check accessibility
    await checkA11y(page, 'Assistant Oracle Modal via Main Menu');

    // Verify proper ARIA landmarks
    const logRegion = modal.locator('[role="log"][aria-label="Assistant Oracle Conversation History"]');
    await expect(logRegion).toBeVisible();

    // Fill chat question
    const chatInput = page.locator('#assistant-oracle-input');
    await chatInput.fill('What does the Fireball spell do?');
    await expect(chatInput).toHaveValue('What does the Fireball spell do?');

    // Submit question
    const askBtn = modal.getByRole('button', { name: 'Ask' });
    await askBtn.click();

    // Verify messages are encapsulated in article elements for JAWS 'O' navigation
    const articles = logRegion.locator('article');
    await expect(articles.first()).toBeVisible();
    await expect(articles.first().locator('header')).toContainText(/Oracle \d+:\d+/);

    // Wait for Oracle response to appear in conversation log
    const oracleResponses = logRegion.locator('article.oracle-message');
    await expect(oracleResponses.last()).toBeVisible();

    // Verify response contains semantic elements and is automatically focused for screen reader traversal
    const lastResponse = oracleResponses.last();
    await expect(lastResponse).toContainText('Fireball');
    await expect(lastResponse.locator('p, h3, h4, ul, li').first()).toBeVisible();
    await expect(lastResponse).toBeFocused();
    await expect(lastResponse.locator('header')).toContainText(/Oracle \d+:\d+/);

    // Close with Close button
    const closeBtn = modal.getByRole('button', { name: 'Close Assistant Oracle' });
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    // Focus restored
    await expect(mainMenuBtn).toBeFocused();
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

    // Switch back to primary 9B model
    await modelSelect.selectOption('qwen3.5:9b');
    await expect(modelSelect).toHaveValue('qwen3.5:9b');
    await expect(modelSelect).toHaveAttribute('aria-label', 'Current Model: Qwen3.5-9B');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
