import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DATA_DIR = path.resolve(ROOT_DIR, 'public/data');
const DEFAULT_SEED_PATH = path.resolve(ROOT_DIR, 'test_seed.sqlite');

/**
 * Initializes schema and seeds test_seed.sqlite with worlds, campaigns, encounters,
 * units, and vector store data for live evaluation testing.
 */
export async function seedEvalDatabase(targetDbPath = DEFAULT_SEED_PATH) {
  const resolvedPath = path.resolve(targetDbPath);
  console.log(`[SeedEvalDb] Seeding evaluation database at: ${resolvedPath}`);

  // If previous seed exists, remove it for a clean, deterministic slate
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 1. Initialize Canonical Application Schema
  initDb(db);

  // 2. Populate Scraped World
  const worldFile = path.join(PUBLIC_DATA_DIR, 'scraped_world.json');
  if (fs.existsSync(worldFile)) {
    try {
      const worldData = JSON.parse(fs.readFileSync(worldFile, 'utf-8'));
      const worldsList = Array.isArray(worldData) ? worldData : [worldData];

      const insertWorld = db.prepare('INSERT OR REPLACE INTO worlds (id, name, description) VALUES (?, ?, ?)');
      const insertAsset = db.prepare('INSERT OR REPLACE INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
      const insertConn = db.prepare('INSERT OR REPLACE INTO world_asset_connections (id, source_id, target_id, world_id, relationship) VALUES (?, ?, ?, ?, ?)');

      const seedWorldsTx = db.transaction((worlds) => {
        for (const w of worlds) {
          insertWorld.run(w.id, w.name, w.description || '');
          if (Array.isArray(w.assets)) {
            for (const a of w.assets) {
              insertAsset.run(a.id, w.id, a.type, a.name, a.description || '', JSON.stringify(a.tags || []));
            }
            for (const a of w.assets) {
              if (Array.isArray(a.connections)) {
                for (const c of a.connections) {
                  insertConn.run(c.id, a.id, c.targetId, w.id, c.relationship || '');
                }
              }
            }
          }
        }
      });

      seedWorldsTx(worldsList);
      console.log(`[SeedEvalDb] Seeded world data.`);
    } catch (err) {
      console.warn('[SeedEvalDb] Error seeding scraped world:', err.message);
    }
  }

  // 3. Populate Scraped Campaigns
  const campaignFile = path.join(PUBLIC_DATA_DIR, 'scraped_campaign.json');
  if (fs.existsSync(campaignFile)) {
    try {
      const campaignData = JSON.parse(fs.readFileSync(campaignFile, 'utf-8'));
      const campaignsList = Array.isArray(campaignData) ? campaignData : [campaignData];

      const insertCampaign = db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description, world_id) VALUES (?, ?, ?, ?)');
      const insertChapter = db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)');
      const insertAsset = db.prepare('INSERT OR REPLACE INTO assets (id, campaign_id, type, name, description, world_asset_id) VALUES (?, ?, ?, ?, ?, ?)');
      const insertAssetChap = db.prepare('INSERT OR REPLACE INTO asset_chapters (asset_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertEnc = db.prepare('INSERT OR REPLACE INTO encounters (id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const insertEncChap = db.prepare('INSERT OR REPLACE INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT OR REPLACE INTO encounter_units (
          instanceId, encounter_id, campaign_id, monsterId, playerId, name,
          maxHp, currentHp, hpDice, dexMod, initiative, passivePerception,
          isPlayer, position_x, position_y, phase
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const seedCampaignsTx = db.transaction((campaigns) => {
        for (const camp of campaigns) {
          insertCampaign.run(camp.id, camp.name, camp.description || '', camp.worldId || null);

          if (Array.isArray(camp.chapters)) {
            camp.chapters.forEach((ch, idx) => {
              insertChapter.run(ch.id, camp.id, ch.title, ch.content || '', ch.order ?? idx);
            });
          }

          if (Array.isArray(camp.assets)) {
            for (const a of camp.assets) {
              insertAsset.run(a.id, camp.id, a.type, a.name, a.description || '', a.worldAssetId || null);
              if (Array.isArray(a.chapterIds)) {
                for (const chapId of a.chapterIds) {
                  insertAssetChap.run(a.id, chapId, camp.id);
                }
              }
            }
          }

          if (Array.isArray(camp.encounters)) {
            for (const enc of camp.encounters) {
              const dmMapUrl = enc.dmMapUrl || enc.mapUrl || null;
              const playerMapUrl = enc.playerMapUrl || enc.player_map_url || null;
              insertEnc.run(
                enc.id,
                camp.id,
                enc.name,
                enc.runningState ? JSON.stringify(enc.runningState) : null,
                dmMapUrl,
                playerMapUrl,
                enc.mapSize ? JSON.stringify(enc.mapSize) : null,
                enc.gridConfig ? JSON.stringify(enc.gridConfig) : null
              );

              if (Array.isArray(enc.chapterIds)) {
                for (const chId of enc.chapterIds) {
                  insertEncChap.run(enc.id, chId, camp.id);
                }
              }

              if (Array.isArray(enc.units)) {
                for (const u of enc.units) {
                  const posX = u.position?.x ?? u.position_x ?? null;
                  const posY = u.position?.y ?? u.position_y ?? null;
                  insertUnit.run(
                    u.instanceId || `${enc.id}-unit-${u.name.toLowerCase().replace(/\s+/g, '-')}`,
                    enc.id,
                    camp.id,
                    u.monsterId ? String(u.monsterId) : null,
                    u.playerId ? String(u.playerId) : null,
                    u.name,
                    u.maxHp ?? 10,
                    u.currentHp ?? u.maxHp ?? 10,
                    u.hpDice || '2d6',
                    u.dexMod ?? 0,
                    u.initiative ?? 10,
                    u.passivePerception ?? 10,
                    u.isPlayer ? 1 : 0,
                    posX,
                    posY,
                    u.phase ?? 1
                  );
                }
              }
            }
          }
        }
      });

      seedCampaignsTx(campaignsList);
      console.log(`[SeedEvalDb] Seeded ${campaignsList.length} campaigns.`);
    } catch (err) {
      console.warn('[SeedEvalDb] Error seeding scraped campaigns:', err.message);
    }
  }

  // 4. Seed Canonical Evaluation State (id: "test-campaign", encounterId: "enc-palma-flora")
  const seedEvalFixtures = db.transaction(() => {
    // Campaign
    db.prepare('INSERT OR REPLACE INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      'test-campaign',
      'Test Campaign',
      'Evaluation test campaign for Crits & Giggles Oracle'
    );

    // Chapter
    db.prepare('INSERT OR REPLACE INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)').run(
      'test-chap-1',
      'test-campaign',
      'Chapter 1: The Shoreline Ambush',
      '# The Shoreline Ambush\n\n## Arrival at the Docks\nThe party arrives in Palma Flora just as sea raiders emerge from the tides along the docks.\n\n## The Tidal Wave\nA sudden surge of ocean water crashes against the shoreline barricades.',
      0
    );

    // Asset (Wavechaser ship)
    db.prepare('INSERT OR REPLACE INTO assets (id, campaign_id, type, name, description) VALUES (?, ?, ?, ?, ?)').run(
      'test-asset-wavechaser',
      'test-campaign',
      'Ship',
      'Wavechaser',
      'Wavechaser is a ship located in Palma Flora, captained by Three Earrings.'
    );
    db.prepare('INSERT OR REPLACE INTO asset_chapters (asset_id, chapter_id, campaign_id) VALUES (?, ?, ?)').run(
      'test-asset-wavechaser',
      'test-chap-1',
      'test-campaign'
    );

    // Player (Grog Strongjaw)
    db.prepare('INSERT OR REPLACE INTO players (id, campaign_id, name, description) VALUES (?, ?, ?, ?)').run(
      'test-player-grog',
      'test-campaign',
      'Grog Strongjaw',
      'Goliath Barbarian with 68 hit points'
    );

    // Palma Flora Tactical Encounter
    const runningState = {
      isCombatStarted: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        {
          instanceId: 'c-grog',
          name: 'Grog Strongjaw',
          currentHp: 68,
          maxHp: 68,
          hpDice: '6d12+24',
          dexMod: 2,
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
          hpDice: '4d8+4',
          dexMod: 1,
          initiative: 11,
          isPlayer: false,
          position: { x: 15, y: 8 },
          conditions: ['Poisoned'],
        },
      ],
    };

    db.prepare(`
      INSERT OR REPLACE INTO encounters (
        id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'enc-palma-flora',
      'test-campaign',
      'Palma Flora Shoreline Ambush',
      JSON.stringify(runningState),
      '/maps/5.1-palma-flora.png',
      '/maps/5.1-palma-flora-player.png',
      JSON.stringify({ width: 33, height: 21 }),
      JSON.stringify({ columns: 33, rows: 21, cellPitch: 74 })
    );

    db.prepare('INSERT OR REPLACE INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)').run(
      'enc-palma-flora',
      'test-chap-1',
      'test-campaign'
    );

    // Encounter units
    const insertUnit = db.prepare(`
      INSERT OR REPLACE INTO encounter_units (
        instanceId, encounter_id, campaign_id, monsterId, playerId, name,
        maxHp, currentHp, hpDice, dexMod, initiative, passivePerception,
        isPlayer, position_x, position_y, phase
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUnit.run(
      'c-grog',
      'enc-palma-flora',
      'test-campaign',
      null,
      'test-player-grog',
      'Grog Strongjaw',
      68,
      68,
      '6d12+24',
      2,
      14,
      10,
      1,
      12,
      8,
      1
    );

    insertUnit.run(
      'c-sahuagin-1',
      'enc-palma-flora',
      'test-campaign',
      '211',
      null,
      'Sahuagin Raider',
      22,
      22,
      '4d8+4',
      1,
      11,
      9,
      0,
      15,
      8,
      1
    );
  });

  seedEvalFixtures();
  console.log(`[SeedEvalDb] Seeded canonical test-campaign and enc-palma-flora fixtures.`);

  // 5. Copy vector chunks from existing campaigns.sqlite3 if available
  const existingSqlite = path.resolve(ROOT_DIR, 'data/campaigns.sqlite3');
  if (fs.existsSync(existingSqlite)) {
    try {
      const srcDb = new Database(existingSqlite, { readonly: true });
      const chunks = srcDb.prepare('SELECT id, source, campaign_id, entity_id, title, content, embedding, metadata FROM vector_chunks').all();
      srcDb.close();

      if (chunks.length > 0) {
        const insertChunk = db.prepare(`
          INSERT OR REPLACE INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const copyTx = db.transaction((rows) => {
          for (const row of rows) {
            insertChunk.run(
              row.id,
              row.source,
              row.campaign_id,
              row.entity_id,
              row.title,
              row.content,
              row.embedding,
              row.metadata
            );
          }
        });
        copyTx(chunks);
        console.log(`[SeedEvalDb] Copied ${chunks.length} vector chunks from existing database.`);
      }
    } catch (err) {
      console.warn('[SeedEvalDb] Note: Could not copy existing vector chunks:', err.message);
    }
  }

  // Flush WAL and compact into a single standalone file suitable for instant in-memory buffer cloning
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.exec('VACUUM');

  db.close();
  console.log(`[SeedEvalDb] Seeding complete -> ${resolvedPath}`);
  return resolvedPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const target = process.argv[2] || DEFAULT_SEED_PATH;
  seedEvalDatabase(target)
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed evaluation database:', err);
      process.exit(1);
    });
}
