import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { db } from '../db.js';
import { clearProposals } from './hitlManager.js';
import {
  executeTool,
  registerBuiltInWriteTools,
  clearWriteTools,
  resolveChapter,
  resolveMapFilePath,
  summarizeResultForAudit,
  numberDuplicateCombatantNames,
} from './toolController.js';
import { indexCampaignLore } from './vectorStore.js';
import * as embedder from './embedder.js';
import * as llmClient from './llmClient.js';
import { handleAssistantChat } from './orchestrator.js';
import { parseScenarioCombatants, allocateTokenCoordinates, MAX_COMBATANTS_PER_CLAUSE } from './combatantParser.js';
import { setConfig, resetConfig, getConfig } from './config.js';

const insertUnit = db.prepare(
  'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

function cleanupCampaign(campaignId) {
  db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(campaignId);
  db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);
  db.prepare('DELETE FROM vector_chunks WHERE campaign_id = ?').run(campaignId);
  db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(campaignId);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
}

describe('Hunter fixes: orchestrator error path keeps staged proposals', () => {
  const campaignId = 'hf-orch-camp';
  const encounterId = 'hf-orch-enc';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();
    cleanupCampaign(campaignId);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(campaignId, 'HF Orch', '');
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encounterId,
      campaignId,
      'HF Encounter',
      JSON.stringify({
        combatants: [{ instanceId: 'hf-orch-gob', name: 'Goblin', currentHp: 7, maxHp: 7, initiative: 10, faction: 'enemy', position: { x: 1, y: 1 } }],
      })
    );
    insertUnit.run('hf-orch-gob', encounterId, campaignId, 'Goblin', 7, 7, 1, 10, 0, 'enemy', 1, 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupCampaign(campaignId);
  });

  it('returns proposals staged before the LLM call threw, and mentions them in the answer', async () => {
    const spy = vi.spyOn(llmClient, 'executeChatCompletion');
    spy.mockResolvedValueOnce({
      response: {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call-1',
                  function: { name: 'remove_combatant', arguments: JSON.stringify({ combatantName: 'Goblin', encounterId }) },
                },
              ],
            },
          },
        ],
      },
      modelUsed: 'qwen3.5:9b',
    });
    spy.mockRejectedValueOnce(new Error('connection reset'));

    const result = await handleAssistantChat({ query: 'remove the goblin', campaignId, encounterId });

    expect(result.isOffline).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].toolName).toBe('remove_combatant');
    expect(result.answer).toContain('already staged');
    expect(result.answer).toContain(result.proposals[0].description);
    // Still staged only: nothing was mutated
    expect(db.prepare('SELECT instanceId FROM encounter_units WHERE instanceId = ?').get('hf-orch-gob')).toBeDefined();
  });

  it('returns an empty proposals array when the LLM fails before anything is staged', async () => {
    vi.spyOn(llmClient, 'executeChatCompletion').mockRejectedValueOnce(new Error('boom'));
    const result = await handleAssistantChat({ query: 'hello', campaignId, encounterId });
    expect(result.isOffline).toBe(true);
    expect(result.proposals).toEqual([]);
  });
});

describe('Hunter fixes: indexCampaignLore ids, atomicity, serialization', () => {
  const worldId = 'hf-world';
  const campA = 'hf-lore-a';
  const campB = 'hf-lore-b';

  beforeEach(() => {
    for (const c of [campA, campB]) cleanupCampaign(c);
    db.prepare('DELETE FROM world_assets WHERE world_id = ?').run(worldId);
    db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
    db.prepare('INSERT INTO worlds (id, name, description) VALUES (?, ?, ?)').run(worldId, 'HF World', '');
    db.prepare('INSERT INTO world_assets (id, world_id, type, name, description) VALUES (?, ?, ?, ?, ?)').run(
      'wa1', worldId, 'location', 'Shared Keep', 'A keep shared by two campaigns.'
    );
    for (const c of [campA, campB]) {
      db.prepare('INSERT INTO campaigns (id, name, description, world_id) VALUES (?, ?, ?, ?)').run(c, c, '', worldId);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of [campA, campB]) cleanupCampaign(c);
    db.prepare('DELETE FROM world_assets WHERE world_id = ?').run(worldId);
    db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
  });

  it('gives each campaign its own world-asset chunks instead of stealing shared ones', async () => {
    await indexCampaignLore(campA);
    await indexCampaignLore(campB);

    const rowsA = db.prepare("SELECT id FROM vector_chunks WHERE campaign_id = ? AND source = 'world_asset'").all(campA);
    const rowsB = db.prepare("SELECT id FROM vector_chunks WHERE campaign_id = ? AND source = 'world_asset'").all(campB);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].id).not.toBe(rowsB[0].id);
  });

  it('clears legacy-format world_asset rows tagged with the campaign on reindex', async () => {
    db.prepare(
      "INSERT INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata) VALUES (?, 'world_asset', ?, 'wa1', 'old', 'old', '[]', '{}')"
    ).run(`world-${worldId}-asset-wa1`, campA);

    await indexCampaignLore(campA);

    expect(db.prepare('SELECT id FROM vector_chunks WHERE id = ?').get(`world-${worldId}-asset-wa1`)).toBeUndefined();
    expect(db.prepare("SELECT id FROM vector_chunks WHERE campaign_id = ? AND source = 'world_asset'").all(campA)).toHaveLength(1);
  });

  it('keeps existing lore when embedding fails', async () => {
    await indexCampaignLore(campA);
    const before = db.prepare('SELECT id FROM vector_chunks WHERE campaign_id = ?').all(campA);
    expect(before.length).toBeGreaterThan(0);

    vi.spyOn(embedder, 'computeSemanticEmbeddingsBatch').mockRejectedValueOnce(new Error('embed down'));
    await expect(indexCampaignLore(campA)).rejects.toThrow('embed down');

    const after = db.prepare('SELECT id FROM vector_chunks WHERE campaign_id = ?').all(campA);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it('serializes overlapping runs so a slow stale run cannot overwrite newer data', async () => {
    db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, 1)').run(
      'c1', campA, 'Chapter', 'old text',
    );
    let call = 0;
    vi.spyOn(embedder, 'computeSemanticEmbeddingsBatch').mockImplementation(async (chunks) => {
      const mine = ++call;
      if (mine === 1) await new Promise((r) => setTimeout(r, 60));
      return chunks.map((c) => embedder.computeLocalEmbedding(c.content, c.title));
    });

    const first = indexCampaignLore(campA);
    db.prepare('UPDATE chapters SET content = ? WHERE id = ? AND campaign_id = ?').run('new text', 'c1', campA);
    const second = indexCampaignLore(campA);
    await Promise.all([first, second]);

    const chapterRow = db.prepare("SELECT content FROM vector_chunks WHERE campaign_id = ? AND source = 'campaign_chapter'").get(campA);
    expect(chapterRow.content).toContain('new text');
    expect(chapterRow.content).not.toContain('old text');
  });
});

describe('Hunter fixes: turnIndex uses the phase-filtered list', () => {
  const campaignId = 'hf-turn-camp';
  const encounterId = 'hf-turn-enc';

  const mk = (id, name, initiative, phase) => ({
    instanceId: id, name, currentHp: 10, maxHp: 10, initiative, phase, isPlayer: false, faction: 'enemy', position: { x: 1, y: 1 },
  });

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();
    cleanupCampaign(campaignId);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(campaignId, 'HF Turn', '');
    const combatants = [mk('t-b', 'Bravo', 20, 2), mk('t-a', 'Alpha', 10, 1), mk('t-c', 'Charlie', 5, 1), mk('t-d', 'Delta', 1, 1)];
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encounterId,
      campaignId,
      'Turns',
      JSON.stringify({ isCombatStarted: true, round: 1, turnIndex: 2, activePhases: [1], combatants })
    );
    for (const c of combatants) insertUnit.run(c.instanceId, encounterId, campaignId, c.name, 10, 10, 0, c.initiative, 0, 'enemy', 1, 1);
  });

  afterEach(() => cleanupCampaign(campaignId));

  it('get_initiative_order resolves the current turn against visible (phase 1) combatants', async () => {
    const result = await executeTool('get_initiative_order', {}, { campaignId, encounterId });
    // visible = [Alpha, Charlie, Delta]; index 2 = Delta (full-list index 2 would be Charlie/Alpha depending on sort)
    expect(result.currentTurnCombatant).toBe('Delta');
    expect(result.order.filter((o) => o.isCurrentTurn).map((o) => o.name)).toEqual(['Delta']);
  });

  it('remove_combatant does not shift turnIndex when the removed combatant is in a hidden phase', async () => {
    const staged = await executeTool('remove_combatant', { combatantId: 't-b', encounterId }, { campaignId, encounterId });
    const res = await request(app).post('/api/assistant/confirm').send({ proposalId: staged.proposal.proposalId, action: 'approve' });
    expect(res.status).toBe(200);
    const rs = JSON.parse(db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId).running_state);
    expect(rs.turnIndex).toBe(2);
  });

  it('remove_combatant shifts turnIndex when a visible earlier combatant is removed', async () => {
    const staged = await executeTool('remove_combatant', { combatantId: 't-a', encounterId }, { campaignId, encounterId });
    const res = await request(app).post('/api/assistant/confirm').send({ proposalId: staged.proposal.proposalId, action: 'approve' });
    expect(res.status).toBe(200);
    const rs = JSON.parse(db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId).running_state);
    expect(rs.turnIndex).toBe(1);
  });
});

describe('Hunter fixes: read-tool combatant lookup', () => {
  const campaignId = 'hf-look-camp';
  const encounterId = 'hf-look-enc';

  beforeEach(() => {
    cleanupCampaign(campaignId);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(campaignId, 'HF Look', '');
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encounterId,
      campaignId,
      'Lookup',
      JSON.stringify({
        combatants: [
          { instanceId: 'l-1', name: 'Grog Strongjaw', currentHp: 30, maxHp: 40, isPlayer: true, position: { x: 2, y: 3 } },
          { instanceId: 'l-2', name: 'Goblin Archer', currentHp: 7, maxHp: 7, position: { x: 4, y: 4 } },
          { instanceId: 'l-3', name: 'Goblin Boss', currentHp: 21, maxHp: 21, position: { x: 5, y: 5 } },
        ],
      })
    );
  });

  afterEach(() => cleanupCampaign(campaignId));

  const ctx = () => ({ campaignId, encounterId });

  it.each(['get_monster_hp', 'get_character_hp', 'get_entity_position'])('%s rejects an empty name', async (tool) => {
    await expect(executeTool(tool, { name_or_id: '   ' }, ctx())).rejects.toThrow(/required/);
    await expect(executeTool(tool, {}, ctx())).rejects.toThrow(/required/);
  });

  it.each(['get_monster_hp', 'get_character_hp', 'get_entity_position'])('%s treats SQL wildcards literally', async (tool) => {
    const pct = await executeTool(tool, { name_or_id: '%' }, ctx());
    const underscore = await executeTool(tool, { name_or_id: '_' }, ctx());
    expect(pct.error).toBeDefined();
    expect(underscore.error).toBeDefined();
  });

  it('reports ambiguity instead of returning the first partial match', async () => {
    await expect(executeTool('get_character_hp', { name_or_id: 'goblin' }, ctx())).rejects.toThrow(/multiple combatants/);
  });

  it('does not match when the query merely contains a combatant name', async () => {
    const result = await executeTool('get_entity_position', { name_or_id: 'the great Grog Strongjaw of doom' }, ctx());
    expect(result.error).toBeDefined();
  });

  it('still resolves exact, partial, and instanceId references', async () => {
    expect((await executeTool('get_character_hp', { name_or_id: 'Goblin Archer' }, ctx())).instanceId).toBe('l-2');
    expect((await executeTool('get_character_hp', { name_or_id: 'grog' }, ctx())).instanceId).toBe('l-1');
    expect((await executeTool('get_entity_position', { name_or_id: 'l-3' }, ctx())).position).toEqual({ x: 5, y: 5 });
  });

  it('falls back to encounter_units and treats wildcards literally there too', async () => {
    db.prepare('UPDATE encounters SET running_state = NULL WHERE id = ?').run(encounterId);
    insertUnit.run('l-u1', encounterId, campaignId, 'Ogre', 59, 59, 0, 5, 0, 'enemy', 6, 6);
    expect((await executeTool('get_entity_position', { name_or_id: 'ogre' }, ctx())).position).toEqual({ x: 6, y: 6 });
    expect((await executeTool('get_entity_position', { name_or_id: '%' }, ctx())).error).toBeDefined();
  });
});

describe('Hunter fixes: combatantParser limits', () => {
  it('rejects an absurd count with a clear error', () => {
    expect(() =>
      parseScenarioCombatants('9999999 goblins at B2', {}, [{ id: 'goblin', name: 'Goblin' }])
    ).toThrow(new RegExp(`maximum of ${MAX_COMBATANTS_PER_CLAUSE}`));
  });

  it('still allows a count at the cap', () => {
    const out = parseScenarioCombatants(`${MAX_COMBATANTS_PER_CLAUSE} goblins at B2`, {}, [{ id: 'goblin', name: 'Goblin' }], new Set(), { columns: 20, rows: 20 });
    expect(out).toHaveLength(MAX_COMBATANTS_PER_CLAUSE);
  });

  it('ring search visits cells in nearest-first order and fills a small grid without duplicates', () => {
    const occupied = new Set();
    const grid = { columns: 5, rows: 5 };
    const first = allocateTokenCoordinates({ x: 2, y: 2 }, occupied, grid);
    expect(first).toMatchObject({ x: 2, y: 2 });
    const second = allocateTokenCoordinates({ x: 2, y: 2 }, occupied, grid);
    // top-left of the dist-1 ring is visited first
    expect(second).toMatchObject({ x: 1, y: 1 });

    const seen = new Set(['2,2', '1,1']);
    for (let i = 0; i < 23; i++) {
      const p = allocateTokenCoordinates({ x: 2, y: 2 }, occupied, grid);
      expect(p.placementFailed).toBeUndefined();
      expect(seen.has(`${p.x},${p.y}`)).toBe(false);
      seen.add(`${p.x},${p.y}`);
    }
    expect(seen.size).toBe(25);
    expect(allocateTokenCoordinates({ x: 2, y: 2 }, occupied, grid).placementFailed).toBe(true);
  });
});

describe('Hunter fixes: configure_encounter_combatants explicit list validation', () => {
  const campaignId = 'hf-cfg-camp';
  const encounterId = 'hf-cfg-enc';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();
    cleanupCampaign(campaignId);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(campaignId, 'HF Cfg', '');
    db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)').run(encounterId, campaignId, 'Cfg Enc');
  });

  afterEach(() => cleanupCampaign(campaignId));

  const run = (combatants) =>
    executeTool('configure_encounter_combatants', { combatants, encounterId }, { campaignId, encounterId });

  it.each([[0], [-5], [1.5], ['abc'], [1e9]])('rejects invalid hp %s', async (hp) => {
    await expect(run([{ name: 'Orc', coordinates: 'B2', hp }])).rejects.toThrow(/Invalid hp/);
  });

  it('coerces numeric-string hp to an integer', async () => {
    const res = await run([{ name: 'Orc', coordinates: 'B2', hp: '15' }]);
    expect(res.proposal.payload.combatants[0].hp).toBe(15);
  });

  it('auto-numbers duplicate names', async () => {
    const res = await run([
      { name: 'Wolf', coordinates: 'B2' },
      { name: 'wolf', coordinates: 'B3' },
      { name: 'Bear', coordinates: 'B4' },
    ]);
    expect(res.proposal.payload.combatants.map((c) => c.name)).toEqual(['Wolf 1', 'wolf 2', 'Bear']);
  });

  it('numberDuplicateCombatantNames leaves unique names untouched', () => {
    const list = [{ name: 'A' }, { name: 'B' }];
    expect(numberDuplicateCombatantNames(list).map((c) => c.name)).toEqual(['A', 'B']);
  });
});

describe('Hunter fixes: audit summary strips base64 images', () => {
  it('omits data-URI images from the summary', () => {
    const summary = summarizeResultForAudit({ success: true, image: 'data:image/png;base64,' + 'A'.repeat(5000), n: 1 });
    expect(summary).not.toContain('base64');
    expect(summary).toContain('[image omitted]');
    expect(summary).toContain('"n":1');
  });

  it('truncates long results to 200 chars', () => {
    expect(summarizeResultForAudit({ text: 'x'.repeat(1000) }).length).toBe(200);
  });
});

describe('Hunter fixes: encounter/chapter resolution', () => {
  const campA = 'hf-res-a';
  const campB = 'hf-res-b';
  const encId = 'hf-res-enc';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();
    for (const c of [campA, campB]) {
      cleanupCampaign(c);
      db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(c, c, '');
    }
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encId, campA, 'Res Enc', JSON.stringify({ combatants: [{ instanceId: 'r1', name: 'Goblin', currentHp: 1, maxHp: 1, position: { x: 0, y: 0 } }] })
    );
    insertUnit.run('r1', encId, campA, 'Goblin', 1, 1, 0, 1, 0, 'enemy', 0, 0);
    db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run('ra1', campA, 'Arrival', '# Hi', 1);
    db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run('rb1', campB, 'Betrayal', '# Yo', 1);
  });

  afterEach(() => {
    for (const c of [campA, campB]) cleanupCampaign(c);
  });

  it('throws when an explicit encounterId does not exist instead of using another encounter', async () => {
    await expect(
      executeTool('remove_combatant', { combatantId: 'r1', encounterId: 'no-such-enc' }, { campaignId: campA })
    ).rejects.toThrow(/not found/);
    await expect(
      executeTool('remove_combatant', { combatantId: 'r1', encounterId: 'no-such-enc' }, {})
    ).rejects.toThrow(/not found/);
  });

  it('still falls back to the campaign encounter when no encounterId is supplied', async () => {
    const res = await executeTool('remove_combatant', { combatantId: 'r1' }, { campaignId: campA });
    expect(res.status).toBe('proposal_staged');
  });

  it('resolveChapter throws with the available chapters on an explicit miss', () => {
    expect(() => resolveChapter('Zzzzqqq', { campaignId: campA })).toThrow(/Available chapters: "Arrival"/);
  });

  it('resolveChapter does not leak chapters from other campaigns', () => {
    expect(() => resolveChapter('Betrayal', { campaignId: campA })).toThrow(/not found/);
    expect(() => resolveChapter('rb1', { campaignId: campA })).toThrow(/not found/);
    expect(resolveChapter('Betrayal', { campaignId: campB }).id).toBe('rb1');
  });

  it('resolveChapter treats LIKE wildcards in the identifier literally', () => {
    expect(() => resolveChapter('%', { campaignId: campA })).toThrow(/not found/);
  });

  it('resolveChapter fallbacks stay inside the active campaign', () => {
    expect(resolveChapter(undefined, { campaignId: campA, chapterId: 'rb1' }).id).toBe('ra1');
    expect(resolveChapter(undefined, { campaignId: campA }).id).toBe('ra1');
  });

  it('get_chapter_outline surfaces the miss as a tool error', async () => {
    await expect(
      executeTool('get_chapter_outline', { chapter_name_or_id: 'Nonexistent' }, { campaignId: campA })
    ).rejects.toThrow(/Available chapters/);
  });
});

describe('Hunter fixes: resolveMapFilePath containment', () => {
  it('resolves a legitimate public map', () => {
    expect(resolveMapFilePath('/maps/5.1-palma-flora-player.png')).toMatch(/palma-flora-player\.png$/);
  });

  it('rejects traversal out of public/', () => {
    expect(resolveMapFilePath('/../../package.json')).toBeNull();
    expect(resolveMapFilePath('../../../package.json')).toBeNull();
    expect(resolveMapFilePath('/maps/../../package.json')).toBeNull();
    expect(resolveMapFilePath('..\\..\\package.json')).toBeNull();
  });

  it('rejects absolute paths outside public/', () => {
    expect(resolveMapFilePath(process.cwd() + '/package.json')).toBeNull();
    expect(resolveMapFilePath('C:\\Windows\\win.ini')).toBeNull();
    expect(resolveMapFilePath('/etc/passwd')).toBeNull();
  });
});

describe('Hunter fixes: config coercion and LLM client hardening', () => {
  beforeEach(() => resetConfig());
  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  it('coerces numeric strings', () => {
    setConfig({ maxContextTokens: '4096', topKPassages: '5' });
    expect(getConfig().maxContextTokens).toBe(4096);
    expect(getConfig().topKPassages).toBe(5);
  });

  it.each(['maxContextTokens', 'topKPassages', 'maxToolIterations', 'maxTokens', 'numCtx'])('rejects NaN for %s', (key) => {
    expect(() => setConfig({ [key]: 'abc' })).toThrow(/finite number/);
    expect(() => setConfig({ [key]: NaN })).toThrow(/finite number/);
  });

  it('enforces upper bounds on maxTokens and numCtx', () => {
    setConfig({ maxTokens: 10_000_000, numCtx: 10_000_000 });
    expect(getConfig().maxTokens).toBeLessThanOrEqual(16384);
    expect(getConfig().numCtx).toBeLessThanOrEqual(32768);
  });

  it('caches the OpenAI client and rebuilds only when settings change', () => {
    const a = llmClient.getOpenAIClient();
    expect(llmClient.getOpenAIClient()).toBe(a);
    setConfig({ baseURL: 'http://localhost:9999/v1' });
    expect(llmClient.getOpenAIClient()).not.toBe(a);
  });

  const okResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({ message: { role: 'assistant', content: 'hi' }, model: 'm', done: true }),
  });

  it('passes an abort signal to the Ollama fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await llmClient.callOllamaNativeChat({ baseURL: 'http://localhost:11434/v1', model: 'qwen3.5:9b', messages: [{ role: 'user', content: 'x' }] });
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('turns a timeout into a clear error', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(err);
    await expect(
      llmClient.callOllamaNativeChat({ baseURL: 'http://localhost:11434/v1', model: 'qwen3.5:9b', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow(/timed out/);
  });
});
