import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { db, initDb } from './db.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

initDb();

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
  
  const encounters = db.prepare('SELECT id, name FROM encounters WHERE campaign_id = ?').all(id);
  for (const enc of encounters) {
    enc.chapterIds = db.prepare('SELECT chapter_id FROM encounter_chapters WHERE encounter_id = ? AND campaign_id = ?').all(enc.id, id).map(r => r.chapter_id);
    enc.units = db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').all(enc.id, id);
    // Convert isPlayer back to boolean
    enc.units.forEach(u => {
      u.isPlayer = !!u.isPlayer;
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
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)');
      const insertEncounterChapter = db.prepare('INSERT INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.encounters.forEach(enc => {
        insertEncounter.run(enc.id, data.id, enc.name);
        if (enc.chapterIds) {
          enc.chapterIds.forEach(chapId => insertEncounterChapter.run(enc.id, chapId, data.id));
        }
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, data.id, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0
          ));
        }
      });
    }
  });

  try {
    insertCampaign(req.body);
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
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)');
      const insertEncounterChapter = db.prepare('INSERT INTO encounter_chapters (encounter_id, chapter_id, campaign_id) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.encounters.forEach(enc => {
        insertEncounter.run(enc.id, campaignId, enc.name);
        if (enc.chapterIds) {
          enc.chapterIds.forEach(chapId => insertEncounterChapter.run(enc.id, chapId, campaignId));
        }
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, campaignId, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0
          ));
        }
      });
    }
  });

  try {
    updateCampaign(req.body);
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

// DANGER: Reset database (test only)
app.delete('/api/danger/reset', (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Reset only allowed in test mode' });
  }
  try {
    db.prepare('DELETE FROM campaigns').run();
    db.prepare('DELETE FROM worlds').run();
    // CASCADE will handle the rest
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
