import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { db, initDb } from './db.js';
import { getConfig, setConfig } from './assistant/config.js';
import { handleAssistantChat } from './assistant/orchestrator.js';
import { searchVectorStore, indexSrdAndJsonData, indexCampaignLore, invalidateVectorCache } from './assistant/vectorStore.js';
import { getToolAuditLog } from './assistant/toolController.js';
import {
  recordTelemetryAsync,
  getLlmMetrics,
  getLlmMetricsSummary,
  recordLlmMetric,
  clearLlmMetrics,
} from './assistant/telemetry.js';

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
  for (const asset of assets) {
    asset.tags = asset.tags ? JSON.parse(asset.tags) : [];
    asset.connections = db.prepare('SELECT id, target_id as targetId, relationship FROM world_asset_connections WHERE source_id = ? AND world_id = ?').all(asset.id, id);
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
  for (const asset of assets) {
    asset.chapterIds = db.prepare('SELECT chapter_id FROM asset_chapters WHERE asset_id = ? AND campaign_id = ?').all(asset.id, id).map(r => r.chapter_id);
  }
  campaign.assets = assets;

  campaign.players = db.prepare('SELECT id, name, description FROM players WHERE campaign_id = ?').all(id);
  
  const encounters = db.prepare('SELECT id, name, running_state as runningState, dm_map_url as dmMapUrl, player_map_url as playerMapUrl, map_size as mapSize, grid_config as gridConfig FROM encounters WHERE campaign_id = ?').all(id);
  for (const enc of encounters) {
    enc.runningState = enc.runningState ? JSON.parse(enc.runningState) : null;
    enc.mapSize = enc.mapSize ? JSON.parse(enc.mapSize) : null;
    enc.gridConfig = enc.gridConfig ? JSON.parse(enc.gridConfig) : null;
    enc.chapterIds = db.prepare('SELECT chapter_id FROM encounter_chapters WHERE encounter_id = ? AND campaign_id = ?').all(enc.id, id).map(r => r.chapter_id);
    enc.units = db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').all(enc.id, id);
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
    db.prepare('DELETE FROM worlds WHERE id = ?').run(data.id);
    db.prepare('INSERT INTO worlds (id, name, description) VALUES (?, ?, ?)').run(data.id, data.name, data.description);
    
    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
      const insertConnection = db.prepare('INSERT INTO world_asset_connections (id, source_id, target_id, world_id, relationship) VALUES (?, ?, ?, ?, ?)');
      
      data.assets.forEach(as => {
        insertAsset.run(as.id, data.id, as.type, as.name, as.description, JSON.stringify(as.tags || []));
      });
      
      data.assets.forEach(as => {
        if (as.connections) {
          as.connections.forEach(conn => {
            insertConnection.run(conn.id, as.id, conn.targetId, data.id, conn.relationship);
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
    db.prepare('UPDATE worlds SET name = ?, description = ? WHERE id = ?').run(data.name, data.description, worldId);
    
    db.prepare('DELETE FROM world_assets WHERE world_id = ?').run(worldId);
    db.prepare('DELETE FROM world_asset_connections WHERE world_id = ?').run(worldId);

    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
      const insertConnection = db.prepare('INSERT INTO world_asset_connections (id, source_id, target_id, world_id, relationship) VALUES (?, ?, ?, ?, ?)');
      
      data.assets.forEach(as => {
        insertAsset.run(as.id, worldId, as.type, as.name, as.description, JSON.stringify(as.tags || []));
      });
      
      data.assets.forEach(as => {
        if (as.connections) {
          as.connections.forEach(conn => {
            insertConnection.run(conn.id, as.id, conn.targetId, worldId, conn.relationship);
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
app.post('/api/campaigns', (req, res) => {
  const { id } = req.body;
  
  const insertCampaign = db.transaction((data) => {
    // Robustness: ensure we overwrite if it exists (idempotent seeding)
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(data.id);
    
    db.prepare('INSERT INTO campaigns (id, name, description, world_id) VALUES (?, ?, ?, ?)').run(data.id, data.name, data.description, data.worldId || null);
    
    if (data.chapters) {
      const insertChapter = db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)');
      data.chapters.forEach(ch => insertChapter.run(ch.id, data.id, ch.title, ch.content, ch.order));
    }
    
    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO assets (id, campaign_id, type, name, description, world_asset_id) VALUES (?, ?, ?, ?, ?, ?)');
      const insertAssetChapter = db.prepare('INSERT INTO asset_chapters (asset_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      data.assets.forEach(as => {
        insertAsset.run(as.id, data.id, as.type, as.name, as.description, as.worldAssetId || null);
        if (as.chapterIds) {
          as.chapterIds.forEach(chapId => insertAssetChapter.run(as.id, chapId, data.id));
        }
      });
    }
    
    if (data.players) {
      const insertPlayer = db.prepare('INSERT INTO players (id, campaign_id, name, description) VALUES (?, ?, ?, ?)');
      data.players.forEach(pl => insertPlayer.run(pl.id, data.id, pl.name, pl.description));
    }
    
    if (data.encounters) {
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const insertEncounterChapter = db.prepare('INSERT INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer, position_x, position_y, phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.encounters.forEach(enc => {
        insertEncounter.run(
          enc.id,
          data.id,
          enc.name,
          enc.runningState ? JSON.stringify(enc.runningState) : null,
          enc.dmMapUrl || null,
          enc.playerMapUrl || null,
          enc.mapSize ? JSON.stringify(enc.mapSize) : null,
          enc.gridConfig ? JSON.stringify(enc.gridConfig) : null
        );
        if (enc.chapterIds) {
          enc.chapterIds.forEach(chapId => insertEncounterChapter.run(enc.id, chapId, data.id));
        }
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, data.id, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0,
            u.position?.x ?? null,
            u.position?.y ?? null,
            u.phase ?? 1
          ));
        }
      });
    }
  });

  try {
    insertCampaign(req.body);
    indexCampaignLore(id);
    const result = getFullCampaign(id);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create campaign', details: err.message });
  }
});

// PUT /api/campaigns/:id
app.put('/api/campaigns/:id', (req, res) => {
  const campaignId = req.params.id;

  const updateCampaign = db.transaction((data) => {
    db.prepare('UPDATE campaigns SET name = ?, description = ?, world_id = ? WHERE id = ?').run(data.name, data.description, data.worldId || null, campaignId);
    
    db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM assets WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM players WHERE campaign_id = ?').run(campaignId);
    
    const existingEncounters = db.prepare('SELECT id FROM encounters WHERE campaign_id = ?').all(campaignId);
    for (const enc of existingEncounters) {
      db.prepare('DELETE FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').run(enc.id, campaignId);
    }
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);

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
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const insertEncounterChapter = db.prepare('INSERT INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer, position_x, position_y, phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          enc.gridConfig ? JSON.stringify(enc.gridConfig) : null
        );
        if (enc.chapterIds) {
          enc.chapterIds.forEach(chapId => insertEncounterChapter.run(enc.id, chapId, campaignId));
        }
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, campaignId, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0,
            u.position?.x ?? null,
            u.position?.y ?? null,
            u.phase ?? 1
          ));
        }
      });
    }
  });

  try {
    updateCampaign(req.body);
    indexCampaignLore(campaignId);
    const result = getFullCampaign(campaignId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update campaign', details: err.message });
  }
});

// DELETE /api/campaigns/:id
app.delete('/api/campaigns/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    if (result.changes > 0) {
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

// GET /api/assistant/metrics
app.get('/api/assistant/metrics', (req, res) => {
  try {
    const model = req.query.model || null;
    const limit = parseInt(req.query.limit || '50', 10);
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
    const limit = parseInt(req.query.limit || '3', 10);
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

// DANGER: Reset database (test only)
app.delete('/api/danger/reset', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Reset only allowed in test mode' });
  }
  try {
    db.prepare('DELETE FROM campaigns').run();
    db.prepare('DELETE FROM worlds').run();
    db.prepare('DELETE FROM vector_chunks').run();
    try {
      db.prepare('DELETE FROM llm_metrics').run();
    } catch {
      // Table might not exist in uninitialized test db
    }
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
