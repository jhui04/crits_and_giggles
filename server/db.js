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
  // We need to support multi-tenancy where multiple campaigns can have assets/chapters with the same "natural" ID (e.g. from a template)
  // To do this properly, we use composite primary keys (id, campaign_id).
  
  // For this prototype, if we are changing schema, we might need to drop tables.
  // We'll try to do it safely but since it's a major change, we'll just ensure they are created correctly.
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS world_assets (
      id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT,               -- JSON array stored as text
      PRIMARY KEY (id, world_id),
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS world_asset_connections (
      id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      PRIMARY KEY (id, world_id),
      FOREIGN KEY (source_id, world_id) REFERENCES world_assets(id, world_id) ON DELETE CASCADE,
      FOREIGN KEY (target_id, world_id) REFERENCES world_assets(id, world_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      world_id TEXT,
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (id, campaign_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      world_asset_id TEXT,
      PRIMARY KEY (id, campaign_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      PRIMARY KEY (id, campaign_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      name TEXT NOT NULL,
      running_state TEXT,
      dm_map_url TEXT,
      player_map_url TEXT,
      map_size TEXT,
      grid_config TEXT,
      PRIMARY KEY (id, campaign_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_chapters (
      asset_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      PRIMARY KEY (asset_id, chapter_id, campaign_id),
      FOREIGN KEY (asset_id, campaign_id) REFERENCES assets(id, campaign_id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id, campaign_id) REFERENCES chapters(id, campaign_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encounter_chapters (
      encounter_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      PRIMARY KEY (encounter_id, chapter_id, campaign_id),
      FOREIGN KEY (encounter_id, campaign_id) REFERENCES encounters(id, campaign_id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id, campaign_id) REFERENCES chapters(id, campaign_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encounter_units (
      instanceId TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
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
      position_x INTEGER,
      position_y INTEGER,
      FOREIGN KEY (encounter_id, campaign_id) REFERENCES encounters(id, campaign_id) ON DELETE CASCADE
    );
  `);

  // Migration for existing tables:
  try {
    db.exec('ALTER TABLE campaigns ADD COLUMN world_id TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE assets ADD COLUMN world_asset_id TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounters ADD COLUMN running_state TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounters ADD COLUMN dm_map_url TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounters ADD COLUMN player_map_url TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounters ADD COLUMN map_size TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounters ADD COLUMN grid_config TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounter_units ADD COLUMN position_x INTEGER;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec('ALTER TABLE encounter_units ADD COLUMN position_y INTEGER;');
  } catch (e) {
    // Column already exists, ignore
  }
}
