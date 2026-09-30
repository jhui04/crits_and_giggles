import { nvdaTest as test } from '@guidepup/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { attachSpokenLog, spokenLog, type SpeechSource } from './helpers';
import { apiUrl, appUrl } from './app-urls';

// Shared setup for the NVDA tests that run against the real Crits & Giggles
// app, served from the host by run-tests.ps1 (see global-setup.ts for how the
// guest reaches it). Every key goes through NVDA, as a real user's would.
//
// State: before every test the API is reset (DELETE /api/danger/reset) and
// one small campaign is seeded and made active, like the regular suite does.

export { test };

export const SEED_ID = 'nvda-suite';
export const seedCampaign = {
  id: SEED_ID,
  name: 'NVDA Test Campaign',
  description: 'Seeded by the NVDA VM suite',
  chapters: [{ id: `${SEED_ID}-chap-1`, title: 'Chapter 1', content: 'Hello world', order: 0 }],
  assets: [],
  players: [],
  encounters: [],
};

type AppNvda = SpeechSource & { navigateToWebContent(): Promise<void> };

/**
 * Call once inside a `test.describe` block. It configures NVDA, clears the
 * per-test step log before each test and attaches the spoken log after each
 * test, and returns the helpers the tests use.
 */
export function useAppSuite() {
  // NVDA signals browse/focus mode switches with a sound by default. With
  // passThroughAudioIndication off it says "focus mode" / "browse mode"
  // instead, so the spoken log shows which mode NVDA is in.
  test.use({
    nvdaStartOptions: {
      capture: 'initial',
      settings: { virtualBuffers: { passThroughAudioIndication: false } },
    },
  });

  const steps: string[] = [];

  test.beforeEach(() => {
    steps.length = 0;
  });

  test.afterEach(async ({ nvda }, testInfo) => {
    await attachSpokenLog(nvda, testInfo, steps.length ? ['Steps (DOM focus and speech per step):', ...steps, 'Last spoken log:'] : []);
  });

  /** Record the DOM focus and the speech so far under a label, for the attached log. */
  async function note(nvda: SpeechSource, page: Page, label: string) {
    const focused = await page
      .evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'body';
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
        return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${name}"`;
      })
      .catch(() => '?');
    steps.push(`[${label}] focus: ${focused}; spoken: ${(await spokenLog(nvda)).join(' | ')}`);
  }

  async function resetAndOpenApp(request: APIRequestContext, page: Page, nvda: AppNvda) {
    // Same pattern as the regular suite (tests/oracle-accessibility.spec.ts):
    // reset, seed one small campaign, make it the active one. Without a seed,
    // the app loads its large default campaign, whose text is full of links.
    const reset = await request.delete(`${apiUrl}/danger/reset`, { timeout: 60_000 });
    expect(reset.ok(), `reset failed: HTTP ${reset.status()}`).toBe(true);
    const seeded = await request.post(`${apiUrl}/campaigns`, { data: seedCampaign });
    expect(seeded.ok(), `seeding failed: HTTP ${seeded.status()}`).toBe(true);
    await page.addInitScript((id) => {
      window.localStorage.clear();
      window.localStorage.setItem('crits_active_campaign', id);
    }, SEED_ID);
    await page.goto(appUrl, { waitUntil: 'load' });
    await page.waitForSelector('header');
    await expect(page.getByText(`Campaign: ${seedCampaign.name}`)).toBeVisible();
    await nvda.navigateToWebContent();
    // navigateToWebContent clicks the page body; make sure that opened nothing.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  return { note, resetAndOpenApp };
}
