import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMemory = process.env.DB_MODE === 'memory';
const DB_PATH = process.env.OVERRIDE_DB_PATH || 
                (isMemory ? ':memory:' : path.join(__dirname, '../data/campaigns.sqlite3'));

if (!isMemory && !process.env.OVERRIDE_DB_PATH) {
  const DB_DIR = path.dirname(DB_PATH);
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      order_index INTEGER NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encounter_units (
      instanceId TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      monsterId TEXT,
      playerId TEXT,
      name TEXT NOT NULL,
      maxHp INTEGER,
      currentHp INTEGER,
      hpDice TEXT,
      dexMod INTEGER NOT NULL,
      initiative INTEGER,
      passivePerception INTEGER,
      isPlayer INTEGER NOT NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
    );
  `);
}
