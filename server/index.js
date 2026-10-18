import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { db, initDb } from './db.js';
import { getConfig, setConfig, listInstalledModels } from './assistant/config.js';
import { handleAssistantChat } from './assistant/orchestrator.js';
import { searchVectorStore, indexSrdAndJsonData, indexCampaignLore, invalidateVectorCache, removeCampaignFromVectorCache } from './assistant/vectorStore.js';
import { getToolAuditLog, executeTool } from './assistant/toolController.js';
import {
  recordTelemetryAsync,
  getLlmMetrics,
  getLlmMetricsSummary,
  recordLlmMetric,
  clearLlmMetrics,
} from './assistant/telemetry.js';
import { hitlManager } from './assistant/hitlManager.js';
import { normalizePhaseNames, phaseCountFor } from './phaseNames.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

initDb();
indexSrdAndJsonData().catch((err) => {
  console.warn('[Startup] Initial SRD vector indexing warning:', err.message);
});


// Helper to get full world
function getFullWorld(id) {
  const world = db.prepare('SELECT id, name, description FROM worlds WHERE id = ?').get(id);
  if (!world) return null;

  const assets = db.prepare('SELECT id, type, name, description, tags FROM world_assets WHERE world_id = ?').all(id);
  const connsBySource = new Map();
  for (const c of db.prepare("SELECT id, source_id, target_id as targetId, relationship, COALESCE(description, '') as description, COALESCE(inverse_relationship, '') as inverseRelationship FROM world_asset_connections WHERE world_id = ?").all(id)) {
    const { source_id, ...conn } = c;
    if (!connsBySource.has(source_id)) connsBySource.set(source_id, []);
    connsBySource.get(source_id).push(conn);
  }
  for (const asset of assets) {
    asset.tags = asset.tags ? JSON.parse(asset.tags) : [];
    asset.connections = connsBySource.get(asset.id) || [];
  }
  world.assets = assets;
  return world;
}

// Helper to get full campaign
function getFullCampaign(id) {
  const campaign = db.prepare('SELECT id, name, description, world_id as worldId FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return null;

  campaign.chapters = db.prepare('SELECT id, title, content, order_index as "order" FROM chapters WHERE campaign_id = ? ORDER BY order_index').all(id);
  
  const assets = db.prepare('SELECT id, type, name, description, world_asset_id as worldAssetId FROM assets WHERE campaign_id = ?').all(id);
  const groupBy = (rows, key, val) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(val ? val(r) : r);
    }
    return m;
  };
  const assetChapters = groupBy(db.prepare('SELECT asset_id, chapter_id FROM asset_chapters WHERE campaign_id = ?').all(id), 'asset_id', r => r.chapter_id);
  for (const asset of assets) {
    asset.chapterIds = assetChapters.get(asset.id) || [];
  }
  campaign.assets = assets;

  campaign.players = db.prepare('SELECT id, name, description FROM players WHERE campaign_id = ?').all(id);
  
  const encounters = db.prepare('SELECT id, name, running_state as runningState, dm_map_url as dmMapUrl, player_map_url as playerMapUrl, map_size as mapSize, grid_config as gridConfig, phase_names as phaseNames FROM encounters WHERE campaign_id = ?').all(id);
  const encChapters = groupBy(db.prepare('SELECT encounter_id, chapter_id FROM encounter_chapters WHERE campaign_id = ?').all(id), 'encounter_id', r => r.chapter_id);
  const encUnits = groupBy(db.prepare('SELECT * FROM encounter_units WHERE campaign_id = ?').all(id), 'encounter_id');
  for (const enc of encounters) {
    enc.runningState = enc.runningState ? JSON.parse(enc.runningState) : null;
    enc.mapSize = enc.mapSize ? JSON.parse(enc.mapSize) : null;
    enc.gridConfig = enc.gridConfig ? JSON.parse(enc.gridConfig) : null;
    // Old encounters have no names: omit the key so every phase falls back to "Phase N".
    enc.chapterIds = encChapters.get(enc.id) || [];
    enc.units = encUnits.get(enc.id) || [];
    // Legacy rows may hold duplicate names: drop later duplicates so Run Mode labels stay unique.
    const phaseNames = enc.phaseNames ? normalizePhaseNames(JSON.parse(enc.phaseNames), phaseCountFor(enc.units)) : null;
    if (phaseNames) enc.phaseNames = phaseNames; else delete enc.phaseNames;
    // Convert isPlayer back to boolean and restore position
    enc.units.forEach(u => {
      u.isPlayer = !!u.isPlayer;
      if (u.position_x !== null && u.position_x !== undefined && u.position_y !== null && u.position_y !== undefined) {
        u.position = { x: u.position_x, y: u.position_y };
      }
      u.phase = u.phase ?? 1;
      delete u.position_x;
      delete u.position_y;
    });
  }
  campaign.encounters = encounters;

  return campaign;
}

function parseLimit(value, defaultValue, max = 500) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

// Inserts all child rows (chapters, assets, players, encounters, units) for a campaign.
// Must be called inside a transaction.
function insertCampaignChildren(campaignId, data) {
  if (data.chapters) {
    const insertChapter = db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)');
    data.chapters.forEach(ch => insertChapter.run(ch.id, campaignId, ch.title, ch.content, ch.order));
  }
  
  if (data.assets) {
    const insertAsset = db.prepare('INSERT INTO assets (id, campaign_id, type, name, description, world_asset_id) VALUES (?, ?, ?, ?, ?, ?)');
    const insertAssetChapter = db.prepare('INSERT INTO asset_chapters (asset_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
    data.assets.forEach(as => {
      insertAsset.run(as.id, campaignId, as.type, as.name, as.description, as.worldAssetId || null);
      if (as.chapterIds) {
        as.chapterIds.forEach(chapId => insertAssetChapter.run(as.id, chapId, campaignId));
      }
    });
  }
  
  if (data.players) {
    const insertPlayer = db.prepare('INSERT INTO players (id, campaign_id, name, description) VALUES (?, ?, ?, ?)');
    data.players.forEach(pl => insertPlayer.run(pl.id, campaignId, pl.name, pl.description));
  }
  
  if (data.encounters) {
    const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config, phase_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertEncounterChapter = db.prepare('INSERT INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
    const insertUnit = db.prepare(`
      INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer, position_x, position_y, phase, tempHp, faction)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    data.encounters.forEach(enc => {
      insertEncounter.run(
        enc.id,
        campaignId,
        enc.name,
        enc.runningState ? JSON.stringify(enc.runningState) : null,
        enc.dmMapUrl || null,
        enc.playerMapUrl || null,
        enc.mapSize ? JSON.stringify(enc.mapSize) : null,
        enc.gridConfig ? JSON.stringify(enc.gridConfig) : null,
        (() => { const n = normalizePhaseNames(enc.phaseNames, phaseCountFor(enc.units)); return n ? JSON.stringify(n) : null; })()
      );
      if (enc.chapterIds) {
        enc.chapterIds.forEach(chapId => insertEncounterChapter.run(enc.id, chapId, campaignId));
      }
      if (enc.units) {
        enc.units.forEach(u => insertUnit.run(
          u.instanceId,
          enc.id,
          campaignId,
          u.monsterId ?? null,
          u.playerId ?? null,
          u.name ?? 'Unknown',
          u.maxHp ?? null,
          u.currentHp ?? null,
          u.hpDice ?? null,
          u.dexMod ?? 0,
          u.initiative ?? null,
          u.passivePerception ?? null,
          u.isPlayer ? 1 : 0,
          u.position?.x ?? null,
          u.position?.y ?? null,
          u.phase ?? 1,
          u.tempHp ?? 0,
          u.faction ?? 'enemy'
        ));
      }
    });
  }
}

// Lore indexing runs after the DB write has committed; a failure here must not fail the save.
async function safeIndexCampaignLore(campaignId) {
  try {
    await indexCampaignLore(campaignId);
  } catch (err) {
    console.warn('[Campaigns] Lore indexing failed for', campaignId, err.message);
  }
}

// GET /api/worlds
app.get('/api/worlds', (req, res) => {
  try {
    const worlds = db.prepare('SELECT id FROM worlds').all().map(w => getFullWorld(w.id)).filter(Boolean);
    res.json(worlds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch worlds', details: err.message });
  }
});

// GET /api/worlds/:id
app.get('/api/worlds/:id', (req, res) => {
  try {
    const world = getFullWorld(req.params.id);
    if (world) {
      res.json(world);
    } else {
      res.status(404).json({ error: 'World not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch world', details: err.message });
  }
});

// POST /api/worlds
app.post('/api/worlds', (req, res) => {
  const { id } = req.body;
  
  const insertWorld = db.transaction((data) => {
    // Upsert rather than delete-then-insert: deleting the world row would cascade
    // `ON DELETE SET NULL` onto campaigns.world_id for every campaign linked to this
    // world (see server/db.js), silently unlinking them when a world is re-POSTed
    // (default-world seeding races, tests, etc.).
    db.prepare(`
      INSERT INTO worlds (id, name, description) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
    `).run(data.id, data.name, data.description);

    db.prepare('DELETE FROM world_assets WHERE world_id = ?').run(data.id);
    db.prepare('DELETE FROM world_asset_connections WHERE world_id = ?').run(data.id);

    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
      const insertConnection = db.prepare('INSERT INTO world_asset_connections (id, source_id, target_id, world_id, relationship, description, inverse_relationship) VALUES (?, ?, ?, ?, ?, ?, ?)');
      
      data.assets.forEach(as => {
        insertAsset.run(as.id, data.id, as.type, as.name, as.description, JSON.stringify(as.tags || []));
      });
      
      data.assets.forEach(as => {
        if (as.connections) {
          as.connections.forEach(conn => {
            insertConnection.run(conn.id, as.id, conn.targetId, data.id, conn.relationship, conn.description || '', conn.inverseRelationship || '');
          });
        }
      });
    }
  });

  try {
    insertWorld(req.body);
    const result = getFullWorld(id);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create world', details: err.message });
  }
});

// PUT /api/worlds/:id
app.put('/api/worlds/:id', (req, res) => {
  const worldId = req.params.id;

  const updateWorld = db.transaction((data) => {
    const upd = db.prepare('UPDATE worlds SET name = ?, description = ? WHERE id = ?').run(data.name, data.description, worldId);
    if (upd.changes === 0) {
      const e = new Error('World not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    
    db.prepare('DELETE FROM world_assets WHERE world_id = ?').run(worldId);
    db.prepare('DELETE FROM world_asset_connections WHERE world_id = ?').run(worldId);

    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
      const insertConnection = db.prepare('INSERT INTO world_asset_connections (id, source_id, target_id, world_id, relationship, description, inverse_relationship) VALUES (?, ?, ?, ?, ?, ?, ?)');
      
      data.assets.forEach(as => {
        insertAsset.run(as.id, worldId, as.type, as.name, as.description, JSON.stringify(as.tags || []));
      });
      
      data.assets.forEach(as => {
        if (as.connections) {
          as.connections.forEach(conn => {
            insertConnection.run(conn.id, as.id, conn.targetId, worldId, conn.relationship, conn.description || '', conn.inverseRelationship || '');
          });
        }
      });
    }
  });

  try {
    updateWorld(req.body);
    const result = getFullWorld(worldId);
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'World not found' });
    res.status(500).json({ error: 'Failed to update world', details: err.message });
  }
});

// DELETE /api/worlds/:id
app.delete('/api/worlds/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM worlds WHERE id = ?').run(req.params.id);
    if (result.changes > 0) {
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'World not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete world', details: err.message });
  }
});

// GET /api/campaigns
app.get('/api/campaigns', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT id FROM campaigns').all().map(c => getFullCampaign(c.id)).filter(Boolean);
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns', details: err.message });
  }
});

// GET /api/campaigns/:id
app.get('/api/campaigns/:id', (req, res) => {
  try {
    const campaign = getFullCampaign(req.params.id);
    if (campaign) {
      res.json(campaign);
    } else {
      res.status(404).json({ error: 'Campaign not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign', details: err.message });
  }
});

// POST /api/campaigns
app.post('/api/campaigns', async (req, res) => {
  const { id } = req.body;
  
  const insertCampaign = db.transaction((data) => {
    // Robustness: ensure we overwrite if it exists (idempotent seeding)
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(data.id);
    
    db.prepare('INSERT INTO campaigns (id, name, description, world_id) VALUES (?, ?, ?, ?)').run(data.id, data.name, data.description, data.worldId || null);
    
    insertCampaignChildren(data.id, data);
  });

  try {
    insertCampaign(req.body);
    await safeIndexCampaignLore(id);
    const result = getFullCampaign(id);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create campaign', details: err.message });
  }
});

// PUT /api/campaigns/:id
app.put('/api/campaigns/:id', async (req, res) => {
  const campaignId = req.params.id;

  const updateCampaign = db.transaction((data) => {
    const upd = db.prepare('UPDATE campaigns SET name = ?, description = ?, world_id = ? WHERE id = ?').run(data.name, data.description, data.worldId || null, campaignId);
    if (upd.changes === 0) {
      const e = new Error('Campaign not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    
    db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM assets WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM players WHERE campaign_id = ?').run(campaignId);
    
    const existingEncounters = db.prepare('SELECT id FROM encounters WHERE campaign_id = ?').all(campaignId);
    for (const enc of existingEncounters) {
      db.prepare('DELETE FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').run(enc.id, campaignId);
    }
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);

    insertCampaignChildren(campaignId, data);
  });

  try {
    updateCampaign(req.body);
    await safeIndexCampaignLore(campaignId);
    const result = getFullCampaign(campaignId);
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Campaign not found' });
    res.status(500).json({ error: 'Failed to update campaign', details: err.message });
  }
});

// DELETE /api/campaigns/:id
app.delete('/api/campaigns/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    if (result.changes > 0) {
      // vector_chunks has no FK to campaigns, so clear this campaign's lore chunks (and cache entries) explicitly
      db.prepare('DELETE FROM vector_chunks WHERE campaign_id = ?').run(req.params.id);
      removeCampaignFromVectorCache(req.params.id);
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'Campaign not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete campaign', details: err.message });
  }
});

// --- Assistant Oracle API Endpoints ---

// GET /api/assistant/config
app.get('/api/assistant/config', (req, res) => {
  res.json(getConfig());
});

// GET /api/assistant/models — chat models currently installed on the LLM server
app.get('/api/assistant/models', async (req, res) => {
  res.json({ models: await listInstalledModels() });
});

// PUT /api/assistant/config
app.put('/api/assistant/config', (req, res) => {
  try {
    const updated = setConfig(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/assistant/chat
app.post('/api/assistant/chat', async (req, res) => {
  try {
    const {
      query,
      campaignId,
      encounterId,
      chapterId,
      chapterName,
      worldId,
      worldName,
      screen,
      model,
      mockResponse,
    } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }
    const result = await handleAssistantChat({
      query,
      campaignId,
      encounterId,
      chapterId,
      chapterName,
      worldId,
      worldName,
      screen,
      model,
      mockResponse: mockResponse ?? (process.env.NODE_ENV === 'test' && req.body.mock !== false),
    });

    // Send response immediately to frontend so DM is not delayed
    res.json(result);

    // Asynchronously capture memory footprint via /api/ps and record telemetry metrics
    if (result.metrics) {
      recordTelemetryAsync({
        model: result.modelUsed,
        rawMetrics: result.metrics,
      }).catch((telemetryErr) => {
        console.warn('[Telemetry] Error recording asynchronous metric:', telemetryErr.message);
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Assistant processing failed', details: err.message });
  }
});

// POST /api/assistant/confirm
app.post('/api/assistant/confirm', async (req, res) => {
  try {
    const { proposalId, action } = req.body || {};

    if (!proposalId || typeof proposalId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid proposalId.' });
    }
    if (!action || (action !== 'approve' && action !== 'deny')) {
      return res.status(400).json({ error: "Invalid action. Must be 'approve' or 'deny'." });
    }

    const result = await hitlManager.resolveProposal(proposalId, action);
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'ALREADY_RESOLVED') {
      return res.status(409).json({ error: err.message, status: err.status });
    }
    if (err.code === 'STALE_STATE') {
      return res.status(409).json({ error: err.message, status: err.status });
    }
    if (err.code === 'NO_HANDLER') {
      return res.status(501).json({ error: err.message });
    }
    if (err.code === 'INVALID_ACTION') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Proposal confirmation failed.', details: err.message });
  }
});

// GET /api/assistant/proposals/pending
// Lets a client that lost its local proposal queue (e.g. the DM dismissed
// the Oracle modal with Escape, or reloaded the page) recover every still-
// pending proposal instead of any of them being orphaned with no way back
// to them. Multiple proposals can be pending at once for the same campaign
// (the DM reviews them one at a time); this returns the whole queue, oldest
// first. Optionally scoped to a campaignId; unscoped only returns proposals
// with no campaign context (matches the lack of confirm-endpoint scoping
// documented in docs/HITL_WRITE_TOOLS.md).
app.get('/api/assistant/proposals/pending', (req, res) => {
  try {
    const campaignId = req.query.campaignId || null;
    const all = hitlManager.listPendingProposals();
    const filtered = campaignId
      ? all.filter((p) => p.context?.campaignId === campaignId)
      : all.filter((p) => !p.context?.campaignId);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list pending proposals.', details: err.message });
  }
});

// GET /api/assistant/metrics
app.get('/api/assistant/metrics', (req, res) => {
  try {
    const model = req.query.model || null;
    const limit = parseLimit(req.query.limit, 50);
    const metrics = getLlmMetrics({ model, limit });
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve metrics', details: err.message });
  }
});

// GET /api/assistant/metrics/summary
app.get('/api/assistant/metrics/summary', (req, res) => {
  try {
    const summary = getLlmMetricsSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve metrics summary', details: err.message });
  }
});

// POST /api/assistant/metrics
app.post('/api/assistant/metrics', (req, res) => {
  try {
    const {
      modelName,
      loadDuration,
      evalDuration,
      evalCount,
      totalDuration,
      vramBytes,
      totalBytes,
      timestamp,
    } = req.body;

    if (!modelName) {
      return res.status(400).json({ error: 'Missing required field: modelName' });
    }

    const record = recordLlmMetric({
      modelName,
      loadDuration,
      evalDuration,
      evalCount,
      totalDuration,
      vramBytes,
      totalBytes,
      timestamp,
    });

    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record metric', details: err.message });
  }
});

// GET /api/assistant/search
app.get('/api/assistant/search', async (req, res) => {
  try {
    const query = req.query.q;
    const campaignId = req.query.campaignId || null;
    const limit = parseLimit(req.query.limit, 3);
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter "q"' });
    }
    const passages = await searchVectorStore(query, { campaignId, limit });
    res.json(passages);
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// POST /api/assistant/index
app.post('/api/assistant/index', async (req, res) => {
  try {
    const srdCount = await indexSrdAndJsonData();
    let campaignCount = 0;
    if (req.body.campaignId) {
      campaignCount = await indexCampaignLore(req.body.campaignId);
    }
    res.json({ success: true, indexed: { srdAndJsons: srdCount, campaignLore: campaignCount } });
  } catch (err) {
    res.status(500).json({ error: 'Indexing failed', details: err.message });
  }
});

// GET /api/assistant/tools/log
app.get('/api/assistant/tools/log', (req, res) => {
  res.json(getToolAuditLog());
});

// TEST ONLY: Staging a write tool proposal.
// This is deliberately a separate mechanism from `clearWriteTools`
// (toolController.js), which resets the write-tool registry between test
// runs rather than staging a proposal: one lets tests drive a proposal
// through the real HTTP/HITL flow via supertest, the other resets shared
// module-level state so each test file starts from a clean registry. Both
// are gated to test usage (this route by NODE_ENV, `clearWriteTools` by
// only being called from `beforeEach` in test files), so keeping them
// separate rather than merging them is intentional, not redundant.
if (process.env.NODE_ENV === 'test') {
  app.post('/api/test/stage-proposal', async (req, res) => {
    try {
      const { toolName, args, context } = req.body || {};
      const result = await executeTool(toolName, args, context);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proposals staged via the route above go through the real hitlManager
  // and, with the fixed-TTL expiry replaced by hash-based staleness
  // detection (see docs/HITL_WRITE_TOOLS.md §8), no longer expire on their
  // own. A spec file that stages a proposal in one test but only asserts on
  // its rendering (never approving/denying it) leaves it pending
  // indefinitely, where a later test's "recover pending proposals on
  // reopen" fetch (see AssistantOracleModal) would pick it up and steal
  // focus onto it instead of the input the later test expects. Test files
  // that exercise real staged proposals should call this in beforeEach to
  // start every test from an empty queue.
  app.delete('/api/test/proposals', (req, res) => {
    hitlManager.clearProposals();
    res.status(204).send();
  });
}

// DANGER: Reset database (test only)
app.delete('/api/danger/reset', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Reset only allowed in test mode' });
  }
  try {
    db.prepare('DELETE FROM campaigns').run();
    db.prepare('DELETE FROM worlds').run();
    db.prepare('DELETE FROM vector_chunks').run();
    db.prepare('DELETE FROM map_overrides').run();
    clearLlmMetrics();
    invalidateVectorCache();
    await indexSrdAndJsonData();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Reset failed', details: err.message });
  }
});

export { app };

// Start server if not imported by a test runner (like supertest in vitest)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('server/index.js') || 
  process.argv[1].endsWith('server\\index.js') ||
  process.argv[1].endsWith('server/index') ||
  process.argv[1].endsWith('server\\index')
);

if (process.env.NODE_ENV !== 'test' || process.env.PORT || isMain) {
  app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
  });
}
