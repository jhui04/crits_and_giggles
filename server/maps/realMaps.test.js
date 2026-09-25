import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getMapDocumentById, getMapModel } from './mapStore.js';
import { describeSurroundings, findPositions, mapOverview } from '../../src/shared/spatial/index.ts';

// These run against the real compiled maps in public/data/maps, so they double as a check that the
// generated data loads, indexes correctly, and keeps assistant answers inside their size budgets.
const index = JSON.parse(fs.readFileSync(path.resolve('public/data/maps/index.json'), 'utf-8'));
const tactical = Object.entries(index.maps).filter(([, m]) => m.kind === 'tactical');

describe('compiled maps', () => {
  it('has all twelve maps and every image resolves to one of them', () => {
    expect(Object.keys(index.maps)).toHaveLength(12);
    for (const [, id] of Object.entries(index.byImage)) expect(index.maps[id]).toBeDefined();
  });

  it.each(tactical)('%s: every region cell, wall, spawn, and object lies inside the grid', (id) => {
    const doc = getMapDocumentById(id);
    const { columns, rows } = doc.grid;
    const inside = (k) => {
      const [x, y] = k.split(',').map(Number);
      return x >= 0 && y >= 0 && x < columns && y < rows;
    };
    for (const r of doc.regions) expect(r.cells.every(inside)).toBe(true);
    for (const o of doc.objects) expect(o.cells.every(inside)).toBe(true);
    for (const s of doc.spawns) expect(inside(`${s.cell.x},${s.cell.y}`)).toBe(true);
    // Walls that could not be aligned (confidence under 0.5, such as 5.7) are stored as found and ignored.
    for (const w of doc.walls.filter((x) => x.provenance.confidence >= 0.5)) {
      for (const p of [w.a, w.b]) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(columns + 1);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeLessThanOrEqual(rows + 1);
      }
    }
    if (doc.terrain) {
      expect(doc.terrain.rows).toHaveLength(rows);
      expect(doc.terrain.rows.every((r) => r.length === columns)).toBe(true);
    }
  });

  it.each(tactical)('%s: assistant answers stay inside their size budgets', (id) => {
    const doc = getMapDocumentById(id);
    const model = getMapModel(doc);
    const withCells = doc.regions.filter((r) => r.cells.length);
    const at = (r) => {
      const [x, y] = r.cells[Math.floor(r.cells.length / 2)].split(',').map(Number);
      return { x, y };
    };
    const combatants = withCells.slice(0, 6).map((r, i) => ({
      instanceId: `c${i}`, name: `Creature ${i + 1}`, isPlayer: i === 0, faction: i === 0 ? 'ally' : 'enemy',
      position: at(r), size: 'Medium', speeds: { walk: 30 },
    }));
    expect(JSON.stringify(mapOverview(model, combatants, true)).length).toBeLessThanOrEqual(4000);
    if (combatants.length > 1) {
      expect(JSON.stringify(describeSurroundings(model, combatants[1], combatants, 60)).length).toBeLessThanOrEqual(2500);
      const found = findPositions(model, { forCombatant: combatants[1], near: combatants[0].position, withinFt: 60, coverFrom: combatants[0], limit: 3 });
      expect(JSON.stringify(found).length).toBeLessThanOrEqual(1200);
    }
  });

  it('Palma Flora answers the water-edge question with sand that touches water', () => {
    const doc = getMapDocumentById('egtw-5.1-palma-flora');
    const model = getMapModel(doc);
    const mover = { instanceId: 's', name: 'Sahuagin 1', faction: 'enemy', position: { x: 40, y: 20 }, speeds: { walk: 30, swim: 40 } };
    const res = findPositions(model, { forCombatant: mover, region: model.findRegion('P1'), terrain: ['sand'], nextToTerrain: ['water_deep', 'water_shallow'], limit: 3 });
    expect(res.count).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.terrain).toBe('sand');
      expect(model.touchesTerrain({ x: r.x, y: r.y }, ['water_deep', 'water_shallow'])).toBe(true);
      expect(model.regionAt({ x: r.x, y: r.y }).id).toBe('P1');
    }
  });
});
