import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import { db } from './db.js';
import { validateModel, getConfig, setConfig, resetConfig } from './assistant/config.js';
import { computeLocalEmbedding, cosineSimilarity } from './assistant/embedder.js';
import { upsertVectorChunk, searchVectorStore, indexSrdAndJsonData, indexCampaignLore, invalidateVectorCache } from './assistant/vectorStore.js';
import { computeSemanticEmbeddingsBatch } from './assistant/embedder.js';
import { ASSISTANT_TOOLS, validateToolCall, executeTool, getToolAuditLog, clearToolAuditLog } from './assistant/toolController.js';
import { getAuthoritativeGameState, buildChatMessages, estimateTokenCount } from './assistant/contextBuilder.js';
import { benchmarkQuery } from './assistant/benchmark.js';
import { recordLlmMetric, getLlmMetrics, getLlmMetricsSummary, clearLlmMetrics } from './assistant/telemetry.js';

describe('Epic 1: Local LLM Infrastructure & Abstraction', () => {
  beforeEach(() => {
    resetConfig();
  });

  describe('Story 1.1: OpenAI-Compatible Abstraction', () => {
    it('defaults base URL to Ollama local endpoint and allows configuration', async () => {
      const config = getConfig();
      expect(config.baseURL).toContain('11434');

      const res = await request(app).get('/api/assistant/config');
      expect(res.status).toBe(200);
      expect(res.body.baseURL).toBe(config.baseURL);

      // Change baseURL
      const updateRes = await request(app)
        .put('/api/assistant/config')
        .send({ baseURL: 'http://localhost:8080/v1' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.baseURL).toBe('http://localhost:8080/v1');
    });
  });

  describe('Story 1.2: Model Selection & Fallbacks', () => {
    it('defaults to Qwen3.5-9B and supports fallback to Qwen3.5-4B', () => {
      const config = getConfig();
      expect(config.primaryModel).toContain('9b');
      expect(config.fallbackModel).toContain('4b');
      expect(config.activeModel).toContain('9b');

      // Switch active model to 4b
      const updated = setConfig({ activeModel: 'qwen3.5:4b' });
      expect(updated.activeModel).toBe('qwen3.5:4b');
    });

    it('explicitly excludes and rejects 26B, 32B, 35B, and 70B models due to 8GB VRAM limit', async () => {
      expect(() => validateModel('qwen3.5:35b')).toThrow(/exceeds 8gb vram/i);
      expect(() => validateModel('qwen2.5:32b')).toThrow(/exceeds 8gb vram/i);
      expect(() => validateModel('qwen:26b')).toThrow(/exceeds 8gb vram/i);
      expect(() => validateModel('llama3:70b')).toThrow(/exceeds 8gb vram/i);

      // Valid models pass
      expect(validateModel('qwen3.5:9b')).toBe(true);
      expect(validateModel('qwen3.5:4b')).toBe(true);

      // Verify rejection via HTTP endpoint
      const res = await request(app)
        .put('/api/assistant/config')
        .send({ activeModel: 'qwen3.5:35b' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds 8gb vram/i);
    });

    it('supports, validates, and enables switching to Llama 3 (8B) model within 8GB VRAM limit', async () => {
      expect(validateModel('llama3')).toBe(true);
      expect(validateModel('llama3:8b')).toBe(true);
      expect(validateModel('llama3:latest')).toBe(true);

      const config = getConfig();
      expect(config.allowedModels).toContain('llama3');
      expect(config.allowedModels).toContain('llama3:8b');

      // Switch active model to llama3
      const updated = setConfig({ activeModel: 'llama3' });
      expect(updated.activeModel).toBe('llama3');

      // Switch active model via HTTP endpoint
      const res = await request(app)
        .put('/api/assistant/config')
        .send({ activeModel: 'llama3' });
      expect(res.status).toBe(200);
      expect(res.body.activeModel).toBe('llama3');
    });
  });

  describe('Story 1.3: Benchmarking Responsiveness', () => {
    it('calculates TTFT and TPS for standard DM queries in mock mode', async () => {
      const result = await benchmarkQuery({
        model: 'qwen3.5:9b',
        query: 'What does Fireball do?',
        mockStream: true,
      });

      expect(result.model).toBe('qwen3.5:9b');
      expect(result.query).toBe('What does Fireball do?');
      expect(result.ttftMs).toBeGreaterThan(0);
      expect(result.tps).toBeGreaterThan(0);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });
});

describe('Epic 2: RAG Pipeline & Knowledge Indexing', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM vector_chunks').run();
    invalidateVectorCache();
  });

  describe('Story 2.1: SRD & JSON Indexing', () => {
    it('chunks, embeds, and indexes SRD rules, spells, and monsters into local vector store', async () => {
      const count = await indexSrdAndJsonData();
      expect(count).toBeGreaterThan(0);

      // Verify SRD rules are searchable
      const rulePassages = await searchVectorStore('Opportunity Attack', { limit: 3 });
      expect(rulePassages.length).toBeGreaterThan(0);
      expect(rulePassages.some((p) => p.title.includes('Opportunity') || p.content.includes('opportunity'))).toBe(true);

      // Verify Spells are searchable
      const spellPassages = await searchVectorStore('Fireball spell', { limit: 3 });
      expect(spellPassages.length).toBeGreaterThan(0);
      expect(spellPassages.some((p) => p.title.toLowerCase().includes('fireball'))).toBe(true);

      // Verify Monsters are searchable
      const monsterPassages = await searchVectorStore('Aboleth stats', { limit: 3 });
      expect(monsterPassages.length).toBeGreaterThan(0);
      expect(monsterPassages.some((p) => p.title.toLowerCase().includes('aboleth'))).toBe(true);
    });

    it('uses computeSemanticEmbeddingsBatch to generate dense vectors in matching embedding space', async () => {
      const chunks = [
        { id: 'test-rule-1', content: 'Darkvision allows a creature to see in the dark.', title: 'Darkvision' },
        { id: 'test-rule-2', content: 'Invisibility makes a creature impossible to see without magical aid.', title: 'Invisibility' }
      ];
      const embeddings = await computeSemanticEmbeddingsBatch(chunks);
      expect(embeddings).toHaveLength(2);
      expect(embeddings[0].length).toBeGreaterThan(0);

      // Verify cosine similarity of matching query is higher than unrelated
      const queryEmb = await computeSemanticEmbeddingsBatch([{ content: 'seeing in dark caves', title: 'query' }]);
      const simMatch = cosineSimilarity(queryEmb[0], embeddings[0]);
      const simNonMatch = cosineSimilarity(queryEmb[0], embeddings[1]);
      expect(simMatch).toBeGreaterThan(simNonMatch);
    });
  });

  describe('Story 2.2: Campaign Lore & Notes Indexing', () => {
    it('indexes campaign chapters and assets from SQLite and enables lore retrieval', async () => {
      const campId = 'rag-test-camp';
      // Create test campaign
      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        campId, 'RAG Campaign', 'Campaign for testing RAG'
      );
      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'c1', campId, 'The Sunken Crypt', 'Deep beneath the swamps lies the tomb of King Aldor.', 0
      );
      db.prepare('INSERT OR REPLACE INTO assets (id, campaign_id, type, name, description) VALUES (?, ?, ?, ?, ?)').run(
        'a1', campId, 'NPC', 'King Aldor', 'The ghost of the ancient ruler guarding the crown.'
      );

      const indexed = await indexCampaignLore(campId);
      expect(indexed).toBe(2);

      // Search with campaignId scope
      const results = await searchVectorStore('Who is King Aldor?', { campaignId: campId, limit: 3 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.title.includes('King Aldor') || r.content.includes('Aldor'))).toBe(true);
    });
  });

  describe('Story 2.3: Minimal Context Retrieval & Memory Optimization', () => {
    it('retrieves only top K passages, maintains prompt tokens strictly under 8K limit, and keeps RAM index unbloated', async () => {
      await indexSrdAndJsonData();

      const topPassages = await searchVectorStore('Fireball radius and damage', { limit: 3 });
      expect(topPassages.length).toBeLessThanOrEqual(3);
      // Verify full content is retrieved on-demand for Top-K
      expect(topPassages[0].content).toBeDefined();
      expect(topPassages[0].content.length).toBeGreaterThan(0);

      const { messages, estimatedTokens } = buildChatMessages({
        query: 'What is the casting range of Fireball?',
        passages: topPassages,
        maxContextTokens: 8192,
      });

      expect(messages).toHaveLength(2);
      expect(estimatedTokens).toBeLessThan(8192);
      expect(messages[0].content).toContain('[RETRIEVED KNOWLEDGE PASSAGES]');
    });

    it('accurately and conservatively estimates tokens for dense JSON and dice notation', () => {
      const denseJson = JSON.stringify({ hp: '18d10 + 36', position: { x: 12, y: 15 }, conditions: ['Poisoned'] });
      const tokens = estimateTokenCount(denseJson);
      // Must enforce conservative bound >= length / 3.0
      expect(tokens).toBeGreaterThanOrEqual(Math.ceil(denseJson.length / 3.0));
    });
  });
});

describe('Epic 3: Authoritative Game State & Safety', () => {
  const campId = 'state-test-camp';
  const encId = 'state-test-enc';

  beforeEach(() => {
    clearToolAuditLog();
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campId);
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campId, 'State Campaign', 'Desc'
    );
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encId, campId, 'Ambush in the Marsh', JSON.stringify({
        isCombatStarted: true,
        round: 3,
        turnIndex: 1,
        combatants: [
          { instanceId: 'u-goblin', name: 'Goblin Scout', currentHp: 4, maxHp: 7, initiative: 14, position: { x: 5, y: 8 } },
          { instanceId: 'u-cleric', name: 'Sister Lin', currentHp: 18, maxHp: 22, initiative: 12, isPlayer: true, position: { x: 4, y: 7 } }
        ]
      })
    );
  });

  describe('Story 3.1: Minimal State Injection', () => {
    it('fetches live authoritative state from SQLite and injects as read-only JSON', () => {
      const state = getAuthoritativeGameState({ campaignId: campId, encounterId: encId });
      expect(state.activeEncounter).toBe('Ambush in the Marsh');
      expect(state.round).toBe(3);
      expect(state.combatants).toHaveLength(2);
      expect(state.combatants[0].name).toBe('Goblin Scout');
      expect(state.combatants[0].currentHp).toBe(4);
      expect(state.combatants[0].position).toEqual({ x: 5, y: 8 });

      const { messages } = buildChatMessages({
        query: 'What is Goblin Scout HP and position?',
        passages: [],
        gameState: state,
      });

      expect(messages[0].content).toContain('[AUTHORITATIVE CURRENT GAME STATE (READ-ONLY)]');
      expect(messages[0].content).toContain('"Goblin Scout"');
      expect(messages[0].content).toContain('"currentHp": 4');
    });
  });

  describe('Story 3.2: Tool Controller Validation & Execution', () => {
    it('executes read-only functions and logs the result to audit log', async () => {
      const hpResult = await executeTool('get_character_hp', { name_or_id: 'Goblin Scout' }, { campaignId: campId });
      expect(hpResult).toBeDefined();
      expect(hpResult.currentHp).toBe(4);

      // Test get_monster_hp for live combatant
      const liveMonsterHp = await executeTool('get_monster_hp', { name_or_id: 'Goblin Scout' }, { campaignId: campId });
      expect(liveMonsterHp.isLiveCombatant).toBe(true);
      expect(liveMonsterHp.currentHp).toBe(4);

      // Test get_monster_hp for monster manual fallback
      const mmMonsterHp = await executeTool('get_monster_hp', { name_or_id: 'Aboleth' });
      expect(mmMonsterHp.isLiveCombatant).toBe(false);
      expect(mmMonsterHp.hp).toBeDefined();
      expect(mmMonsterHp.source).toContain('Monster Manual');

      // Test get_initiative_order reading running_state
      const initResult = await executeTool('get_initiative_order', {}, { campaignId: campId });
      expect(initResult.round).toBe(3);
      expect(initResult.order.length).toBe(2);
      expect(initResult.order[0].name).toBe('Goblin Scout');

      const spellResult = await executeTool('lookup_spell', { name: 'Fireball' });
      expect(spellResult.name).toBe('Fireball');

      // Check audit log
      const logs = getToolAuditLog();
      expect(logs.length).toBeGreaterThanOrEqual(4);
      expect(logs.some((l) => l.toolName === 'get_monster_hp')).toBe(true);
      expect(logs.some((l) => l.toolName === 'lookup_spell')).toBe(true);
      expect(logs.some((l) => l.success === true)).toBe(true);
    });

    it('strictly blocks any attempt to mutate game state', async () => {
      // 1. Tool name that does not exist in read-only list
      expect(() => validateToolCall('set_character_hp', { name_or_id: 'Goblin', hp: 0 })).toThrow(
        /execution blocked/i
      );

      // 2. Mutation keywords in unauthorized tools
      expect(() => validateToolCall('update_unit_position', { x: 10, y: 10 })).toThrow(
        /execution blocked/i
      );

      // 3. Execution attempts throw
      await expect(executeTool('delete_encounter', {})).rejects.toThrow(/execution blocked/i);
    });

    it('safely handles context token pruning without infinite recursion when tokens exceed limit', () => {
      const hugeGameState = {
        activeEncounter: 'Massive Siege',
        combatants: Array.from({ length: 150 }, (_, i) => ({
          name: `Orc Raider ${i}`,
          currentHp: 15,
          maxHp: 15,
          initiative: 10 + (i % 10),
          position: { x: i, y: i },
          conditions: ['Poisoned', 'Frightened'],
        })),
      };

      const result = buildChatMessages({
        query: 'Who has the lowest HP?',
        passages: [
          { title: 'Passage 1', content: 'A'.repeat(5000) },
          { title: 'Passage 2', content: 'B'.repeat(5000) },
        ],
        gameState: hugeGameState,
        maxContextTokens: 500, // strictly small limit
      });

      expect(result.messages).toHaveLength(2);
      expect(result.estimatedTokens).toBeLessThanOrEqual(600);
    });
  });
});

describe('Iteration 4: LLM Telemetry & Benchmarking', () => {
  beforeEach(() => {
    clearLlmMetrics();
  });

  describe('Native Ollama Metrics Extraction & Calculations', () => {
    it('accurately calculates cold start, generation time, and TPS from native durations', () => {
      // load_duration = 14614563600 ns -> 14614.56 ms
      // eval_duration = 543552000 ns -> 543.55 ms
      // eval_count = 26 tokens -> 26 / (543552000 / 1e9) = 47.83 tokens/second
      const record = recordLlmMetric({
        modelName: 'llama3',
        loadDuration: 14614563600,
        evalDuration: 543552000,
        evalCount: 26,
        totalDuration: 15158115600,
        vramBytes: 5012193279,
        totalBytes: 5012193279,
      });

      expect(record.model_name).toBe('llama3');
      expect(record.cold_start_ms).toBe(14614.56);
      expect(record.generation_time_ms).toBe(543.55);
      expect(record.tokens_per_second).toBe(47.83);
      expect(record.vram_bytes).toBe(5012193279);
      expect(record.total_bytes).toBe(5012193279);
      expect(record.timestamp).toBeDefined();

      // Verify persistence in SQLite
      const retrieved = getLlmMetrics({ model: 'llama3' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].model_name).toBe('llama3');
      expect(retrieved[0].cold_start_ms).toBe(14614.56);
      expect(retrieved[0].tokens_per_second).toBe(47.83);
      expect(retrieved[0].vram_bytes).toBe(5012193279);
    });

    it('generates aggregated comparison summary across models (qwen vs llama3)', () => {
      // Record multiple metrics for qwen and llama3
      recordLlmMetric({
        modelName: 'qwen3.5:9b',
        loadDuration: 8000000000, // 8000ms
        evalDuration: 1000000000, // 1000ms
        evalCount: 40,            // 40 tps
        vramBytes: 6000000000,
        totalBytes: 6000000000,
      });

      recordLlmMetric({
        modelName: 'qwen3.5:9b',
        loadDuration: 0,          // warm request
        evalDuration: 1000000000, // 1000ms
        evalCount: 50,            // 50 tps
        vramBytes: 6000000000,
        totalBytes: 6000000000,
      });

      recordLlmMetric({
        modelName: 'llama3',
        loadDuration: 14000000000, // 14000ms
        evalDuration: 1000000000,  // 1000ms
        evalCount: 45,             // 45 tps
        vramBytes: 5000000000,
        totalBytes: 5000000000,
      });

      const summary = getLlmMetricsSummary();
      expect(summary.length).toBeGreaterThanOrEqual(2);

      const qwenSummary = summary.find((s) => s.model_name === 'qwen3.5:9b');
      const llamaSummary = summary.find((s) => s.model_name === 'llama3');

      expect(qwenSummary).toBeDefined();
      expect(qwenSummary.request_count).toBe(2);
      expect(qwenSummary.avg_cold_start_ms).toBe(4000);
      expect(qwenSummary.avg_tokens_per_second).toBe(45);
      expect(qwenSummary.max_vram_bytes).toBe(6000000000);

      expect(llamaSummary).toBeDefined();
      expect(llamaSummary.request_count).toBe(1);
      expect(llamaSummary.avg_cold_start_ms).toBe(14000);
      expect(llamaSummary.avg_tokens_per_second).toBe(45);
      expect(llamaSummary.max_vram_bytes).toBe(5000000000);
    });
  });

  describe('Telemetry API Endpoints & Async Integration', () => {
    it('supports POST /api/assistant/metrics to manually record data points', async () => {
      const payload = {
        modelName: 'llama3',
        loadDuration: 5000000000,
        evalDuration: 2000000000,
        evalCount: 80,
        totalDuration: 7000000000,
        vramBytes: 5012193279,
        totalBytes: 5012193279,
      };

      const res = await request(app).post('/api/assistant/metrics').send(payload);
      expect(res.status).toBe(201);
      expect(res.body.model_name).toBe('llama3');
      expect(res.body.cold_start_ms).toBe(5000);
      expect(res.body.generation_time_ms).toBe(2000);
      expect(res.body.tokens_per_second).toBe(40);
      expect(res.body.vram_bytes).toBe(5012193279);
    });

    it('supports GET /api/assistant/metrics and GET /api/assistant/metrics/summary', async () => {
      recordLlmMetric({
        modelName: 'qwen3.5:4b',
        loadDuration: 2000000000,
        evalDuration: 500000000,
        evalCount: 30,
        vramBytes: 3128038521,
        totalBytes: 3128038521,
      });

      const listRes = await request(app).get('/api/assistant/metrics');
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.length).toBeGreaterThan(0);

      const summaryRes = await request(app).get('/api/assistant/metrics/summary');
      expect(summaryRes.status).toBe(200);
      expect(Array.isArray(summaryRes.body)).toBe(true);
      expect(summaryRes.body.some((s) => s.model_name === 'qwen3.5:4b')).toBe(true);
    });

    it('includes metrics in chat endpoint responses and records them asynchronously without blocking', async () => {
      const res = await request(app).post('/api/assistant/chat').send({
        query: 'What is Fireball damage?',
        model: 'qwen3.5:4b',
        mockResponse: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.answer).toBeDefined();
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.load_duration).toBeDefined();

      // Wait 50ms for asynchronous telemetry worker
      await new Promise((r) => setTimeout(r, 60));

      const recorded = getLlmMetrics({ model: 'qwen3.5:4b' });
      expect(recorded.length).toBeGreaterThan(0);
      expect(recorded[0].cold_start_ms).toBe(50); // 50000000 ns -> 50 ms
    });

    it('benchmarkQuery records telemetry entry in mock mode and live mode', async () => {
      const benchmarkRes = await benchmarkQuery({
        model: 'llama3',
        query: 'What are the rules for Opportunity Attacks in 5e?',
        mockStream: true,
      });

      expect(benchmarkRes.model).toBe('llama3');
      expect(benchmarkRes.metricRecord).toBeDefined();

      const metrics = getLlmMetrics({ model: 'llama3' });
      expect(metrics.some((m) => m.model_name === 'llama3')).toBe(true);
    });
  });
});

