import { expect, type TestInfo } from '@playwright/test';

// The subset of Guidepup's NVDA object these helpers use.
export interface SpeechSource {
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  capture<T>(action: () => Promise<T>, options?: { capture?: boolean | 'initial' }): Promise<unknown>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalise speech for robust matching: lower case, collapsed whitespace. */
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every phrase NVDA spoke since the log was last cleared, one per line. */
export async function spokenLog(nvda: SpeechSource): Promise<string[]> {
  return [...(await nvda.spokenPhraseLog())];
}

/**
 * Attach the full spoken log to the test result, so the text reporter prints
 * it for every test (and especially for failures).
 */
export async function attachSpokenLog(nvda: SpeechSource, testInfo: TestInfo, extra: string[] = []) {
  const log = await spokenLog(nvda).catch(() => ['(could not read the spoken log)']);
  const body = [...extra, ...log.map((p, i) => `${i + 1}. ${p === '' ? '(silence)' : p}`)].join('\n');
  await testInfo.attach('nvda-spoken-log', { body, contentType: 'text/plain' });
}

/** True when `text` contains every one of `words` (case-insensitive). */
export function containsAll(text: string, words: string[]): boolean {
  const t = norm(text);
  return words.every((w) => t.includes(norm(w)));
}

/**
 * Asserts that `joined` (from waitForSpeech) contains every word. On failure
 * the message names the missing words and everything NVDA said.
 */
export function expectSpoken(joined: string, words: string[], context = '') {
  const missing = words.filter((w) => !norm(joined).includes(norm(w)));
  expect(
    missing,
    `${context ? context + ': ' : ''}NVDA did not say [${missing.join(', ')}] (expected all of [${words.join(', ')}]). It said: ${joined}`,
  ).toEqual([]);
}

/**
 * Waits until the joined spoken log contains all `words`, listening for more
 * speech in short windows. Guidepup only records speech that arrives while one
 * of its actions is in flight, so each listening window is a no-op action with
 * full capture. Returns the joined log.
 */
export async function waitForSpeech(
  nvda: SpeechSource,
  words: string[],
  { timeoutMs = 5000, windowMs = 1000 } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let joined = (await spokenLog(nvda)).join(' | ');
  while (!containsAll(joined, words) && Date.now() < deadline) {
    await nvda.capture(() => delay(windowMs), { capture: true });
    joined = (await spokenLog(nvda)).join(' | ');
  }
  return joined;
}
