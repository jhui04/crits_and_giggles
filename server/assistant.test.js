import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import { db } from './db.js';
import { validateModel, getConfig, setConfig, resetConfig } from './assistant/config.js';
import { computeLocalEmbedding, cosineSimilarity } from './assistant/embedder.js';
import { upsertVectorChunk, searchVectorStore, indexSrdAndJsonData, indexCampaignLore, invalidateVectorCache, chunkMarkdownChapter } from './assistant/vectorStore.js';
import { computeSemanticEmbeddingsBatch } from './assistant/embedder.js';
import fs from 'fs';
import { ASSISTANT_TOOLS, validateToolCall, executeTool, getToolAuditLog, clearToolAuditLog, parseChapterOutline, resolveChapter, columnIndexToLabel, coordinateToLabel, resolveMapFilePath, getMapGridData, escapeXml } from './assistant/toolController.js';
import { getAuthoritativeGameState, buildChatMessages, estimateTokenCount } from './assistant/contextBuilder.js';
import { handleAssistantChat } from './assistant/orchestrator.js';
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

    it('defaults maxToolIterations to 20 and allows configuration', async () => {
      const config = getConfig();
      expect(config.maxToolIterations).toBe(20);

      const updateRes = await request(app)
        .put('/api/assistant/config')
        .send({ maxToolIterations: 15 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.maxToolIterations).toBe(15);
    });

    it('defaults Ollama model keepAlive duration to 30m and allows configuration', async () => {
      const config = getConfig();
      expect(config.keepAlive).toBe('30m');

      const res = await request(app).get('/api/assistant/config');
      expect(res.status).toBe(200);
      expect(res.body.keepAlive).toBe('30m');

      const updateRes = await request(app)
        .put('/api/assistant/config')
        .send({ keepAlive: '45m' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.keepAlive).toBe('45m');

      // Reset
      await request(app)
        .put('/api/assistant/config')
        .send({ keepAlive: '30m' });
    });

    it('sends keep_alive: "30m" in callOllamaNativeChat payload to keep models in memory for 30 minutes', async () => {
      const { callOllamaNativeChat } = await import('./assistant/llmClient.js');
      const originalFetch = globalThis.fetch;
      let capturedPayload = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { role: 'assistant', content: 'Test response' },
            done_reason: 'stop',
          }),
        };
      });

      try {
        await callOllamaNativeChat({
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3.5:9b',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.keep_alive).toBe('30m');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('sends num_predict: 4096 and num_ctx: 16384 in callOllamaNativeChat options to prevent output truncation', async () => {
      const { callOllamaNativeChat } = await import('./assistant/llmClient.js');
      const originalFetch = globalThis.fetch;
      let capturedPayload = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { role: 'assistant', content: 'Test response' },
            done_reason: 'stop',
          }),
        };
      });

      try {
        await callOllamaNativeChat({
          baseURL: 'http://localhost:11434/v1',
          model: 'qwen3.5:9b',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.options).toBeDefined();
        expect(capturedPayload.options.num_predict).toBe(4096);
        expect(capturedPayload.options.num_ctx).toBe(16384);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('robustly separates native thinking and inline <think> tags from final response content', async () => {
      const { separateThinkingAndContent } = await import('./assistant/llmClient.js');

      // Case 1: Native thinking property
      const case1 = separateThinkingAndContent('Final answer.', 'Step 1: analyze.\nStep 2: compute.');
      expect(case1.thinking).toBe('Step 1: analyze.\nStep 2: compute.');
      expect(case1.content).toBe('Final answer.');

      // Case 2: Closed <think> tag inside content
      const case2 = separateThinkingAndContent('<think>Internal thoughts about fire damage</think>Fireball deals 8d6 fire damage.');
      expect(case2.thinking).toBe('Internal thoughts about fire damage');
      expect(case2.content).toBe('Fireball deals 8d6 fire damage.');

      // Case 3: Unclosed <think> tag (truncated generation)
      const case3 = separateThinkingAndContent('<think>Unfinished thoughts cut off by token limit');
      expect(case3.thinking).toBe('Unfinished thoughts cut off by token limit');
      expect(case3.content).toBe('');
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

  describe('Fuzzy Search, Typo Resolution & Active Chapter Preloading', () => {
    it('resolves typos in spell names using fuzzy search (e.g. fierball -> Fireball)', async () => {
      const result = await executeTool('lookup_spell', { name: 'fierball' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Fireball');
      expect(result.level).toBe(3);
    });

    it('resolves typos in monster names using fuzzy search (e.g. abolethh -> Aboleth)', async () => {
      const result = await executeTool('lookup_monster', { name: 'abolethh' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Aboleth');
      expect(result.cr).toBe('10');
    });

    it('looks up magic items and resolves typos (e.g. amulet of helth -> Amulet of Health)', async () => {
      const result = await executeTool('lookup_magic_item', { name: 'amulet of helth' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Amulet of Health');
      expect(result.rarity).toBe('Rare');
    });

    it('searches assets and lore by descriptive keywords and character sheet abilities', async () => {
      const result = await executeTool('search_assets_and_lore', { query: 'tentacle' });
      expect(result).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some((r) => r.name.toLowerCase().includes('aboleth') || r.snippet.toLowerCase().includes('tentacle'))).toBe(true);
    });

    it('preloads active chapter and world information in authoritative game state', () => {
      const state = getAuthoritativeGameState({
        campaignId: 'c1',
        chapterId: 'chap-101',
        chapterName: 'The Sunless Citadel - Grove Level',
        worldId: 'w1',
        worldName: 'Faerun',
      });

      expect(state.activeChapter).toBeDefined();
      expect(state.activeChapter.id).toBe('chap-101');
      expect(state.activeChapter.title).toBe('The Sunless Citadel - Grove Level');
      expect(state.world).toBeDefined();
      expect(state.world.name).toBe('Faerun');
    });

    it('orchestrator threads active chapter into system prompt and mock response', async () => {
      const res = await handleAssistantChat({
        query: 'What chapter are we on?',
        campaignId: 'c1',
        chapterId: 'chap-101',
        chapterName: 'The Sunless Citadel - Grove Level',
        mockResponse: true,
      });

      expect(res.gameState.activeChapter.title).toBe('The Sunless Citadel - Grove Level');
      expect(res.answer).toContain('The Sunless Citadel - Grove Level');
    });

    it('retrieves world assets and chapter assets via get_campaign_asset with typo tolerance', async () => {
      // Seed a chapter and world asset for testing
      db.prepare('INSERT OR REPLACE INTO worlds (id, name, description) VALUES (?, ?, ?)').run('w-test', 'Forgotten Realms', 'High fantasy world');
      db.prepare('INSERT OR REPLACE INTO world_assets (id, world_id, type, name, description) VALUES (?, ?, ?, ?, ?)').run(
        'wa-elminster',
        'w-test',
        'NPC',
        'Archmage Elminster',
        'Ancient sage of Shadowdale with white beard and pipe.'
      );

      // Exact match
      const exactResult = await executeTool('get_campaign_asset', { name_or_id: 'Archmage Elminster' });
      expect(exactResult).toBeDefined();
      expect(exactResult.name).toBe('Archmage Elminster');

      // Typo match (e.g. "elminstr")
      const typoResult = await executeTool('get_campaign_asset', { name_or_id: 'elminstr' });
      expect(typoResult).toBeDefined();
      expect(typoResult.name).toBe('Archmage Elminster');
    });

    it('correctly resolves spell typos like "lightning blt" to "Lightning Bolt" and does NOT falsely match "Light"', async () => {
      const result = await executeTool('lookup_spell', { name: 'lightning blt' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Lightning Bolt');
      expect(result.level).toBe(3);
    });

    it('does NOT falsely match substring entities when looking up non-existent names (e.g. porcupine does not return Orc)', async () => {
      const result = await executeTool('lookup_monster', { name: 'porcupine' });
      expect(result).toBeDefined();
      expect(result.error).toMatch(/monster "porcupine" not found/i);
    });

    it('resolves monster typos like "gobln" to "Goblin"', async () => {
      const result = await executeTool('lookup_monster', { name: 'gobln' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Goblin');
    });

    it('resolves magic item typos like "ring of protectn" to "Ring of Protection"', async () => {
      const result = await executeTool('lookup_magic_item', { name: 'ring of protectn' });
      expect(result).toBeDefined();
      expect(result.name).toBe('Ring of Protection');
    });

    it('handles empty query in search_assets_and_lore safely', async () => {
      const result = await executeTool('search_assets_and_lore', { query: '   ' });
      expect(result).toBeDefined();
      expect(result.matchCount).toBe(0);
      expect(result.results).toEqual([]);
    });
  });

  describe('Semantic Search & Smart Fallback Guidance', () => {
    it('defines semantic_search tool schema in ASSISTANT_TOOLS', () => {
      const tool = ASSISTANT_TOOLS.find((t) => t.function.name === 'semantic_search');
      expect(tool).toBeDefined();
      expect(tool.function.description).toMatch(/semantic/i);
      expect(tool.function.parameters.properties.query).toBeDefined();
      expect(tool.function.parameters.properties.category).toBeDefined();
      expect(tool.function.parameters.properties.limit).toBeDefined();
      expect(tool.function.parameters.required).toContain('query');
    });

    it('executes semantic_search tool and retrieves relevant conceptual passages', async () => {
      // Ensure data is indexed for semantic search
      await indexSrdAndJsonData();

      const result = await executeTool('semantic_search', {
        query: 'desert monster that burrows under ground',
        limit: 3,
      });

      expect(result).toBeDefined();
      expect(result.query).toBe('desert monster that burrows under ground');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.matchCount).toBe(result.results.length);
      expect(result.results[0].title).toBeDefined();
      expect(result.results[0].score).toBeDefined();
      expect(result.results[0].snippet).toBeDefined();
    });

    it('filters semantic_search results by category (e.g. monster, spell)', async () => {
      await indexSrdAndJsonData();

      const monsterResult = await executeTool('semantic_search', {
        query: 'dragon breath',
        category: 'monster',
        limit: 3,
      });

      expect(monsterResult).toBeDefined();
      expect(monsterResult.category).toBe('monster');
      for (const item of monsterResult.results) {
        expect(item.source).toBe('monster');
      }

      const spellResult = await executeTool('semantic_search', {
        query: 'fiery blast',
        category: 'spell',
        limit: 3,
      });

      expect(spellResult).toBeDefined();
      expect(spellResult.category).toBe('spell');
      for (const item of spellResult.results) {
        expect(item.source).toBe('spell');
      }
    });

    it('handles empty query in semantic_search safely with hint', async () => {
      const result = await executeTool('semantic_search', { query: '   ' });
      expect(result).toBeDefined();
      expect(result.matchCount).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.hint).toMatch(/non-empty query/i);
    });

    it('returns a guidance hint suggesting semantic_search when lookup_monster fails', async () => {
      const result = await executeTool('lookup_monster', { name: 'xyznonexistentmonster12345' });
      expect(result).toBeDefined();
      expect(result.error).toMatch(/not found/i);
      expect(result.hint).toBeDefined();
      expect(result.hint).toMatch(/semantic_search/i);
    });

    it('returns a guidance hint suggesting semantic_search when search_assets_and_lore finds 0 matches', async () => {
      const result = await executeTool('search_assets_and_lore', { query: 'xyznonexistentterm12345' });
      expect(result).toBeDefined();
      expect(result.matchCount).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.hint).toBeDefined();
      expect(result.hint).toMatch(/semantic_search/i);
    });

    it('returns a guidance hint suggesting semantic_search when lookup_spell fails', async () => {
      const result = await executeTool('lookup_spell', { name: 'xyznonexistentspell12345' });
      expect(result).toBeDefined();
      expect(result.error).toMatch(/not found/i);
      expect(result.hint).toBeDefined();
      expect(result.hint).toMatch(/semantic_search/i);
    });

    it('returns a guidance hint suggesting semantic_search when lookup_magic_item fails', async () => {
      const result = await executeTool('lookup_magic_item', { name: 'nonexistent relic of darkness' });
      expect(result).toBeDefined();
      expect(result.error).toMatch(/not found/i);
      expect(result.hint).toBeDefined();
      expect(result.hint).toMatch(/semantic_search/i);
    });

    it('includes tool selection strategy and semantic_search instructions in buildChatMessages', () => {
      const { messages } = buildChatMessages({ query: 'What monster lives in desert sand?' });
      const systemPrompt = messages.find((m) => m.role === 'system')?.content;
      expect(systemPrompt).toBeDefined();
      expect(systemPrompt).toMatch(/TOOL SELECTION STRATEGY/i);
      expect(systemPrompt).toMatch(/semantic_search/i);
      expect(systemPrompt).toMatch(/retry loops/i);
    });

    it('pushes sourceFilter down to searchVectorStore so category searches are not starved by other types', async () => {
      await indexSrdAndJsonData();

      // "fire" has many spells (Fireball, Fire Bolt, etc.). Passing sourceFilter: 'monster'
      // must return monsters directly from searchVectorStore without post-filter starvation.
      const monsterPassages = await searchVectorStore('fire', {
        limit: 5,
        sourceFilter: 'monster',
      });

      expect(monsterPassages.length).toBeGreaterThan(0);
      for (const p of monsterPassages) {
        expect(p.source).toBe('monster');
      }
    });

    it('maps category: chapter to campaign_chapter and searches chapter notes', async () => {
      // Index a test campaign chapter
      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run('c-gap-test', 'Gap Campaign', 'Testing gaps');
      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-volcano',
        'c-gap-test',
        'Volcano Caldera Descent',
        'The party descends into the bubbling obsidian caldera where magma mephits lurk in the crevices.',
        1
      );
      await indexCampaignLore('c-gap-test');

      const result = await executeTool('semantic_search', {
        query: 'magma caldera obsidian',
        category: 'chapter',
        limit: 3,
      }, { campaignId: 'c-gap-test' });

      expect(result).toBeDefined();
      expect(result.category).toBe('chapter');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].source).toBe('campaign_chapter');
      expect(result.results[0].title).toContain('Volcano Caldera');
    });

    it('preserves snippets up to 1500 characters without premature 300 character truncation', async () => {
      await indexSrdAndJsonData();

      const result = await executeTool('semantic_search', {
        query: 'Adult Red Dragon',
        category: 'monster',
        limit: 1,
      });

      expect(result).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
      const snippet = result.results[0].snippet;
      // Adult Red Dragon stat block chunk is well over 300 characters
      expect(snippet.length).toBeGreaterThan(300);
      expect(snippet).toContain('AC:');
      expect(snippet).toContain('HP:');
      expect(snippet).toContain('Actions:');
    });
  });

  describe('Phase 1, 2 & 3: Chapter Tools, Semantic Chunking & Failsafes (plan.md)', () => {
    it('increases contentPreview limit from 300 to 2000 characters in gameState', () => {
      const longContent = 'A'.repeat(1200);
      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run('c-preview-test', 'Preview Test', 'Testing preview');
      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-preview',
        'c-preview-test',
        'Long Preview Chapter',
        longContent,
        1
      );

      const state = getAuthoritativeGameState({ campaignId: 'c-preview-test', chapterId: 'chap-preview' });
      expect(state.activeChapter).toBeDefined();
      expect(state.activeChapter.contentPreview).toBe(longContent);
      expect(state.activeChapter.contentPreview.length).toBe(1200);
    });

    it('enforces strict empty-response failsafe rule in system prompt', () => {
      const promptObj = buildChatMessages({ query: 'Where is the hidden map?' });
      const systemMessage = promptObj.messages.find((m) => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain('If you cannot answer a question based on the available context or tools, you MUST reply with a textual explanation of what information is missing. NEVER return an empty response.');
    });

    it('parses markdown headings correctly into an ordered outline', () => {
      const markdown = [
        'Prologue text before heading.',
        '# Chapter 1: The Dark Forest',
        'Introductory forest description.',
        '## Area 1: The Overgrown Trail',
        'Watch out for snaring vines.',
        '### Area 1A: Hidden Stash',
        'A hollow tree trunk with 20 gp.',
        '## Area 2: Witch Cottage',
        'A sinister chimney smoking purple fumes.',
      ].join('\n');

      const outline = parseChapterOutline(markdown);
      expect(outline).toHaveLength(4);
      expect(outline[0]).toEqual(expect.objectContaining({ level: 1, heading: 'Chapter 1: The Dark Forest' }));
      expect(outline[1]).toEqual(expect.objectContaining({ level: 2, heading: 'Area 1: The Overgrown Trail' }));
      expect(outline[2]).toEqual(expect.objectContaining({ level: 3, heading: 'Area 1A: Hidden Stash' }));
      expect(outline[3]).toEqual(expect.objectContaining({ level: 2, heading: 'Area 2: Witch Cottage' }));
    });

    it('executes get_chapter_outline tool and returns structured outline for active chapter', async () => {
      const chapMarkdown = [
        '# Sunless Citadel Ground Level',
        'Overview of the fortress descent.',
        '## 1. Ledge and Switchback Stairs',
        'A crumbled masonry stair descending 50 feet.',
        '## 2. Dragon Door',
        'A locked stone door carved with dragon motifs.',
      ].join('\n');

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run('c-tool-test', 'Tool Test Campaign', 'Testing tools');
      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-citadel',
        'c-tool-test',
        'Sunless Citadel',
        chapMarkdown,
        1
      );

      const outlineResult = await executeTool('get_chapter_outline', {}, { campaignId: 'c-tool-test', chapterId: 'chap-citadel' });
      expect(outlineResult).toBeDefined();
      expect(outlineResult.chapterId).toBe('chap-citadel');
      expect(outlineResult.chapterTitle).toBe('Sunless Citadel');
      expect(outlineResult.headingCount).toBe(3);
      expect(outlineResult.outline).toEqual([
        { level: 1, heading: 'Sunless Citadel Ground Level' },
        { level: 2, heading: '1. Ledge and Switchback Stairs' },
        { level: 2, heading: '2. Dragon Door' },
      ]);
    });

    it('executes read_chapter_section and extracts text until the next same or higher level heading', async () => {
      const chapMarkdown = [
        '# Fortress Ruins',
        'Initial greeting notes.',
        '## Room 1: Entrance',
        'Cobwebs line the pillars. A goblin patrol stands guard.',
        '### Secret Chest',
        'Behind the pillar is an iron chest with 50 sp.',
        '## Room 2: Armory',
        'Racks of rusted spears and round shields.',
      ].join('\n');

      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-rooms',
        'c-tool-test',
        'Fortress Rooms',
        chapMarkdown,
        2
      );

      // Read Room 1: Entrance (level 2). It should include subsection ### Secret Chest and stop at ## Room 2: Armory
      const section1 = await executeTool('read_chapter_section', { headingName: 'Room 1: Entrance' }, { campaignId: 'c-tool-test', chapterId: 'chap-rooms' });
      expect(section1).toBeDefined();
      expect(section1.matchedHeading).toBe('Room 1: Entrance');
      expect(section1.sectionContent).toContain('Cobwebs line the pillars.');
      expect(section1.sectionContent).toContain('Behind the pillar is an iron chest');
      expect(section1.sectionContent).not.toContain('Racks of rusted spears');

      // Read subsection ### Secret Chest (level 3). It should only read the secret chest content
      const subSection = await executeTool('read_chapter_section', { headingName: 'Secret Chest' }, { campaignId: 'c-tool-test', chapterId: 'chap-rooms' });
      expect(subSection.matchedHeading).toBe('Secret Chest');
      expect(subSection.sectionContent).toBe('Behind the pillar is an iron chest with 50 sp.');

      // Fuzzy / case-insensitive match (e.g. "armory")
      const armorySection = await executeTool('read_chapter_section', { headingName: 'armory' }, { campaignId: 'c-tool-test', chapterId: 'chap-rooms' });
      expect(armorySection.matchedHeading).toBe('Room 2: Armory');
      expect(armorySection.sectionContent).toBe('Racks of rusted spears and round shields.');
    });

    it('reads chapter Introduction when requested if text precedes the first heading', async () => {
      const chapWithIntro = [
        'Welcome adventurers to the Sunken Temple! Proceed at your own peril.',
        '# Chamber of Whispers',
        'A cold wind whistles through the cracks.',
      ].join('\n');

      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-intro',
        'c-tool-test',
        'Sunken Temple',
        chapWithIntro,
        3
      );

      const introResult = await executeTool('read_chapter_section', { headingName: 'Introduction' }, { campaignId: 'c-tool-test', chapterId: 'chap-intro' });
      expect(introResult).toBeDefined();
      expect(introResult.matchedHeading).toBe('Introduction');
      expect(introResult.sectionContent).toBe('Welcome adventurers to the Sunken Temple! Proceed at your own peril.');
    });

    it('chunks markdown by headings and prefixes breadcrumbs', () => {
      const text = [
        'Prologue notes.',
        '# First Floor',
        'Floor description.',
        '## Library',
        'Dusty tomes and ancient maps of the coast.',
      ].join('\n');

      const chunks = chunkMarkdownChapter('Haunted Manor', text, 1500);
      expect(chunks).toHaveLength(3);

      expect(chunks[0].content).toContain('[Chapter: Haunted Manor > Section: Introduction]');
      expect(chunks[0].content).toContain('Prologue notes.');

      expect(chunks[1].content).toContain('[Chapter: Haunted Manor > Section: First Floor]');
      expect(chunks[1].content).toContain('Floor description.');

      expect(chunks[2].content).toContain('[Chapter: Haunted Manor > Section: Library]');
      expect(chunks[2].content).toContain('Dusty tomes and ancient maps of the coast.');
    });

    it('splits large chapter sections (> 1500 chars) by paragraphs while retaining breadcrumbs', () => {
      const para1 = 'Paragraph 1: ' + 'A'.repeat(900);
      const para2 = 'Paragraph 2: ' + 'B'.repeat(900);
      const largeSectionText = [
        '## Grand Ballroom',
        para1,
        '',
        para2,
      ].join('\n');

      const chunks = chunkMarkdownChapter('Castle Ravenloft', largeSectionText, 1500);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      for (const c of chunks) {
        expect(c.content).toContain('[Chapter: Castle Ravenloft > Section: Grand Ballroom]');
      }
      expect(chunks[0].content).toContain('Paragraph 1:');
      expect(chunks[1].content).toContain('Paragraph 2:');
    });

    it('indexes chunked chapters and retrieves specific sections via semantic_search without dilution', async () => {
      const fullChapter = [
        '# Wavechaser Vessel Navigation',
        'The ship sails across the Lucidian Ocean under clear skies.',
        '',
        '## Tactical Map & Grid Layout',
        'The combat map is set to 24 columns by 18 rows. The helm is at coordinates (12, 4) and the ballista is mounted at (12, 16).',
        '',
        '## Cargo Hold Inventory',
        'Barrels of fresh water, salted pork, and three crates of dragon lilies.',
      ].join('\n');

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run('c-chunk-test', 'Chunking Campaign', 'Testing semantic chunking');
      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-wavechaser',
        'c-chunk-test',
        'Wavechaser Voyage',
        fullChapter,
        1
      );

      const count = await indexCampaignLore('c-chunk-test');
      expect(count).toBeGreaterThanOrEqual(3);

      const mapResult = await executeTool('semantic_search', {
        query: 'tactical combat map grid dimensions helm coordinates ballista',
        category: 'chapter',
        limit: 1,
      }, { campaignId: 'c-chunk-test' });

      expect(mapResult.results.length).toBeGreaterThan(0);
      const topMatch = mapResult.results[0];
      expect(topMatch.title).toContain('Wavechaser Voyage');
      expect(topMatch.title).toContain('Tactical Map');
      expect(topMatch.snippet).toContain('[Chapter: Wavechaser Voyage > Section: Tactical Map & Grid Layout]');
      expect(topMatch.snippet).toContain('coordinates (12, 4)');
    });

    it('wipes old dynamic vector chunks when a campaign is re-indexed to prevent staleness and hallucinations', async () => {
      const campId = 'c-staleness-test';
      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(campId, 'Staleness Test', 'Testing chunk cleanup');

      // 1. Initial chapter with 4 sections
      const originalContent = [
        '# Section 1: Entrance',
        'Guarded by two guards.',
        '# Section 2: Courtyard',
        'Statue of the founder.',
        '# Section 3: Treasury',
        'Gold coins everywhere.',
        '# Section 4: Dungeon',
        'Prisoners in chains.',
      ].join('\n');

      db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
        'chap-stale-1',
        campId,
        'Original Castle',
        originalContent,
        1
      );

      const initialCount = await indexCampaignLore(campId);
      expect(initialCount).toBe(4);

      let rows = db.prepare('SELECT id FROM vector_chunks WHERE campaign_id = ?').all(campId);
      expect(rows).toHaveLength(4);

      // 2. User rewrites chapter down to only 1 section
      const rewrittenContent = [
        '# Quick Summary',
        'The castle is abandoned.',
      ].join('\n');

      db.prepare('UPDATE chapters SET content = ? WHERE id = ?').run(rewrittenContent, 'chap-stale-1');

      const updatedCount = await indexCampaignLore(campId);
      expect(updatedCount).toBe(1);

      // Verify old sec-1, sec-2, sec-3 are wiped and do not persist
      rows = db.prepare('SELECT id FROM vector_chunks WHERE campaign_id = ?').all(campId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(`camp-${campId}-chap-chap-stale-1-sec-0`);

      // 3. User deletes all chapters in the campaign
      db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(campId);
      const clearedCount = await indexCampaignLore(campId);
      expect(clearedCount).toBe(0);

      rows = db.prepare('SELECT id FROM vector_chunks WHERE campaign_id = ?').all(campId);
      expect(rows).toHaveLength(0);
    });
  });

  describe('Multimodal Map Tool & Visual Tactical Inspection (get_current_map)', () => {
    it('declares get_current_map in ASSISTANT_TOOLS with proper parameters and omits empty required array', () => {
      const tool = ASSISTANT_TOOLS.find((t) => t.function.name === 'get_current_map');
      expect(tool).toBeDefined();
      expect(tool.function.description).toContain('tactical layout');
      expect(tool.function.parameters.properties.include_combatants).toBeDefined();
      expect(tool.function.parameters.properties.version).toBeDefined();
      // Important for Ollama compatibility: no empty required array
      expect(tool.function.parameters.required).toBeUndefined();
    });

    it('instructs the LLM in TOOL SELECTION STRATEGY to use get_current_map for spatial and tactical queries', () => {
      const { buildChatMessages } = require('./assistant/contextBuilder.js');
      const { messages } = buildChatMessages({ query: 'Where are the characters on the map?' });
      const systemMessage = messages.find((m) => m.role === 'system');
      expect(systemMessage.content).toContain('For SPATIAL, TACTICAL, or MAP queries');
      expect(systemMessage.content).toContain('use the get_current_map tool');
    });

    it('correctly maps column index and grid coordinates to D&D cell notation', () => {
      expect(columnIndexToLabel(0)).toBe('A');
      expect(columnIndexToLabel(25)).toBe('Z');
      expect(columnIndexToLabel(26)).toBe('AA');
      expect(columnIndexToLabel(27)).toBe('AB');

      expect(coordinateToLabel(0, 0)).toBe('A1');
      expect(coordinateToLabel(12, 7)).toBe('M8');
      expect(coordinateToLabel(22, 3)).toBe('W4');
    });

    it('resolves map image files and retrieves grid configurations', () => {
      const resolved = resolveMapFilePath('/maps/5.1-palma-flora-player.png');
      expect(resolved).toBeTruthy();
      expect(fs.existsSync(resolved)).toBe(true);

      const gridData = getMapGridData('/maps/5.1-palma-flora-player.png');
      expect(gridData.columns).toBe(33);
      expect(gridData.rows).toBe(21);
      expect(gridData.cellPitch).toBe(74);
    });

    it('executes get_current_map and returns structured locations with composited image', async () => {
      const campId = 'camp-map-test';
      const encId = 'enc-palma-flora-tactical';

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        campId,
        'Palma Flora Expedition',
        'Campaign with tactical map'
      );

      const runningState = {
        isCombatStarted: true,
        round: 2,
        turnIndex: 0,
        combatants: [
          {
            instanceId: 'c-grog',
            name: 'Grog Strongjaw',
            currentHp: 68,
            maxHp: 68,
            initiative: 14,
            isPlayer: true,
            position: { x: 12, y: 8 },
            conditions: [],
          },
          {
            instanceId: 'c-sahuagin-1',
            name: 'Sahuagin Raider',
            currentHp: 22,
            maxHp: 22,
            initiative: 11,
            isPlayer: false,
            position: { x: 15, y: 8 },
            conditions: ['Poisoned'],
          },
        ],
      };

      db.prepare(
        `INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        encId,
        campId,
        'Palma Flora Shoreline Ambush',
        JSON.stringify(runningState),
        '/maps/5.1-palma-flora.png',
        '/maps/5.1-palma-flora-player.png',
        JSON.stringify({ width: 33, height: 21 })
      );

      const result = await executeTool(
        'get_current_map',
        { include_combatants: true, version: 'dm' },
        { campaignId: campId, encounterId: encId }
      );

      expect(result.success).toBe(true);
      expect(result.encounterId).toBe(encId);
      expect(result.mapName).toBe('Palma Flora Shoreline Ambush');
      expect(result.mapUrl).toBe('/maps/5.1-palma-flora.png');
      expect(result.version).toBe('dm');
      expect(result.combatantsCount).toBe(2);

      // Verify character locations
      const grog = result.combatants.find((c) => c.name === 'Grog Strongjaw');
      expect(grog).toBeDefined();
      expect(grog.team).toBe('Player');
      expect(grog.cell).toBe('M9'); // x: 12 -> M, y: 8 -> 9
      expect(grog.coordinates).toEqual({ x: 12, y: 8 });

      const sahuagin = result.combatants.find((c) => c.name === 'Sahuagin Raider');
      expect(sahuagin).toBeDefined();
      expect(sahuagin.team).toBe('Monster/Enemy');
      expect(sahuagin.cell).toBe('P9'); // x: 15 -> P, y: 8 -> 9
      expect(sahuagin.coordinates).toEqual({ x: 15, y: 8 });

      // Verify image data URI
      expect(result.imageAttached).toBe(true);
      expect(result.image).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+/);
      expect(result.image.length).toBeGreaterThan(10000);
    });

    it('supports player map version when requested', async () => {
      const campId = 'camp-map-test';
      const encId = 'enc-palma-flora-tactical';

      const result = await executeTool(
        'get_current_map',
        { version: 'player' },
        { campaignId: campId, encounterId: encId }
      );

      expect(result.success).toBe(true);
      expect(result.mapUrl).toBe('/maps/5.1-palma-flora-player.png');
      expect(result.version).toBe('player');
    });

    it('supports include_combatants: false to retrieve an unannotated clean map', async () => {
      const campId = 'camp-map-test';
      const encId = 'enc-palma-flora-tactical';

      const result = await executeTool(
        'get_current_map',
        { include_combatants: false },
        { campaignId: campId, encounterId: encId }
      );

      expect(result.success).toBe(true);
      expect(result.combatants).toEqual([]);
      expect(result.imageAttached).toBe(true);
      expect(result.image).toMatch(/^data:image\/png;base64,/);
    });

    it('returns helpful guidance when encounter has no map configured', async () => {
      const campId = 'camp-no-map';
      const encId = 'enc-theater-of-mind';

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        campId,
        'No Map Campaign',
        'Theater of mind'
      );
      db.prepare(
        'INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)'
      ).run(encId, campId, 'Tavern Discussion', JSON.stringify({ combatants: [] }));

      const result = await executeTool(
        'get_current_map',
        {},
        { campaignId: campId, encounterId: encId }
      );

      expect(result.error).toContain('No tactical map configured');
      expect(result.hint).toContain('Encounter Builder');
    });

    it('handles null or missing HP values gracefully with ?/? fallback', async () => {
      const campId = 'camp-null-hp';
      const encId = 'enc-null-hp';

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        campId,
        'Null HP Campaign',
        'Testing combatants with undefined or null HP'
      );

      const runningState = {
        combatants: [
          {
            instanceId: 'c-barrel-1',
            name: 'Explosive Powder Keg',
            isPlayer: false,
            currentHp: null,
            maxHp: undefined,
            position: { x: 4, y: 4 },
          },
          {
            instanceId: 'c-zero-hp',
            name: 'Unconscious Guard',
            isPlayer: true,
            currentHp: 0,
            maxHp: 20,
            position: { x: 5, y: 4 },
          },
        ],
      };

      db.prepare(
        `INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state, dm_map_url)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        encId,
        campId,
        'Warehouse Hazard',
        JSON.stringify(runningState),
        '/maps/5.1-palma-flora.png'
      );

      const result = await executeTool(
        'get_current_map',
        { include_combatants: true },
        { campaignId: campId, encounterId: encId }
      );

      expect(result.success).toBe(true);
      const keg = result.combatants.find((c) => c.name === 'Explosive Powder Keg');
      expect(keg).toBeDefined();
      expect(keg.hp).toBe('?/?');

      const guard = result.combatants.find((c) => c.name === 'Unconscious Guard');
      expect(guard).toBeDefined();
      expect(guard.hp).toBe('0/20');
    });

    it('cascades to global encounter with a map when target campaign only has mapless encounters', async () => {
      const emptyMapCampId = 'camp-only-mapless';
      const maplessEncId = 'enc-only-mapless';

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        emptyMapCampId,
        'Only Mapless Campaign',
        'Campaign with no tactical maps'
      );
      db.prepare(
        'INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)'
      ).run(maplessEncId, emptyMapCampId, 'Mapless Encounter', JSON.stringify({ combatants: [] }));

      // Pass campaignId that has only mapless encounters, without specifying encounterId
      const result = await executeTool(
        'get_current_map',
        {},
        { campaignId: emptyMapCampId }
      );

      // Should cascade past emptyMapCampId to global encounter with map (e.g. Palma Flora)
      expect(result.success).toBe(true);
      expect(result.mapUrl).toBeDefined();
      expect(result.imageAttached).toBe(true);
    });

    it('formats multimodal messages in orchestrator without base64 text token explosion', async () => {
      const campId = 'camp-map-test';
      const encId = 'enc-palma-flora-tactical';

      const llmClient = await import('./assistant/llmClient.js');
      const spy = vi.spyOn(llmClient, 'executeChatCompletion');

      spy.mockResolvedValueOnce({
        response: {
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call-map-123',
                    function: {
                      name: 'get_current_map',
                      arguments: JSON.stringify({ include_combatants: true }),
                    },
                  },
                ],
              },
            },
          ],
        },
        modelUsed: 'qwen3.5:9b',
      });

      spy.mockResolvedValueOnce({
        response: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I see Grog Strongjaw at cell M9 and Sahuagin Raider at cell P9.',
              },
            },
          ],
        },
        modelUsed: 'qwen3.5:9b',
      });

      try {
        const chatResult = await handleAssistantChat({
          query: 'Where is everyone located on the tactical map?',
          campaignId: campId,
          encounterId: encId,
          mockResponse: false,
        });

        expect(chatResult.toolCalls).toHaveLength(1);
        expect(chatResult.toolCalls[0].toolName).toBe('get_current_map');
        expect(chatResult.toolCalls[0].result.imageAttached).toBe(true);
        expect(chatResult.toolCalls[0].result.combatants).toHaveLength(2);
        expect(chatResult.answer).toContain('Grog Strongjaw at cell M9');

        // Verify the messages passed to the second turn:
        expect(spy).toHaveBeenCalledTimes(2);
        const secondTurnMessages = spy.mock.calls[1][0].messages;

        // 1. Tool message must NOT have massive raw base64 string
        const toolMsg = secondTurnMessages.find((m) => m.role === 'tool');
        expect(toolMsg).toBeDefined();
        expect(toolMsg.content).toContain('[Attached Visual Map Image');
        expect(toolMsg.content).not.toContain('data:image/png;base64');

        // 2. Multimodal message must contain vision parts for OpenAI and images array for Ollama
        const visionMsg = secondTurnMessages.find((m) => m.role === 'user' && m.images);
        expect(visionMsg).toBeDefined();
        expect(visionMsg.images).toHaveLength(1);
        expect(visionMsg.images[0].length).toBeGreaterThan(1000);
        expect(visionMsg.content[1].type).toBe('image_url');
      } finally {
        spy.mockRestore();
      }
    });

    it('escapes XML special characters in combatant names to prevent sharp SVG parse crashes', async () => {
      expect(escapeXml('M&M <Archer> "Boss" \'Sneak\'')).toBe(
        'M&amp;M &lt;Archer&gt; &quot;Boss&quot; &apos;Sneak&apos;'
      );

      const campId = 'camp-xml-escape';
      const encId = 'enc-xml-escape';

      db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
        campId,
        'XML Escape Campaign',
        'Testing special characters in combatant names'
      );

      const runningState = {
        combatants: [
          {
            instanceId: 'c-special-1',
            name: 'Goblins & Wargs <Elite>',
            isPlayer: false,
            currentHp: 15,
            maxHp: 15,
            position: { x: 5, y: 5 },
          },
          {
            instanceId: 'c-special-2',
            name: 'Rogue "Dagger" O\'Connor',
            isPlayer: true,
            currentHp: 25,
            maxHp: 25,
            position: { x: 6, y: 5 },
          },
        ],
      };

      db.prepare(
        `INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state, dm_map_url)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        encId,
        campId,
        'Special Char Ambush',
        JSON.stringify(runningState),
        '/maps/5.1-palma-flora.png'
      );

      // Must execute cleanly without throwing XML parse error
      const result = await executeTool(
        'get_current_map',
        { include_combatants: true },
        { campaignId: campId, encounterId: encId }
      );

      expect(result.success).toBe(true);
      expect(result.combatantsCount).toBe(2);
      expect(result.imageAttached).toBe(true);
    });

    it('enforces that all tool responses precede multimodal user image attachments during parallel tool execution', async () => {
      const campId = 'camp-map-test';
      const encId = 'enc-palma-flora-tactical';

      const llmClient = await import('./assistant/llmClient.js');
      const spy = vi.spyOn(llmClient, 'executeChatCompletion');

      // Model returns two tool calls at once: get_current_map AND get_monster_hp
      spy.mockResolvedValueOnce({
        response: {
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call-map-1',
                    function: {
                      name: 'get_current_map',
                      arguments: JSON.stringify({ include_combatants: true }),
                    },
                  },
                  {
                    id: 'call-hp-2',
                    function: {
                      name: 'get_monster_hp',
                      arguments: JSON.stringify({ name_or_id: 'Sahuagin Raider' }),
                    },
                  },
                ],
              },
            },
          ],
        },
        modelUsed: 'qwen3.5:9b',
      });

      spy.mockResolvedValueOnce({
        response: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Sahuagin Raider has 22 HP and is located at cell P9.',
              },
            },
          ],
        },
        modelUsed: 'qwen3.5:9b',
      });

      try {
        const chatResult = await handleAssistantChat({
          query: 'Show map and check Sahuagin HP',
          campaignId: campId,
          encounterId: encId,
          mockResponse: false,
        });

        expect(chatResult.toolCalls).toHaveLength(2);

        // Verify message sequencing in second turn:
        // All role: 'tool' responses must appear immediately after assistant, BEFORE any user multimodal image
        const secondTurnMessages = spy.mock.calls[1][0].messages;
        const assistantIdx = secondTurnMessages.findIndex((m) => m.role === 'assistant' && m.tool_calls);
        expect(assistantIdx).toBeGreaterThanOrEqual(0);

        const toolMsg1 = secondTurnMessages[assistantIdx + 1];
        const toolMsg2 = secondTurnMessages[assistantIdx + 2];
        expect(toolMsg1.role).toBe('tool');
        expect(toolMsg2.role).toBe('tool');

        // Any multimodal user message must come strictly AFTER all tool messages
        const multimodalUserIdx = secondTurnMessages.findIndex((m) => m.role === 'user' && m.images);
        expect(multimodalUserIdx).toBeGreaterThan(assistantIdx + 2);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

