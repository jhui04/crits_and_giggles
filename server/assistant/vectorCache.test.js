import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db.js';
import {
  upsertVectorChunk,
  batchUpsertVectorChunks,
  searchVectorStore,
  indexCampaignLore,
  invalidateVectorCache,
  removeVectorChunksFromCache,
} from './vectorStore.js';

const PREFIX = 'vc-test-';
const CAMP = 'vc-test-camp';

function fullLoadCount(spy) {
  return spy.mock.calls.filter(([sql]) => /SELECT id, source, campaign_id, title, embedding, embedding_kind FROM vector_chunks/.test(sql)).length;
}

function vec(seed) {
  const v = new Array(8).fill(0);
  v[seed % 8] = 1;
  return v;
}

function cleanup() {
  db.prepare("DELETE FROM vector_chunks WHERE id LIKE 'vc-test-%' OR campaign_id = ?").run(CAMP);
  db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(CAMP);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(CAMP);
}

describe('vector cache incremental maintenance', () => {
  beforeEach(() => {
    cleanup();
    invalidateVectorCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    invalidateVectorCache();
  });

  it('upserts, replaces and deletes without a full reload', async () => {
    batchUpsertVectorChunks([{ id: `${PREFIX}a`, source: 'srd', title: 'zzqx alpha', content: 'alpha', embedding: vec(1) }]);
    // Prime the cache (one full load).
    const spy = vi.spyOn(db, 'prepare');
    let r = await searchVectorStore('zzqx alpha', { forceLocal: true, limit: 5, sourceFilter: 'srd' });
    expect(r.map((x) => x.id)).toContain(`${PREFIX}a`);
    expect(fullLoadCount(spy)).toBe(1);

    await upsertVectorChunk({ id: `${PREFIX}b`, source: 'srd', title: 'zzqx beta', content: 'beta', embedding: vec(2) });
    batchUpsertVectorChunks([{ id: `${PREFIX}a`, source: 'srd', title: 'zzqx renamed', content: 'alpha2', embedding: vec(3) }]);

    r = await searchVectorStore('zzqx', { forceLocal: true, limit: 10, sourceFilter: 'srd' });
    const ids = r.map((x) => x.id);
    expect(ids).toContain(`${PREFIX}a`);
    expect(ids).toContain(`${PREFIX}b`);
    expect(r.find((x) => x.id === `${PREFIX}a`).title).toBe('zzqx renamed');

    db.prepare('DELETE FROM vector_chunks WHERE id = ?').run(`${PREFIX}b`);
    removeVectorChunksFromCache([`${PREFIX}b`]);
    r = await searchVectorStore('zzqx', { forceLocal: true, limit: 10, sourceFilter: 'srd' });
    expect(r.map((x) => x.id)).not.toContain(`${PREFIX}b`);

    expect(fullLoadCount(spy)).toBe(1);

    invalidateVectorCache();
    await searchVectorStore('zzqx', { forceLocal: true, limit: 10, sourceFilter: 'srd' });
    expect(fullLoadCount(spy)).toBe(2);
  });

  it('indexCampaignLore swaps campaign entries in the cache without a full reload', async () => {
    db.prepare("INSERT INTO campaigns (id, name) VALUES (?, 'VC')").run(CAMP);
    db.prepare("INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES ('vc-test-ch1', ?, 'Zorblax Keep', 'The zorblax keep is old.', 0)").run(CAMP);
    await indexCampaignLore(CAMP);

    const spy = vi.spyOn(db, 'prepare');
    let r = await searchVectorStore('zorblax keep', { campaignId: CAMP, forceLocal: true, limit: 5, sourceFilter: 'campaign_chapter' });
    expect(r.length).toBeGreaterThan(0);
    const loadsAfterPrime = fullLoadCount(spy);

    db.prepare("UPDATE chapters SET title = 'Quuxfell Hall', content = 'quuxfell hall text' WHERE id = 'vc-test-ch1'").run();
    await indexCampaignLore(CAMP);

    r = await searchVectorStore('quuxfell hall', { campaignId: CAMP, forceLocal: true, limit: 5, sourceFilter: 'campaign_chapter' });
    expect(r[0].title).toContain('Quuxfell');
    expect(r.every((x) => !x.title.includes('Zorblax'))).toBe(true);
    expect(fullLoadCount(spy)).toBe(loadsAfterPrime);

    // Scoping: other campaigns/global searches do not see campaign lore.
    const global = await searchVectorStore('quuxfell hall', { forceLocal: true, limit: 50, sourceFilter: 'campaign_chapter' });
    expect(global).toEqual([]);
  });

  it('incremental cache gives the same results as a fresh full load', async () => {
    batchUpsertVectorChunks(
      Array.from({ length: 12 }, (_, i) => ({
        id: `${PREFIX}p${i}`, source: 'srd', title: `parity item ${i % 3}`, content: `c${i}`, embedding: vec(i),
      }))
    );
    await searchVectorStore('parity', { forceLocal: true, limit: 3, sourceFilter: 'srd' }); // prime
    await upsertVectorChunk({ id: `${PREFIX}p99`, source: 'srd', title: 'parity item 1', content: 'x', embedding: vec(4) });
    const opts = { forceLocal: true, limit: 6, sourceFilter: ['srd'] };
    const incremental = await searchVectorStore('parity item 1', opts);
    invalidateVectorCache();
    const fresh = await searchVectorStore('parity item 1', opts);
    expect(incremental.map((x) => [x.id, x.score])).toEqual(fresh.map((x) => [x.id, x.score]));
    const scores = incremental.map((x) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(incremental).toHaveLength(6);
  });

  it('dedupes concurrent initial reindexes when the index is empty', async () => {
    const embedder = await import('./embedder.js');
    const batchSpy = vi.spyOn(embedder, 'computeSemanticEmbeddingsBatch');
    const saved = db.prepare('SELECT * FROM vector_chunks').all();
    db.prepare('DELETE FROM vector_chunks').run();
    invalidateVectorCache();
    try {
      await Promise.all([
        searchVectorStore('fireball', { forceLocal: true }),
        searchVectorStore('goblin', { forceLocal: true }),
        searchVectorStore('grapple', { forceLocal: true }),
      ]);
      expect(batchSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      const ins = db.prepare('INSERT OR REPLACE INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      db.transaction(() => {
        for (const r of saved) ins.run(r.id, r.source, r.campaign_id, r.entity_id, r.title, r.content, r.embedding, r.metadata);
      })();
      invalidateVectorCache();
    }
  });

  it('does not force reindex when the cache load hits a DB error', async () => {
    const realPrepare = db.prepare.bind(db);
    const embedder = await import('./embedder.js');
    const batchSpy = vi.spyOn(embedder, 'computeSemanticEmbeddingsBatch');
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (/SELECT id, source, campaign_id, title, embedding, embedding_kind FROM vector_chunks/.test(sql)) throw new Error('boom');
      return realPrepare(sql);
    });
    const r = await searchVectorStore('anything', { forceLocal: true });
    expect(r).toEqual([]);
    expect(batchSpy).not.toHaveBeenCalled();
  });
});

describe('embedding kind tagging', () => {
  beforeEach(() => {
    cleanup();
    invalidateVectorCache();
  });
  afterEach(() => {
    cleanup();
    invalidateVectorCache();
  });

  it('tags local fallback chunks and dense chunks differently', async () => {
    batchUpsertVectorChunks([
      { id: `${PREFIX}local`, source: 'srd', title: 'zzkind local', content: 'goblin ambush tactics' },
      { id: `${PREFIX}dense`, source: 'srd', title: 'zzkind dense', content: 'x', embedding: vec(1) },
    ]);
    const rows = db.prepare("SELECT id, embedding_kind FROM vector_chunks WHERE id LIKE 'vc-test-%'").all();
    const kinds = Object.fromEntries(rows.map((r) => [r.id, r.embedding_kind]));
    expect(kinds[`${PREFIX}local`]).toBe('local');
    expect(kinds[`${PREFIX}dense`]).toBe('dense:8');
  });

  it('scores local chunks by content even when the query used a dense model of another size', async () => {
    batchUpsertVectorChunks([
      { id: `${PREFIX}gob`, source: 'srd', title: 'note', content: 'goblin ambush tactics in the forest' },
      { id: `${PREFIX}other`, source: 'srd', title: 'note', content: 'dragon hoard treasure vault' },
    ]);
    // Simulate Ollama coming up after indexing: dense 8-d query vector.
    const embedder = await import('./embedder.js');
    const llm = await import('./llmClient.js');
    process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK = '0'; // contact the (mocked) model
    const spy = vi.spyOn(llm, 'createEmbedding').mockResolvedValue(vec(2));
    try {
      const r = await searchVectorStore('goblin ambush tactics', { limit: 2, sourceFilter: 'srd' });
      expect(embedder.embeddingKind(vec(2))).toBe('dense:8');
      expect(r[0].id).toBe(`${PREFIX}gob`);
      expect(r[0].score).toBeGreaterThan(0.3);
    } finally {
      spy.mockRestore();
      delete process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK;
    }
  });

  it('treats legacy rows without a kind by inferring it', async () => {
    batchUpsertVectorChunks([{ id: `${PREFIX}legacy`, source: 'srd', title: 'zzlegacy', content: 'goblin ambush' }]);
    db.prepare("UPDATE vector_chunks SET embedding_kind = NULL WHERE id = ?").run(`${PREFIX}legacy`);
    invalidateVectorCache();
    const r = await searchVectorStore('goblin ambush', { forceLocal: true, limit: 3, sourceFilter: 'srd' });
    expect(r.find((x) => x.id === `${PREFIX}legacy`).score).toBeGreaterThan(0.5);
  });
});
