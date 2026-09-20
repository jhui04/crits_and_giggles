import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import { getConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSONL_PATH = path.join(__dirname, '../../data/llm_metrics.jsonl');

/**
 * Extracts base URL for native Ollama endpoints (strips /v1)
 */
export function getOllamaApiBase(baseURL) {
  const base = baseURL || getConfig().baseURL || 'http://localhost:11434/v1';
  return base.replace(/\/v1\/?$/, '');
}

/**
 * Asynchronously fetches VRAM and RAM footprint from Ollama's /api/ps endpoint.
 * Non-blocking, short timeout, gracefully returns zeros if Ollama or model is inactive.
 */
export async function fetchOllamaMemory(modelName, baseURL) {
  if (!modelName) return { vram_bytes: 0, total_bytes: 0 };
  const ollamaBase = getOllamaApiBase(baseURL);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${ollamaBase}/api/ps`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { vram_bytes: 0, total_bytes: 0 };
    }

    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const target = modelName.trim().toLowerCase();

    // Match model: exact match, or stripped tags (e.g. llama3 matches llama3:latest)
    const matched = models.find((m) => {
      const name = (m.name || m.model || '').toLowerCase();
      if (name === target) return true;
      if (name.startsWith(`${target}:`)) return true;
      if (target.startsWith(`${name}:`)) return true;
      const strippedName = name.split(':')[0];
      const strippedTarget = target.split(':')[0];
      return strippedName === strippedTarget;
    });

    return {
      vram_bytes: matched?.size_vram ?? 0,
      total_bytes: matched?.size ?? 0,
    };
  } catch {
    return { vram_bytes: 0, total_bytes: 0 };
  }
}

/**
 * Records an LLM telemetry entry. Computes cold start, generation time, TPS,
 * and persists to SQLite llm_metrics table as well as JSONL log file.
 */
export function recordLlmMetric({
  modelName,
  loadDuration = 0,
  evalDuration = 0,
  evalCount = 0,
  totalDuration = 0,
  vramBytes = 0,
  totalBytes = 0,
  timestamp = null,
}) {
  if (!modelName) {
    throw new Error('modelName is required for telemetry recording');
  }

  const loadDurNum = Number(loadDuration) || 0;
  const evalDurNum = Number(evalDuration) || 0;
  const evalCountNum = Number(evalCount) || 0;
  const totalDurNum = Number(totalDuration) || 0;

  // load_duration in Ollama represents cold start time (nanoseconds -> milliseconds)
  const coldStartMs = loadDurNum > 0 ? Number((loadDurNum / 1e6).toFixed(2)) : 0;

  // eval_duration represents generation time (nanoseconds -> milliseconds)
  const generationTimeMs = evalDurNum > 0 ? Number((evalDurNum / 1e6).toFixed(2)) : 0;

  // tokens_per_second = eval_count / (eval_duration / 10^9)
  const tokensPerSecond =
    evalDurNum > 0 && evalCountNum > 0
      ? Number((evalCountNum / (evalDurNum / 1e9)).toFixed(2))
      : 0;

  const entryTimestamp = timestamp || new Date().toISOString();
  const vramBytesNum = Number(vramBytes) || 0;
  const totalBytesNum = Number(totalBytes) || 0;

  // 1. Insert into SQLite
  let insertId = null;
  try {
    const stmt = db.prepare(`
      INSERT INTO llm_metrics (
        model_name,
        cold_start_ms,
        generation_time_ms,
        tokens_per_second,
        vram_bytes,
        total_bytes,
        eval_count,
        eval_duration,
        load_duration,
        total_duration,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      modelName,
      coldStartMs,
      generationTimeMs,
      tokensPerSecond,
      vramBytesNum,
      totalBytesNum,
      evalCountNum,
      evalDurNum,
      loadDurNum,
      totalDurNum,
      entryTimestamp
    );
    insertId = result.lastInsertRowid;
  } catch (dbErr) {
    console.warn('[Telemetry] SQLite insert warning:', dbErr.message);
  }

  const metricRecord = {
    id: insertId,
    model_name: modelName,
    cold_start_ms: coldStartMs,
    generation_time_ms: generationTimeMs,
    tokens_per_second: tokensPerSecond,
    vram_bytes: vramBytesNum,
    total_bytes: totalBytesNum,
    eval_count: evalCountNum,
    eval_duration: evalDurNum,
    load_duration: loadDurNum,
    total_duration: totalDurNum,
    timestamp: entryTimestamp,
  };

  // 2. Append to JSONL log file for offline analysis/export
  try {
    const dir = path.dirname(JSONL_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(JSONL_PATH, JSON.stringify(metricRecord) + '\n', 'utf-8');
  } catch (fsErr) {
    console.warn('[Telemetry] JSONL append warning:', fsErr.message);
  }

  return metricRecord;
}

/**
 * Asynchronous orchestrator that fetches memory load from Ollama /api/ps
 * and persists telemetry without delaying the user-facing chat response.
 */
export async function recordTelemetryAsync({
  model,
  rawMetrics = {},
  baseURL = undefined,
}) {
  try {
    const memory = await fetchOllamaMemory(model, baseURL);
    return recordLlmMetric({
      modelName: model,
      loadDuration: rawMetrics.load_duration,
      evalDuration: rawMetrics.eval_duration,
      evalCount: rawMetrics.eval_count,
      totalDuration: rawMetrics.total_duration,
      vramBytes: memory.vram_bytes,
      totalBytes: memory.total_bytes,
    });
  } catch (err) {
    console.warn('[Telemetry] Asynchronous metric recording failed:', err.message);
    return null;
  }
}

/**
 * Retrieves recorded metrics from SQLite, optionally filtered by model.
 */
export function getLlmMetrics({ model = null, limit = 50 } = {}) {
  try {
    if (model) {
      return db
        .prepare('SELECT * FROM llm_metrics WHERE model_name = ? ORDER BY id DESC LIMIT ?')
        .all(model, limit);
    }
    return db
      .prepare('SELECT * FROM llm_metrics ORDER BY id DESC LIMIT ?')
      .all(limit);
  } catch (err) {
    console.warn('[Telemetry] Query metrics failed:', err.message);
    return [];
  }
}

/**
 * Generates an aggregated summary comparing models on average cold start,
 * average generation time, tokens/second, and peak VRAM/RAM footprints.
 */
export function getLlmMetricsSummary() {
  try {
    return db
      .prepare(`
        SELECT 
          model_name,
          COUNT(*) as request_count,
          ROUND(AVG(cold_start_ms), 2) as avg_cold_start_ms,
          ROUND(AVG(generation_time_ms), 2) as avg_generation_time_ms,
          ROUND(AVG(tokens_per_second), 2) as avg_tokens_per_second,
          MAX(vram_bytes) as max_vram_bytes,
          MAX(total_bytes) as max_total_bytes,
          MAX(timestamp) as latest_timestamp
        FROM llm_metrics
        GROUP BY model_name
        ORDER BY request_count DESC
      `)
      .all();
  } catch (err) {
    console.warn('[Telemetry] Query metrics summary failed:', err.message);
    return [];
  }
}

/**
 * Clears metrics (used for tests)
 */
export function clearLlmMetrics() {
  try {
    db.prepare('DELETE FROM llm_metrics').run();
  } catch {
    // Ignore
  }
}
