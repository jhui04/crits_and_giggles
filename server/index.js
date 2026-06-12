import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { db, initDb } from './db.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

initDb();

// Helper to get full campaign
function getFullCampaign(id) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return null;

  campaign.chapters = db.prepare('SELECT id, title, content, order_index as "order" FROM chapters WHERE campaign_id = ? ORDER BY order_index').all(id);
  campaign.assets = db.prepare('SELECT * FROM assets WHERE campaign_id = ?').all(id);
  campaign.players = db.prepare('SELECT * FROM players WHERE campaign_id = ?').all(id);
  
  const encounters = db.prepare('SELECT * FROM encounters WHERE campaign_id = ?').all(id);
  for (const enc of encounters) {
    enc.units = db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ?').all(enc.id);
    // Convert isPlayer back to boolean
    enc.units.forEach(u => {
      u.isPlayer = !!u.isPlayer;
    });
  }
  campaign.encounters = encounters;

  return campaign;
}

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
    
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(data.id, data.name, data.description);
    
    if (data.chapters) {
      const insertChapter = db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)');
      data.chapters.forEach(ch => insertChapter.run(ch.id, data.id, ch.title, ch.content, ch.order));
    }
    
    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO assets (id, campaign_id, type, name, description) VALUES (?, ?, ?, ?, ?)');
      data.assets.forEach(as => insertAsset.run(as.id, data.id, as.type, as.name, as.description));
    }
    
    if (data.players) {
      const insertPlayer = db.prepare('INSERT INTO players (id, campaign_id, name, description) VALUES (?, ?, ?, ?)');
      data.players.forEach(pl => insertPlayer.run(pl.id, data.id, pl.name, pl.description));
    }
    
    if (data.encounters) {
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.encounters.forEach(enc => {
        insertEncounter.run(enc.id, data.id, enc.name);
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0
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
    db.prepare('UPDATE campaigns SET name = ?, description = ? WHERE id = ?').run(data.name, data.description, campaignId);
    
    db.prepare('DELETE FROM chapters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM assets WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM players WHERE campaign_id = ?').run(campaignId);
    
    const existingEncounters = db.prepare('SELECT id FROM encounters WHERE campaign_id = ?').all(campaignId);
    for (const enc of existingEncounters) {
      db.prepare('DELETE FROM encounter_units WHERE encounter_id = ?').run(enc.id);
    }
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);

    if (data.chapters) {
      const insertChapter = db.prepare('INSERT INTO chapters (id, campaign_id, title, content, order_index) VALUES (?, ?, ?, ?, ?)');
      data.chapters.forEach(ch => insertChapter.run(ch.id, campaignId, ch.title, ch.content, ch.order));
    }
    
    if (data.assets) {
      const insertAsset = db.prepare('INSERT INTO assets (id, campaign_id, type, name, description) VALUES (?, ?, ?, ?, ?)');
      data.assets.forEach(as => insertAsset.run(as.id, campaignId, as.type, as.name, as.description));
    }
    
    if (data.players) {
      const insertPlayer = db.prepare('INSERT INTO players (id, campaign_id, name, description) VALUES (?, ?, ?, ?)');
      data.players.forEach(pl => insertPlayer.run(pl.id, campaignId, pl.name, pl.description));
    }
    
    if (data.encounters) {
      const insertEncounter = db.prepare('INSERT INTO encounters (id, campaign_id, name) VALUES (?, ?, ?)');
      const insertUnit = db.prepare(`
        INSERT INTO encounter_units (instanceId, encounter_id, monsterId, playerId, name, maxHp, currentHp, hpDice, dexMod, initiative, passivePerception, isPlayer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.encounters.forEach(enc => {
        insertEncounter.run(enc.id, campaignId, enc.name);
        if (enc.units) {
          enc.units.forEach(u => insertUnit.run(
            u.instanceId, enc.id, u.monsterId, u.playerId, u.name, u.maxHp, u.currentHp, u.hpDice, u.dexMod, u.initiative, u.passivePerception, u.isPlayer ? 1 : 0
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
    // CASCADE will handle the rest
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Reset failed', details: err.message });
  }
});

export { app };

// Start server if not imported by a test runner (like supertest in vitest)
if (process.env.NODE_ENV !== 'test' || process.env.PORT) {
  app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
  });
}
