import { getOpenAIClient } from './llmClient.js';
import { getConfig, validateModel } from './config.js';
import { getOllamaApiBase, recordLlmMetric, fetchOllamaMemory } from './telemetry.js';

export const STANDARD_BENCHMARK_QUERIES = [
  'What does Fireball do?',
  'How does the Grappled condition work in combat?',
  'What are the rules for Opportunity Attacks in 5e?',
  'Explain how three-quarters cover affects AC and Dexterity saving throws.'
];

export const DEFAULT_BENCHMARK_MODELS = ['qwen3.5:9b', 'qwen3.5:4b', 'llama3'];

/**
 * Runs a benchmark for a single query against a specified model.
 * Extracts Ollama's native timing metrics (load_duration, eval_duration, eval_count)
 * with zero overhead, and persists the telemetry data to the SQLite metrics table and JSONL.
 */
export async function benchmarkQuery({
  model,
  query,
  clientOverride = undefined,
  mockStream = false,
}) {
  validateModel(model);
  const config = getConfig();

  if (mockStream) {
    // Simulated benchmark for CI/unit testing
    const startTime = performance.now();
    await new Promise((r) => setTimeout(r, 45)); // simulate 45ms TTFT
    const firstTokenTime = performance.now();
    const ttftMs = Math.round(firstTokenTime - startTime);

    const mockTokens = 85;
    await new Promise((r) => setTimeout(r, 90)); // simulate remaining generation
    const endTime = performance.now();
    const generationSec = (endTime - firstTokenTime) / 1000;
    const tps = Number((mockTokens / generationSec).toFixed(2));
    const durationMs = Math.round(endTime - startTime);

    const record = recordLlmMetric({
      modelName: model,
      loadDuration: ttftMs * 1e6,
      evalDuration: Math.round(generationSec * 1e9),
      evalCount: mockTokens,
      totalDuration: durationMs * 1e6,
      vramBytes: 0,
      totalBytes: 0,
    });

    return {
      model,
      query,
      ttftMs,
      coldStartMs: ttftMs,
      generationTimeMs: Math.round(generationSec * 1000),
      totalTokens: mockTokens,
      durationMs,
      tps,
      sampleResponse: 'A bright streak flashes from your pointing finger to a point you choose within range...',
      metricRecord: record,
    };
  }

  // If targeting Ollama (default or 11434 port), use native /api/chat to extract zero-overhead metrics directly
  const isOllama = !clientOverride && (config.baseURL.includes('11434') || config.baseURL.includes('ollama'));
  if (isOllama) {
    const ollamaBase = getOllamaApiBase(config.baseURL);
    const res = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a concise, authoritative D&D 5e assistant. Answer accurately in 1-2 paragraphs.' },
          { role: 'user', content: query }
        ],
        stream: false,
        keep_alive: config.keepAlive || '30m',
        options: { temperature: 0.2 }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const loadDurNs = data.load_duration || 0;
      const evalDurNs = data.eval_duration || 0;
      const totalDurNs = data.total_duration || 0;
      const evalCount = data.eval_count || 0;

      const coldStartMs = Number((loadDurNs / 1e6).toFixed(2));
      const generationTimeMs = Number((evalDurNs / 1e6).toFixed(2));
      const totalDurationMs = Number((totalDurNs / 1e6).toFixed(2));
      const tps = evalDurNs > 0 && evalCount > 0 ? Number((evalCount / (evalDurNs / 1e9)).toFixed(2)) : 0;
      const ttftMs = Math.round((loadDurNs + (data.prompt_eval_duration || 0)) / 1e6);

      const memory = await fetchOllamaMemory(model, config.baseURL).catch(() => ({ vram_bytes: 0, total_bytes: 0 }));

      const record = recordLlmMetric({
        modelName: model,
        loadDuration: loadDurNs,
        evalDuration: evalDurNs,
        evalCount,
        totalDuration: totalDurNs,
        vramBytes: memory.vram_bytes,
        totalBytes: memory.total_bytes,
      });

      const responseText = data.message?.content || '';

      return {
        model,
        query,
        ttftMs,
        coldStartMs,
        generationTimeMs,
        totalTokens: evalCount,
        durationMs: totalDurationMs,
        tps,
        vramBytes: memory.vram_bytes,
        totalBytes: memory.total_bytes,
        sampleResponse: responseText.slice(0, 150) + (responseText.length > 150 ? '...' : ''),
        metricRecord: record,
      };
    }
  }

  // Fallback to OpenAI streaming for non-Ollama endpoints
  const client = clientOverride || getOpenAIClient();
  const startTime = performance.now();
  let firstTokenTime = null;
  let tokenCount = 0;
  let fullText = '';

  const stream = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a concise, authoritative D&D 5e assistant. Answer accurately in 1-2 paragraphs.',
      },
      {
        role: 'user',
        content: query,
      },
    ],
    temperature: 0.2,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      if (!firstTokenTime) {
        firstTokenTime = performance.now();
      }
      tokenCount += Math.max(1, delta.trim().split(/\s+/).filter(Boolean).length);
      fullText += delta;
    }
  }

  const endTime = performance.now();
  const ttftMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : Math.round(endTime - startTime);
  const generationDurationSec = firstTokenTime ? (endTime - firstTokenTime) / 1000 : 0.001;
  const tps = generationDurationSec > 0 ? Number((tokenCount / generationDurationSec).toFixed(2)) : 0;
  const durationMs = Math.round(endTime - startTime);

  const memory = await fetchOllamaMemory(model).catch(() => ({ vram_bytes: 0, total_bytes: 0 }));

  const record = recordLlmMetric({
    modelName: model,
    loadDuration: ttftMs * 1e6,
    evalDuration: Math.round(generationDurationSec * 1e9),
    evalCount: tokenCount,
    totalDuration: durationMs * 1e6,
    vramBytes: memory.vram_bytes,
    totalBytes: memory.total_bytes,
  });

  return {
    model,
    query,
    ttftMs,
    coldStartMs: ttftMs,
    generationTimeMs: Math.round(generationDurationSec * 1000),
    totalTokens: tokenCount,
    durationMs,
    tps,
    vramBytes: memory.vram_bytes,
    totalBytes: memory.total_bytes,
    sampleResponse: fullText.slice(0, 150) + (fullText.length > 150 ? '...' : ''),
    metricRecord: record,
  };
}

/**
 * Runs a complete benchmark comparison between 9B, 4B, and Llama 3 models.
 */
export async function runFullBenchmark({
  models = DEFAULT_BENCHMARK_MODELS,
  queries = STANDARD_BENCHMARK_QUERIES,
  mock = false,
} = {}) {
  const results = [];

  console.log(`\n=== Starting LLM Responsiveness Benchmark ===`);
  console.log(`Hardware Limit: 8GB VRAM target`);
  console.log(`Testing Models: ${models.join(', ')}\n`);

  for (const model of models) {
    console.log(`--- Benchmarking Model: ${model} ---`);
    for (const query of queries) {
      try {
        const res = await benchmarkQuery({ model, query, mockStream: mock });
        results.push(res);
        console.log(`[${model}] Query: "${query}"`);
        console.log(`   -> TTFT: ${res.ttftMs}ms | TPS: ${res.tps} tok/s | Total Tokens: ${res.totalTokens} | Total Time: ${res.durationMs}ms`);
      } catch (err) {
        console.error(`[${model}] Query "${query}" failed: ${err.message}`);
        results.push({
          model,
          query,
          error: err.message,
        });
      }
    }
  }

  return results;
}
