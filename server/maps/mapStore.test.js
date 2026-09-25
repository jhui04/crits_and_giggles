import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeFixture } from '../../src/shared/spatial/fixture.ts';
import { buildMapModel } from '../../src/shared/spatial/index.ts';
import { getMapDocumentById, getMapDocumentByUrl, getMapModel, getGridDataFromDocument } from './mapStore.js';

let dir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-'));
  const doc = makeFixture({
    images: [
      { variant: 'dm', url: '/maps/t.png', width: 400, height: 300, cellPx: 37.5, originX: 27.5, originY: 34, provenance: { source: '5etools', confidence: 1 } },
    ],
  });
  fs.writeFileSync(path.join(dir, 'test-map.json'), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
    schemaVersion: 1,
    maps: {
      'test-map': { title: doc.title, file: 'test-map.json', kind: 'tactical' },
      evil: { title: 'x', file: '../secret.json', kind: 'tactical' },
    },
    byImage: { '/maps/t.png': 'test-map' },
  }));
  process.env.MAPS_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.MAPS_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('mapStore', () => {
  it('imports the shared spatial engine from the server', () => {
    const model = buildMapModel(makeFixture());
    expect(model.terrainAt({ x: 0, y: 0 })).toBe('water_deep');
  });

  it('finds documents by image URL with query strings and by id', () => {
    expect(getMapDocumentByUrl('/maps/t.png?v=3')?.mapId).toBe('test-map');
    expect(getMapDocumentByUrl('t.png')?.mapId).toBe('test-map');
    expect(getMapDocumentByUrl('/uploads/x/other.png')).toBeNull();
    expect(getMapDocumentById('test-map')?.title).toContain('Test Shore');
    expect(getMapDocumentById('nope')).toBeNull();
  });

  it('refuses index entries that point outside the maps directory', () => {
    expect(getMapDocumentById('evil')).toBeNull();
  });

  it('caches models per document and override set', () => {
    const doc = getMapDocumentById('test-map');
    const a = getMapModel(doc);
    expect(getMapModel(doc)).toBe(a);
    const b = getMapModel(doc, [{ op: 'set_terrain', cells: ['1,3'], terrain: 'mud' }]);
    expect(b).not.toBe(a);
    expect(b.terrainAt({ x: 1, y: 3 })).toBe('mud');
    expect(a.terrainAt({ x: 1, y: 3 })).toBe('grass');
  });

  it('returns legacy-shaped grid data', () => {
    const grid = getGridDataFromDocument(getMapDocumentById('test-map'), '/maps/t.png');
    expect(grid).toMatchObject({ columns: 10, rows: 8, cellPitch: 37.5, offsetX: 27.5, offsetY: 34, mapId: 'test-map' });
    expect(grid.regions[0].id).toBe('P1');
    expect(getGridDataFromDocument(null, 'x')).toBeNull();
  });
});
