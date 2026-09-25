import { describe, expect, it } from 'vitest';
import { buildMapModel } from './mapModel.ts';
import { makeFixture } from './fixture.ts';
import { findPositions } from './queries.ts';
import { describeSurroundings, mapOverview } from './describe.ts';
import { cellLabel, parseCellLabel } from './labels.ts';
import { expandTerrainNames } from './terrainRules.ts';
import type { CombatantLite, MapDocument, MapOverride } from './types.ts';

const model = () => buildMapModel(makeFixture());
const water = expandTerrainNames(['water']);

describe('terrain queries', () => {
  it('reads terrain, distances and adjacency', () => {
    const m = model();
    expect(m.terrainAt({ x: 3, y: 0 })).toBe('water_deep');
    expect(m.terrainAt({ x: 3, y: 2 })).toBe('sand');
    expect(m.hasTerrain()).toBe(true);
    expect(m.distanceToTerrain({ x: 3, y: 2 }, water)).toBe(1);
    expect(m.distanceToTerrain({ x: 3, y: 5 }, water)).toBe(4);
    expect(m.distanceToTerrain({ x: 3, y: 5 }, ['ice'])).toBe(Infinity);
    expect(m.touchesTerrain({ x: 3, y: 2 }, water)).toBe(true);
    expect(m.touchesTerrain({ x: 3, y: 3 }, water)).toBe(false);
  });

  it('reports unknown terrain when there is no terrain layer', () => {
    const m = buildMapModel(makeFixture({ terrain: undefined }));
    expect(m.hasTerrain()).toBe(false);
    expect(m.terrainAt({ x: 1, y: 1 })).toBe('unknown');
  });

  it('finds regions by id, zero-padded id, name, and fuzzy name', () => {
    const m = model();
    expect(m.findRegion('P1')?.id).toBe('P1');
    expect(m.findRegion('p01')?.id).toBe('P1');
    expect(m.findRegion('south shore')?.id).toBe('P1');
    expect(m.findRegion('South Shroe')?.id).toBe('P1');
    expect(m.findRegion('grove')?.id).toBe('P2');
    expect(m.findRegion('completely different')).toBeUndefined();
    expect(m.regionAt({ x: 4, y: 2 })?.id).toBe('P1');
  });
});

describe('movement', () => {
  it('blocks steps through walls and closed doors but not open ones', () => {
    const m = model();
    expect(m.stepBlocked({ x: 4, y: 5 }, { x: 5, y: 5 }).blocked).toBe(true);
    expect(m.stepBlocked({ x: 4, y: 7 }, { x: 5, y: 7 }).by?.id).toBe('w-door');
    expect(m.stepBlocked({ x: 4, y: 3 }, { x: 5, y: 3 }).blocked).toBe(false);
    const openDoc = makeFixture();
    openDoc.walls[1] = { ...openDoc.walls[1], door: { state: 'open' } };
    expect(buildMapModel(openDoc).stepBlocked({ x: 4, y: 7 }, { x: 5, y: 7 }).blocked).toBe(false);
  });

  it('honours one-way walls from one side only', () => {
    const doc = makeFixture();
    doc.walls = [{ ...doc.walls[0], id: 'ow', a: { x: 5, y: 3 }, b: { x: 5, y: 6 }, oneWay: 'left' }];
    const m = buildMapModel(doc);
    const east = m.stepBlocked({ x: 6, y: 4 }, { x: 4, y: 4 }).blocked;
    const west = m.stepBlocked({ x: 4, y: 4 }, { x: 6, y: 4 }).blocked;
    expect(east).not.toBe(west);
  });

  it('charges difficult terrain, swimming, and respects swim speed', () => {
    const m = model();
    expect(m.stepCostFeet({ x: 3, y: 3 }, { x: 3, y: 2 })).toBe(5);
    expect(m.stepCostFeet({ x: 3, y: 2 }, { x: 3, y: 1 })).toBe(10);
    expect(m.stepCostFeet({ x: 3, y: 1 }, { x: 3, y: 0 })).toBe(10);
    expect(m.stepCostFeet({ x: 3, y: 1 }, { x: 3, y: 0 }, { instanceId: 's', name: 'S', speeds: { swim: 30 } })).toBe(5);
    expect(m.stepCostFeet({ x: 1, y: 3 }, { x: 2, y: 3 })).toBe(5); // palm tree is not difficult
    expect(m.stepCostFeet({ x: 4, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('computes reachable cells with a budget', () => {
    const m = model();
    const from = { x: 3, y: 3 };
    const r10 = m.reachable(from, 10);
    expect(r10.get('3,2')).toBe(5);
    expect(r10.has('3,1')).toBe(false); // 5 + 10 = 15
    const r20 = m.reachable(from, 20);
    expect(r20.get('3,1')).toBe(15);
    expect(r20.has('3,0')).toBe(false);
    const swimmer = m.reachable(from, 20, { instanceId: 's', name: 'S', speeds: { walk: 30, swim: 30 } });
    expect(swimmer.get('3,0')).toBe(15);
    const withOccupied = m.reachable(from, 10, undefined, new Set(['3,2']));
    expect(withOccupied.has('3,2')).toBe(false);
    expect(withOccupied.has('3,1')).toBe(false);
  });

  it('handles Large creature footprints', () => {
    const m = model();
    const large: CombatantLite = { instanceId: 'g', name: 'Giant', size: 'Large' };
    expect(m.footprint({ x: 0, y: 3 }, 'Large')).toEqual([{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 4 }, { x: 1, y: 4 }]);
    expect(m.canOccupy({ x: 8, y: 6 }, large)).toBe(true);
    expect(m.canOccupy({ x: 9, y: 6 }, large)).toBe(false); // runs off the map
    expect(m.canOccupy({ x: 4, y: 4 }, { ...large })).toBe(true);
    expect(m.stepCostFeet({ x: 2, y: 4 }, { x: 3, y: 4 }, large)).toBe(5);
    // Anchored at x = 3 the footprint spans x 3 to 4, so stepping east would cross the wall at x = 5.
    expect(m.stepCostFeet({ x: 3, y: 4 }, { x: 4, y: 4 }, large)).toBeNull();
  });
});

describe('cover and sight', () => {
  it('gives total cover behind a solid wall and clears when the door is open', () => {
    const m = model();
    expect(m.cover({ x: 3, y: 5 }, { x: 7, y: 5 }).type).toBe('total');
    expect(m.lineOfSight({ x: 3, y: 5 }, { x: 7, y: 5 })).toBe(false);
    expect(m.lineOfSight({ x: 3, y: 3 }, { x: 8, y: 3 })).toBe(true);
  });

  it('gives object cover and honours ignore ids', () => {
    const m = model();
    const c = m.cover({ x: 0, y: 3 }, { x: 4, y: 3 });
    expect(c.type).not.toBe('none');
    expect(c.blockers).toContain('Palm tree');
    expect(m.cover({ x: 0, y: 3 }, { x: 4, y: 3 }, ['palm-1']).type).toBe('none');
    expect(m.cover({ x: 4, y: 3 }, { x: 4, y: 3 }).type).toBe('none');
  });

  it('ignores untrusted walls below the confidence threshold', () => {
    const doc = makeFixture();
    for (const w of doc.walls) w.provenance = { source: 'ddb-meta', confidence: 0.3 };
    const m = buildMapModel(doc);
    expect(m.walls).toHaveLength(0);
    expect(m.cover({ x: 3, y: 5 }, { x: 7, y: 5 }).type).toBe('none');
    expect(buildMapModel(doc, { minConfidence: 0.2 }).cover({ x: 3, y: 5 }, { x: 7, y: 5 }).type).toBe('total');
  });
});

describe('overrides', () => {
  it('applies DM corrections without changing the source document', () => {
    const doc = makeFixture();
    const overrides: MapOverride[] = [
      { op: 'set_terrain', cells: ['3,3'], terrain: 'water_shallow' },
      { op: 'set_kind_cover', kind: 'palm_tree', cover: 'three_quarters' },
      { op: 'rename_region', region: 'P1', name: 'Sandy Shore' },
    ];
    const m = buildMapModel(doc, { overrides });
    expect(m.terrainAt({ x: 3, y: 3 })).toBe('water_shallow');
    expect(m.objectsAt({ x: 2, y: 3 })[0].cover).toBe('three_quarters');
    expect(m.findRegion('P1')?.name).toBe('Sandy Shore');
    expect(buildMapModel(doc).terrainAt({ x: 3, y: 3 })).toBe('grass');
  });

  it('applies operations in order: kind cover reaches later additions, and a removed object stays removed', () => {
    const m = buildMapModel(makeFixture(), {
      overrides: [
        { op: 'set_kind_cover', kind: 'pillar', cover: 'total' },
        { op: 'add_object', cells: ['7,1'], kind: 'pillar' },
        { op: 'remove_object', objectId: 'palm-1' },
        { op: 'set_object_cover', objectId: 'palm-1', cover: 'total' },
      ],
    });
    expect(m.objectsAt({ x: 7, y: 1 })[0].cover).toBe('total');
    expect(m.objectsAt({ x: 2, y: 3 })).toEqual([]);
  });
});

describe('findPositions', () => {
  const sahuagin: CombatantLite = { instanceId: 'a', name: 'Sahuagin 1', faction: 'enemy', position: { x: 8, y: 6 }, speeds: { walk: 30 } };

  it('puts a creature at the water edge but still on the beach', () => {
    const m = model();
    const res = findPositions(m, { forCombatant: sahuagin, region: m.findRegion('P1'), terrain: ['sand'], nextToTerrain: water, limit: 3 });
    expect(res.count).toBe(10);
    // Every beach cell from x = 4 on is four squares away; ties go row-major.
    expect(res.results[0].cell).toBe(cellLabel({ x: 4, y: 2 }));
    expect(res.results[0].terrain).toBe('sand');
    expect(res.results[0].why.join(' ')).toContain('water touches it to the north');
    expect(res.filtersApplied).toContain('region P1');
  });

  it('explains what eliminated everything and suggests a fix', () => {
    const m = model();
    const res = findPositions(m, { forCombatant: sahuagin, region: m.findRegion('P2'), terrain: ['grass'], nextToTerrain: water });
    expect(res.count).toBe(0);
    expect(res.eliminatedBy).toBe('next to water');
    expect(res.hint).toMatch(/No grass cell in P2 touches water\. Closest: .* \(10 ft from water\)/);
    expect(res.stages?.at(-1)?.remaining).toBe(0);
  });

  it('searches near a cell, avoids terrain, and limits by reach', () => {
    const m = model();
    const near = findPositions(m, { near: { x: 1, y: 3 }, withinFt: 10, avoidTerrain: water, limit: 10, forCombatant: sahuagin });
    expect(near.results.every((r) => Math.abs(r.x - 1) <= 2 && Math.abs(r.y - 3) <= 2)).toBe(true);
    const reach = findPositions(m, { forCombatant: { ...sahuagin, speeds: { walk: 10 } }, reachableThisTurn: true, limit: 10, region: m.findRegion('P2') });
    expect(reach.results.every((r) => Math.max(Math.abs(r.x - 8), Math.abs(r.y - 6)) <= 2)).toBe(true);
  });

  it('finds cover and hidden positions against a foe', () => {
    const m = model();
    const grog: CombatantLite = { instanceId: 'g', name: 'Grog', isPlayer: true, position: { x: 3, y: 5 } };
    const cover = findPositions(m, { forCombatant: sahuagin, coverFrom: grog, minCover: 'total', region: m.findRegion('P2'), limit: 10 });
    expect(cover.results.length).toBeGreaterThan(0);
    expect(cover.results.every((r) => r.x >= 5 || r.x < 5)).toBe(true);
    const hidden = findPositions(m, { forCombatant: sahuagin, hiddenFrom: grog, region: m.findRegion('P2'), limit: 5 });
    expect(hidden.results.length).toBeGreaterThan(0);
    for (const r of hidden.results) expect(m.lineOfSight(grog.position!, { x: r.x, y: r.y })).toBe(false);
  });

  it('skips occupied cells, errors without terrain data, and refuses overview maps', () => {
    const m = model();
    const res = findPositions(m, { region: m.findRegion('P1'), terrain: ['sand'], nextToTerrain: water, occupied: new Set(['0,2', '1,2']), limit: 2 });
    expect(res.results.map((r) => r.cell)).toEqual(['C3', 'D3']);
    const bare = buildMapModel(makeFixture({ terrain: undefined }));
    expect(findPositions(bare, { terrain: ['sand'] }).error).toMatch(/Terrain data is not available/);
    const overview = buildMapModel(makeFixture({ kind: 'overview' }));
    expect(findPositions(overview, {}).error).toMatch(/overview map/);
  });

  it('is deterministic and row-major on ties', () => {
    const m = model();
    const a = findPositions(m, { region: m.findRegion('P1'), terrain: ['sand'], limit: 4 });
    const b = findPositions(m, { region: m.findRegion('P1'), terrain: ['sand'], limit: 4 });
    expect(a).toEqual(b);
    expect(a.results.map((r) => r.cell)).toEqual(['A3', 'B3', 'C3', 'D3']);
  });
});

describe('descriptions', () => {
  const foe: CombatantLite = { instanceId: 'f', name: 'Grog', isPlayer: true, position: { x: 7, y: 5 } };
  const subject: CombatantLite = { instanceId: 's', name: 'Sahuagin 2', faction: 'enemy', position: { x: 3, y: 3 }, speeds: { walk: 30 } };

  it('describes terrain, features, and cover around a creature', () => {
    const r = describeSurroundings(model(), subject, [foe, subject], 30);
    expect(r.subject).toBe('Sahuagin 2');
    expect(r.cell).toBe('D4');
    expect(r.region).toBe('P2 Grove');
    expect(r.standingOn).toBe('grass');
    expect((r.terrain as string[]).some((t) => t.startsWith('Sand starts 5 ft north'))).toBe(true);
    expect((r.features as string[]).some((f) => f.startsWith('Palm tree 5 ft west'))).toBe(true);
    expect(Array.isArray(r.coverNow)).toBe(true);
    expect((r.coverNow as Array<{ from: string }>)[0].from).toBe('Grog');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(2500);
  });

  it('omits terrain without a terrain layer and says so', () => {
    const bare = buildMapModel(makeFixture({ terrain: undefined }));
    const r = describeSurroundings(bare, subject, [foe]);
    expect(r.terrain).toBeUndefined();
    expect(String(r.dataQuality)).toContain('Terrain data is not available');
  });

  it('gives a small map overview with regions, features, and combatants', () => {
    const r = mapOverview(model(), [subject, foe]);
    expect(r.map).toBe('Map T.1: Test Shore');
    const regions = r.regions as Array<Record<string, unknown>>;
    expect(regions.map((x) => x.id)).toEqual(['P1', 'P2']);
    expect(String(regions[0].terrain)).toContain('shallow water');
    expect(regions[1].features).toEqual(['1 palm tree (half cover)']);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(4000);
    expect((r.combatants as unknown[]).length).toBe(2);
  });

  it('describes overview maps without tactical claims', () => {
    const r = mapOverview(buildMapModel(makeFixture({ kind: 'overview' })), []);
    expect(String(r.note)).toContain('Overview map');
  });
});

describe('labels', () => {
  it('round-trips cell labels', () => {
    expect(cellLabel({ x: 10, y: 19 })).toBe('K20');
    expect(parseCellLabel('K20')).toEqual({ x: 10, y: 19 });
    expect(parseCellLabel('3,4')).toEqual({ x: 3, y: 4 });
    expect(parseCellLabel('nonsense')).toBeNull();
  });
});

describe('review fixes', () => {
  it('does not fuzzy-match short region ids to their neighbours', () => {
    const m = model();
    expect(m.findRegion('P9')).toBeUndefined();
    expect(m.findRegion('!!!')).toBeUndefined();
    expect(m.findRegion('')).toBeUndefined();
  });

  it('keeps very long diagonal walls instead of dropping them', () => {
    const doc = makeFixture();
    doc.walls = [{ ...doc.walls[0], id: 'diag', a: { x: 0, y: 0 }, b: { x: 10, y: 8 }, kind: 'wall' }];
    const m = buildMapModel(doc);
    expect(m.stepBlocked({ x: 2, y: 5 }, { x: 5, y: 2 }).blocked).toBe(true);
    expect(m.cover({ x: 1, y: 4 }, { x: 6, y: 1 }).type).not.toBe('none');
  });

  it('never gives a creature cover from a large object it stands inside', () => {
    const doc = makeFixture();
    doc.objects = [{
      id: 'big', kind: 'boulder', label: 'Boulder', cells: ['1,4', '2,4', '3,4', '4,4'], cover: 'three_quarters',
      blocksMovement: false, difficultTerrain: false, blocksSight: true, provenance: { source: 'derived', confidence: 0.9 },
    }];
    const m = buildMapModel(doc);
    // Both stand inside the boulder, but the squares between them are boulder too, so that still covers.
    expect(m.cover({ x: 1, y: 4 }, { x: 4, y: 4 }).type).toBe('three_quarters');
    // Neighbours inside the same object have nothing between them: their own squares give no cover.
    expect(m.cover({ x: 1, y: 4 }, { x: 2, y: 4 }).type).toBe('none');
  });

  it('gives override objects unique ids even after a removal', () => {
    const doc = makeFixture();
    const m = buildMapModel(doc, {
      overrides: [
        { op: 'remove_object', objectId: 'palm-1' },
        { op: 'add_object', cells: ['1,3'], kind: 'crate' },
        { op: 'add_object', cells: ['2,3'], kind: 'crate' },
      ],
    });
    const ids = [...m.objectsAt({ x: 1, y: 3 }), ...m.objectsAt({ x: 2, y: 3 })].map((o) => o.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('says when the region and the search spot do not overlap', () => {
    const m = model();
    const res = findPositions(m, { region: m.findRegion('P1'), near: { x: 5, y: 7 }, withinFt: 5 });
    expect(res.count).toBe(0);
    expect(res.hint).toMatch(/do not overlap/);
  });
});

export type { MapDocument };
