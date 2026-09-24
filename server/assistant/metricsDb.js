import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

/**
 * Dedicated SQLite store for LLM telemetry, deliberately separate from the
 * campaign database (data/campaigns.sqlite3). Campaign data is reset/reseeded
 * by tests and dev workflows; telemetry must survive that, so it lives in the
 * per-user application data directory.
 *
 * Resolution order:
 *   1. METRICS_DB_PATH env override (file path, or ':memory:')
 *   2. In-memory under NODE_ENV=test / DB_MODE=memory, so tests never touch
 *      (or wipe) the real metrics history
 *   3. <app data>/CritsAndGiggles/llm_metrics.sqlite3
 *      (%APPDATA% on Windows, ~/Library/Application Support on macOS,
 *       $XDG_DATA_HOME or ~/.local/share elsewhere)
 */
export function getAppDataDir() {
  if (process.env.METRICS_DATA_DIR) return process.env.METRICS_DATA_DIR;
  const home = os.homedir();
  let base;
  if (process.platform === 'win32') {
    base = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support');
  } else {
    base = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  }
  return path.join(base, 'CritsAndGiggles');
}

const useMemory =
  !process.env.METRICS_DB_PATH &&
  (process.env.NODE_ENV === 'test' || process.env.DB_MODE === 'memory');

export const METRICS_DB_PATH =
  process.env.METRICS_DB_PATH ||
  (useMemory ? ':memory:' : path.join(getAppDataDir(), 'llm_metrics.sqlite3'));

export const METRICS_JSONL_PATH = useMemory
  ? null
  : path.join(path.dirname(METRICS_DB_PATH), 'llm_metrics.jsonl');

if (METRICS_DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(METRICS_DB_PATH), { recursive: true });
}

export const metricsDb = new Database(METRICS_DB_PATH);
metricsDb.pragma('journal_mode = WAL');
metricsDb.pragma('busy_timeout = 5000');

metricsDb.exec(`
  CREATE TABLE IF NOT EXISTS llm_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    cold_start_ms REAL NOT NULL,
    generation_time_ms REAL NOT NULL,
    tokens_per_second REAL NOT NULL,
    vram_bytes INTEGER DEFAULT 0,
    total_bytes INTEGER DEFAULT 0,
    eval_count INTEGER DEFAULT 0,
    eval_duration INTEGER DEFAULT 0,
    load_duration INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_llm_metrics_model ON llm_metrics (model_name);
  CREATE INDEX IF NOT EXISTS idx_llm_metrics_timestamp ON llm_metrics (timestamp);
`);

// One-time migration: copy any history from the legacy location (the campaign
// DB) so existing stats aren't lost. Skipped for in-memory stores and when the
// new store already has rows.
function migrateLegacyMetrics() {
  if (METRICS_DB_PATH === ':memory:') return;
  const legacyPath =
    process.env.OVERRIDE_DB_PATH ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/campaigns.sqlite3');
  if (!fs.existsSync(legacyPath)) return;
  try {
    if (metricsDb.prepare('SELECT COUNT(*) AS n FROM llm_metrics').get().n > 0) return;
    const legacy = new Database(legacyPath, { readonly: true, fileMustExist: true });
    try {
      const rows = legacy.prepare('SELECT * FROM llm_metrics ORDER BY id').all();
      if (!rows.length) return;
      const insert = metricsDb.prepare(`
        INSERT INTO llm_metrics (model_name, cold_start_ms, generation_time_ms, tokens_per_second,
          vram_bytes, total_bytes, eval_count, eval_duration, load_duration, total_duration, timestamp)
        VALUES (@model_name, @cold_start_ms, @generation_time_ms, @tokens_per_second,
          @vram_bytes, @total_bytes, @eval_count, @eval_duration, @load_duration, @total_duration, @timestamp)
      `);
      metricsDb.transaction((items) => items.forEach((r) => insert.run(r)))(rows);
    } finally {
      legacy.close();
    }
  } catch {
    // Legacy DB missing the table or unreadable: nothing to migrate.
  }
}
migrateLegacyMetrics();
