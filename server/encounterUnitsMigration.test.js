import { describe, it, expect } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { app } from './index.js';
import { initDb } from './db.js';

const mkCampaign = (id) => ({
  id,
  name: id,
  description: 'd',
  encounters: [
    {
      id: 'enc-1',
      name: 'E',
      units: [{ instanceId: 'shared-unit-1', name: `Goblin of ${id}`, dexMod: 2, isPlayer: false }],
    },
  ],
});

describe('encounter_units composite primary key', () => {
  it('allows the same instanceId in two campaigns via the API', async () => {
    const a = 'pk-camp-a';
    const b = 'pk-camp-b';
    try {
      expect((await request(app).post('/api/campaigns').send(mkCampaign(a))).status).toBe(201);
      expect((await request(app).post('/api/campaigns').send(mkCampaign(b))).status).toBe(201);

      const ra = await request(app).get(`/api/campaigns/${a}`);
      const rb = await request(app).get(`/api/campaigns/${b}`);
      expect(ra.body.encounters[0].units).toHaveLength(1);
      expect(ra.body.encounters[0].units[0].name).toBe(`Goblin of ${a}`);
      expect(rb.body.encounters[0].units[0].name).toBe(`Goblin of ${b}`);
    } finally {
      await request(app).delete(`/api/campaigns/${a}`);
      await request(app).delete(`/api/campaigns/${b}`);
    }
  });
});

describe('encounter_units PK migration', () => {
  const pkOf = (db) =>
    db
      .prepare('PRAGMA table_info(encounter_units)')
      .all()
      .filter((c) => c.pk > 0)
      .sort((x, y) => x.pk - y.pk)
      .map((c) => c.name);

  function legacyDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, world_id TEXT);
      CREATE TABLE encounters (
        id TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL, running_state TEXT,
        PRIMARY KEY (id, campaign_id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      );
      -- oldest legacy shape: no position/phase/tempHp/faction columns
      CREATE TABLE encounter_units (
        instanceId TEXT PRIMARY KEY,
        encounter_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        monsterId TEXT, playerId TEXT,
        name TEXT NOT NULL,
        maxHp INTEGER, currentHp INTEGER, hpDice TEXT,
        dexMod INTEGER NOT NULL, initiative INTEGER, passivePerception INTEGER,
        isPlayer INTEGER NOT NULL,
        FOREIGN KEY (encounter_id, campaign_id) REFERENCES encounters(id, campaign_id) ON DELETE CASCADE
      );
      INSERT INTO campaigns (id, name) VALUES ('c1', 'C1'), ('c2', 'C2');
      INSERT INTO encounters (id, campaign_id, name) VALUES ('e1', 'c1', 'E1'), ('e1', 'c2', 'E1');
      INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, isPlayer)
        VALUES ('u1', 'e1', 'c1', 'Orc', 15, 9, 1, 0);
    `);
    return db;
  }

  it('migrates a legacy schema, preserving data, and is idempotent', () => {
    const db = legacyDb();
    expect(pkOf(db)).toEqual(['instanceId']);

    initDb(db);
    expect(pkOf(db)).toEqual(['instanceId', 'campaign_id']);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    const rows = db.prepare('SELECT * FROM encounter_units').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      instanceId: 'u1', campaign_id: 'c1', name: 'Orc', maxHp: 15, currentHp: 9,
      phase: 1, tempHp: 0, faction: 'enemy', position_x: null,
    });

    // Same instanceId in another campaign is now allowed.
    db.prepare(
      "INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, dexMod, isPlayer) VALUES ('u1','e1','c2','Orc2',0,0)"
    ).run();
    // But duplicates within one campaign are still rejected.
    expect(() =>
      db.prepare(
        "INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, dexMod, isPlayer) VALUES ('u1','e1','c2','dup',0,0)"
      ).run()
    ).toThrow();

    // Cascade FK still works after rebuild.
    db.prepare("DELETE FROM campaigns WHERE id = 'c2'").run();
    expect(db.prepare('SELECT COUNT(*) n FROM encounter_units').get().n).toBe(1);

    initDb(db);
    initDb(db);
    expect(pkOf(db)).toEqual(['instanceId', 'campaign_id']);
    expect(db.prepare('SELECT COUNT(*) n FROM encounter_units').get().n).toBe(1);
    db.close();
  });

  it('fresh DB gets the composite key and re-init is a no-op', () => {
    const db = new Database(':memory:');
    initDb(db);
    expect(pkOf(db)).toEqual(['instanceId', 'campaign_id']);
    initDb(db);
    expect(pkOf(db)).toEqual(['instanceId', 'campaign_id']);
    db.close();
  });
});
