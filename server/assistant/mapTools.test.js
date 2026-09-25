import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../db.js';
import { makeFixture } from '../../src/shared/spatial/fixture.ts';
import { clearProposals } from './hitlManager.js';
import { READ_TOOLS, clearWriteTools, executeTool, registerBuiltInWriteTools } from './toolController.js';

const CAMPAIGN = 'camp-maptools';
const ENCOUNTER = 'enc-maptools';
const ctx = { campaignId: CAMPAIGN, encounterId: ENCOUNTER };
const INDEX = {
  schemaVersion: 1,
  maps: { 'test-map': { title: 'Map T.1: Test Shore', file: 'maptools-test.json', kind: 'tactical' } },
  byImage: { '/maps/maptools-test.png': 'test-map' },
};
let dir;

/** The synthetic 10 x 8 fixture with one building cell at (9, 7). */
function testDoc() {
  const doc = makeFixture({
    images: [
      { variant: 'dm', url: '/maps/maptools-test.png', width: 400, height: 300, cellPx: 37.5, originX: 27.5, originY: 34, provenance: { source: '5etools', confidence: 1 } },
    ],
  });
  doc.terrain.rows[7] = 'gggggggggB';
  return doc;
}

const combatants = [
  { instanceId: 'u-grog', name: 'Grog Strongjaw', currentHp: 45, maxHp: 45, initiative: 15, isPlayer: true, faction: 'ally', position: { x: 3, y: 5 } },
  { instanceId: 'u-sah1', name: 'Sahuagin 1', monsterId: '17003', currentHp: 22, maxHp: 22, initiative: 12, isPlayer: false, faction: 'enemy', position: { x: 8, y: 6 } },
  { instanceId: 'u-sah2', name: 'Sahuagin 2', monsterId: '17003', currentHp: 22, maxHp: 22, initiative: 10, isPlayer: false, faction: 'enemy', position: { x: 3, y: 3 } },
];

function seed() {
  db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(CAMPAIGN);
  db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(CAMPAIGN);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(CAMPAIGN);
  db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(CAMPAIGN, 'Map Tools', 'test');
  db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url) VALUES (?, ?, ?, ?, ?)').run(
    ENCOUNTER, CAMPAIGN, 'Shore fight',
    JSON.stringify({ isCombatStarted: true, round: 1, turnIndex: 0, combatants, combatLog: [] }),
    '/maps/maptools-test.png'
  );
  for (const c of combatants) {
    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, tempHp, dexMod, initiative, isPlayer, monsterId, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)'
    ).run(c.instanceId, ENCOUNTER, CAMPAIGN, c.name, c.maxHp, c.currentHp, c.initiative, c.isPlayer ? 1 : 0, c.monsterId ?? null, c.faction, c.position.x, c.position.y);
  }
}

const writeDoc = (doc) => fs.writeFileSync(path.join(dir, 'maptools-test.json'), JSON.stringify(doc));
const writeIndex = (index) => fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maptools-'));
  writeDoc(testDoc());
  writeIndex(INDEX);
  process.env.MAPS_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.MAPS_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(CAMPAIGN);
  db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(CAMPAIGN);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(CAMPAIGN);
});

beforeEach(() => {
  clearProposals();
  clearWriteTools();
  registerBuiltInWriteTools();
  writeDoc(testDoc());
  writeIndex(INDEX);
  seed();
});

describe('get_map_overview', () => {
  it('lists areas with terrain and features, plus combatants with area and ground', async () => {
    const r = await executeTool('get_map_overview', {}, ctx);
    expect(r.map).toBe('Map T.1: Test Shore');
    expect(r.regions.map((x) => x.id)).toEqual(['P1', 'P2']);
    expect(r.regions[0].terrain).toContain('shallow water');
    expect(r.regions[1].features).toEqual(['1 palm tree (half cover)']);
    const sah = r.combatants.find((c) => c.name === 'Sahuagin 1');
    expect(sah).toMatchObject({ cell: 'I7', region: 'P2 Grove', terrain: 'grass' });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(4000);
  });

  it('can leave combatants out', async () => {
    const r = await executeTool('get_map_overview', { include_combatants: false }, ctx);
    expect(r.combatants).toBeUndefined();
  });

  it('says so plainly when there is no prepared map data', async () => {
    writeIndex({ schemaVersion: 1, maps: {}, byImage: {} });
    const r = await executeTool('get_map_overview', {}, ctx);
    expect(r.error).toMatch(/Prepared map data is not available/);
    expect(r.hint).toMatch(/get_current_map/);
  });
});

describe('describe_surroundings', () => {
  it('describes ground, features, and cover for a named combatant', async () => {
    const r = await executeTool('describe_surroundings', { combatant: 'Sahuagin 2', radius_ft: 30 }, ctx);
    expect(r).toMatchObject({ subject: 'Sahuagin 2', cell: 'D4', region: 'P2 Grove', standingOn: 'grass' });
    expect(r.terrain.some((t) => t.startsWith('Sand starts 5 ft north'))).toBe(true);
    expect(r.features.some((f) => f.startsWith('Palm tree 5 ft west'))).toBe(true);
    expect(r.coverNow[0].from).toBe('Grog Strongjaw');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(2500);
  });

  it('reports unknown combatants with the list of valid ones', async () => {
    const r = await executeTool('describe_surroundings', { combatant: 'Zorblax' }, ctx);
    expect(r.error).toMatch(/not found/);
    expect(r.hint).toContain('Sahuagin 1');
  });
});

describe('find_positions', () => {
  it('finds a sand cell in P1 that touches water', async () => {
    const r = await executeTool('find_positions', {
      for_combatant: 'Sahuagin 1', region: 'P1', terrain: ['sand'], next_to_terrain: ['water'], limit: 3,
    }, ctx);
    expect(r.count).toBe(10);
    expect(r.results[0]).toMatchObject({ terrain: 'sand', region: 'P1 South Shore' });
    expect(r.results[0].why.join(' ')).toContain('water touches it');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(1200);
  });

  it('accepts region names and near-a-combatant searches', async () => {
    const byName = await executeTool('find_positions', { region: 'south shore', terrain: ['sand'], limit: 1 }, ctx);
    expect(byName.results[0].cell).toBe('A3');
    const near = await executeTool('find_positions', { near: 'Grog Strongjaw', within_ft: 10, avoid_terrain: ['water'], limit: 10 }, ctx);
    expect(near.results.length).toBeGreaterThan(0);
    const byCell = await executeTool('find_positions', { near: 'D4', within_ft: 5, limit: 10 }, ctx);
    expect(byCell.count).toBeGreaterThan(0);
  });

  it('lists valid areas when the region is unknown', async () => {
    const r = await executeTool('find_positions', { region: 'Nowhere Land' }, ctx);
    expect(r.error).toMatch(/No area matches/);
    expect(r.hint).toContain('P1 South Shore');
  });

  it('explains what eliminated every cell', async () => {
    const r = await executeTool('find_positions', { region: 'P2', terrain: ['grass'], next_to_terrain: ['water'] }, ctx);
    expect(r.count).toBe(0);
    expect(r.eliminatedBy).toBe('next to water');
    expect(r.hint).toMatch(/No grass cell in P2 touches water/);
  });

  it('finds hidden cells and cells reachable this turn', async () => {
    const hidden = await executeTool('find_positions', { for_combatant: 'Sahuagin 1', hidden_from: 'Grog Strongjaw', region: 'P2', limit: 3 }, ctx);
    expect(hidden.results.length).toBeGreaterThan(0);
    const reach = await executeTool('find_positions', { for_combatant: 'Sahuagin 1', reachable_this_turn: true, region: 'P2', limit: 10 }, ctx);
    expect(reach.results.every((x) => Math.max(Math.abs(x.x - 8), Math.abs(x.y - 6)) <= 6)).toBe(true);
    const bad = await executeTool('find_positions', { reachable_this_turn: true }, ctx);
    expect(bad.error).toMatch(/needs for_combatant/);
  });

  it('never returns a cell held by another creature', async () => {
    const r = await executeTool('find_positions', { for_combatant: 'Sahuagin 1', near: 'Grog Strongjaw', within_ft: 5, limit: 10 }, ctx);
    expect(r.results.map((x) => x.cell)).not.toContain('D6');
  });

  it('uses the monster stat block for speed (Sahuagin swims 40 ft)', async () => {
    const r = await executeTool('find_positions', { for_combatant: 'Sahuagin 2', terrain: ['water_deep'], reachable_this_turn: true, limit: 1 }, ctx);
    expect(r.count).toBeGreaterThan(0);
  });
});

describe('move_combatant annotations', () => {
  it('adds terrain and notes to the staged proposal without moving anything', async () => {
    const r = await executeTool('move_combatant', { combatantName: 'Sahuagin 1', destination: 'E3' }, ctx);
    expect(r.status).toBe('proposal_staged');
    const dest = r.proposal.payload.destination;
    expect(dest.terrain).toBe('sand');
    expect(dest.notes[0]).toMatch(/^Sand; water touches it to the /);
    const row = db.prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?').get('u-sah1');
    expect(row).toEqual({ position_x: 8, position_y: 6 });
  });

  it('rejects a building cell and offers nearby alternatives', async () => {
    await expect(executeTool('move_combatant', { combatantName: 'Sahuagin 1', destination: 'J8' }, ctx))
      .rejects.toThrow(/J8 is not usable: J8 is building\. Nearby cells that work: /);
  });

  it('notes cover from opposing creatures', async () => {
    const r = await executeTool('move_combatant', { combatantName: 'Sahuagin 1', destination: 'F6' }, ctx);
    expect(r.proposal.payload.destination.notes.some((n) => n.includes('cover from Grog Strongjaw'))).toBe(true);
  });
});

describe('get_current_map guidance', () => {
  it('is steered towards the new tools in its description', () => {
    const def = READ_TOOLS.find((t) => t.function.name === 'get_current_map');
    expect(def.function.description).toMatch(/find_positions/);
  });
});

describe('configure_encounter_combatants with area keys', () => {
  it('places scenario creatures inside the named area, spread near its label, not stacked or read as a cell', async () => {
    const r = await executeTool('configure_encounter_combatants', { scenarioText: 'Three Sahuagin appear in P1.' }, ctx);
    expect(r.status).toBe('proposal_staged');
    const rows = r.proposal.payload.combatants;
    expect(rows).toHaveLength(3);
    const cells = rows.map((c) => `${c.coordinates.x},${c.coordinates.y}`);
    expect(new Set(cells).size).toBe(3);
    // P1 South Shore is rows 1 and 2 of the fixture; "P1" must not be read as cell column P.
    for (const c of rows) {
      expect(c.coordinates.y).toBeGreaterThanOrEqual(1);
      expect(c.coordinates.y).toBeLessThanOrEqual(3);
      expect(c.coordinates.x).toBeLessThan(10);
      expect(JSON.stringify(c)).toContain('South Shore');
    }
  });
});
