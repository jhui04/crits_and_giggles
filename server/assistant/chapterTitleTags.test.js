import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import '../index.js';
import { db } from '../db.js';
import { executeTool } from './toolController.js';
import { getAuthoritativeGameState, buildChatMessages } from './contextBuilder.js';

// Chapter titles can hold @Tag[id]{Name} markup. The assistant should only
// ever see the names, and a stripped title should still resolve the chapter.
const CAMP = 'title-tags-camp';
const CHAP = 'title-tags-chap';
const RAW_TITLE = 'Ambush @World[192]{Palma Flora}';
const TITLE = 'Ambush Palma Flora';

beforeEach(() => {
  db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(CAMP);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(CAMP);
  db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(CAMP, 'Title Tags', 'tags');
  db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
    CHAP, CAMP, RAW_TITLE, '# Setup\nThe bandits wait in the reeds.', 1
  );
});

afterAll(() => {
  db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(CAMP);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(CAMP);
});

describe('chapter titles reach the assistant without tag markup', () => {
  it('strips tags from the active chapter title in the game state and prompt', () => {
    const gameState = getAuthoritativeGameState({ campaignId: CAMP, chapterId: CHAP, chapterName: RAW_TITLE });
    expect(gameState.activeChapter.title).toBe(TITLE);

    const { messages } = buildChatMessages({ query: 'Where are we?', gameState, campaignId: CAMP });
    expect(messages[0].content).toContain(`Title: "${TITLE}"`);
    expect(messages[0].content).not.toContain('@World[192]{Palma Flora}');
  });

  it('still finds the chapter by its raw title when the id is unknown', () => {
    const gameState = getAuthoritativeGameState({ campaignId: CAMP, chapterId: 'missing', chapterName: RAW_TITLE });
    expect(gameState.activeChapter.id).toBe(CHAP);
    expect(gameState.activeChapter.title).toBe(TITLE);
  });

  it('resolves a chapter tool call by the stripped title and returns it stripped', async () => {
    const res = await executeTool('get_chapter_outline', { chapter_name_or_id: TITLE }, { campaignId: CAMP });
    expect(res.chapterId).toBe(CHAP);
    expect(res.chapterTitle).toBe(TITLE);
  });

  it('strips tags from chapter names in asset search results', async () => {
    const res = await executeTool('search_assets_and_lore', { query: TITLE, category: 'chapter' }, { campaignId: CAMP });
    expect(JSON.stringify(res)).not.toContain('@World[');
    expect(res.results.some((r) => r.name === TITLE)).toBe(true);
  });
});
