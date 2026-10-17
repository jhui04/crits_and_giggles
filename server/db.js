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

export let db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Wait for the write lock instead of throwing SQLITE_BUSY immediately, so
// overlapping writers (e.g. concurrent HITL approvals) don't surface as a
// spurious 500.
db.pragma('busy_timeout = 5000');

export function setDb(newDb) {
  try {
    if (db && db.open) db.close();
  } catch {}
  db = newDb;
  try {
    db.pragma('foreign_keys = ON');
  } catch {}
  return db;
}

export const MAP_OVERRIDES_DDL = `CREATE TABLE IF NOT EXISTS map_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id TEXT NOT NULL,
  op_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_map_overrides_map ON map_overrides(map_id);`;

export function initDb(targetDb = db) {
  // We need to support multi-tenancy where multiple campaigns can have assets/chapters with the same "natural" ID (e.g. from a template)
  // To do this properly, we use composite primary keys (id, campaign_id).
  
  // For this prototype, if we are changing schema, we might need to drop tables.
  // We'll try to do it safely but since it's a major change, we'll just ensure they are created correctly.
  
  targetDb.exec(`
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
      description TEXT,
      inverse_relationship TEXT,
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
      instanceId TEXT NOT NULL,
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
      phase INTEGER DEFAULT 1,
      tempHp INTEGER DEFAULT 0,
      faction TEXT DEFAULT 'enemy',
      PRIMARY KEY (instanceId, campaign_id),
      FOREIGN KEY (encounter_id, campaign_id) REFERENCES encounters(id, campaign_id) ON DELETE CASCADE
    );

    -- DM corrections to compiled maps (public/data/maps is generated and never edited). Applied in id order.
    ${MAP_OVERRIDES_DDL}

    CREATE TABLE IF NOT EXISTS vector_chunks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      campaign_id TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_source ON vector_chunks (source);
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_campaign ON vector_chunks (campaign_id);
  `);

  // Migration for existing tables:
  try {
    targetDb.exec('ALTER TABLE campaigns ADD COLUMN world_id TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE assets ADD COLUMN world_asset_id TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE vector_chunks ADD COLUMN embedding_kind TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounters ADD COLUMN running_state TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounters ADD COLUMN dm_map_url TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounters ADD COLUMN player_map_url TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounters ADD COLUMN map_size TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounters ADD COLUMN grid_config TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE world_asset_connections ADD COLUMN description TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE world_asset_connections ADD COLUMN inverse_relationship TEXT;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounter_units ADD COLUMN position_x INTEGER;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounter_units ADD COLUMN position_y INTEGER;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounter_units ADD COLUMN phase INTEGER DEFAULT 1;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec('ALTER TABLE encounter_units ADD COLUMN tempHp INTEGER DEFAULT 0;');
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    targetDb.exec("ALTER TABLE encounter_units ADD COLUMN faction TEXT DEFAULT 'enemy';");
  } catch (e) {
    // Column already exists, ignore
  }

  migrateEncounterUnitsPrimaryKey(targetDb);
}

const ENCOUNTER_UNITS_COLUMNS = [
  'instanceId', 'encounter_id', 'campaign_id', 'monsterId', 'playerId', 'name',
  'maxHp', 'currentHp', 'hpDice', 'dexMod', 'initiative', 'passivePerception',
  'isPlayer', 'position_x', 'position_y', 'phase', 'tempHp', 'faction',
];

/**
 * Legacy schema had `instanceId TEXT PRIMARY KEY` (globally unique), so two
 * campaigns with a unit sharing an instanceId collided. Rebuild the table with
 * PRIMARY KEY (instanceId, campaign_id). Idempotent: no-op when the PK is
 * already composite (including fresh DBs).
 */
function migrateEncounterUnitsPrimaryKey(targetDb) {
  const info = targetDb.prepare('PRAGMA table_info(encounter_units)').all();
  const pkCols = info.filter((c) => c.pk > 0);
  const isLegacy = pkCols.length === 1 && pkCols[0].name === 'instanceId';
  if (!isLegacy) return;

  const present = new Set(info.map((c) => c.name));
  const cols = ENCOUNTER_UNITS_COLUMNS.filter((c) => present.has(c));
  const colList = cols.join(', ');

  // PRAGMA foreign_keys is a no-op inside a transaction, so toggle around it.
  const fkWasOn = targetDb.pragma('foreign_keys', { simple: true }) === 1;
  targetDb.pragma('foreign_keys = OFF');
  try {
    targetDb.transaction(() => {
      targetDb.exec(`
        DROP TABLE IF EXISTS encounter_units_new;
        CREATE TABLE encounter_units_new (
          instanceId TEXT NOT NULL,
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
          phase INTEGER DEFAULT 1,
          tempHp INTEGER DEFAULT 0,
          faction TEXT DEFAULT 'enemy',
          PRIMARY KEY (instanceId, campaign_id),
          FOREIGN KEY (encounter_id, campaign_id) REFERENCES encounters(id, campaign_id) ON DELETE CASCADE
        );
        INSERT INTO encounter_units_new (${colList}) SELECT ${colList} FROM encounter_units;
        DROP TABLE encounter_units;
        ALTER TABLE encounter_units_new RENAME TO encounter_units;
      `);
      const violations = targetDb.pragma('foreign_key_check(encounter_units)');
      if (violations.length > 0) {
        throw new Error(`encounter_units migration left ${violations.length} foreign key violation(s)`);
      }
    })();
  } finally {
    if (fkWasOn) targetDb.pragma('foreign_keys = ON');
  }
}
