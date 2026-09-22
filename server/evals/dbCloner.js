import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setDb } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SEED_PATH = path.resolve(__dirname, '../../test_seed.sqlite');

/**
 * Instantaneously clones the golden image database into an in-memory SQLite database
 * and overrides the server's global db instance.
 */
export function initMemoryDatabaseFromSeed(seedPath = DEFAULT_SEED_PATH) {
  const resolved = path.resolve(seedPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Golden seed database not found at "${resolved}". Run "node tools/seed_eval_db.js" first.`);
  }

  const startTime = performance.now();
  const fileBuffer = fs.readFileSync(resolved);
  const memoryDb = new Database(fileBuffer);
  memoryDb.pragma('foreign_keys = ON');

  // Override the app's global db instance
  setDb(memoryDb);

  const durationMs = Number((performance.now() - startTime).toFixed(2));
  return { db: memoryDb, durationMs };
}
