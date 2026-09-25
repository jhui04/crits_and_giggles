import type { MapDocument, WallSegment } from './types.ts';

const prov = { source: 'derived' as const, confidence: 0.9 };

function wall(id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<WallSegment> = {}): WallSegment {
  return {
    id, a: { x: ax, y: ay }, b: { x: bx, y: by }, kind: 'wall', blocksMovement: true, blocksSight: 'full',
    cover: 'total', provenance: prov, ...extra,
  };
}

/**
 * A 10 x 8 test map: deep water on row 0, shallow water on row 1, sand on row 2, grass below.
 * A vertical wall at x = 5 runs from y = 4 to y = 8 with a closed door on its last cell,
 * and a palm tree stands at (2, 3). Region P1 "South Shore" covers rows 1 and 2; P2 "Grove" rows 3 to 7.
 */
export function makeFixture(overrides: Partial<MapDocument> = {}): MapDocument {
  const rows = ['WWWWWWWWWW', 'wwwwwwwwww', 'ssssssssss', 'gggggggggg', 'gggggggggg', 'gggggggggg', 'gggggggggg', 'gggggggggg'];
  const cells = (y0: number, y1: number) => {
    const out: string[] = [];
    for (let y = y0; y <= y1; y++) for (let x = 0; x < 10; x++) out.push(`${x},${y}`);
    return out;
  };
  return {
    schemaVersion: 1, mapId: 'test-map', number: 'T.1', title: 'Map T.1: Test Shore', kind: 'tactical',
    source: { book: 'EGtW', adventure: 'ToR' },
    grid: { type: 'square', columns: 10, rows: 8, feetPerCell: 5, units: 'feet', printedScale: '1 square = 5 feet' },
    images: [],
    regions: [
      { id: 'P1', name: 'South Shore', cells: cells(1, 2), labelCells: [{ x: 4, y: 2 }], extentMethod: 'polygon', provenance: prov },
      { id: 'P2', name: 'Grove', cells: cells(3, 7), labelCells: [{ x: 4, y: 5 }], extentMethod: 'polygon', provenance: prov },
    ],
    walls: [
      wall('w-main', 5, 4, 5, 7, { name: 'Grove wall' }),
      wall('w-door', 5, 7, 5, 8, { kind: 'door', door: { state: 'closed' }, name: 'Grove door' }),
    ],
    objects: [
      {
        id: 'palm-1', kind: 'palm_tree', label: 'Palm tree', cells: ['2,3'], cover: 'half', blocksMovement: false,
        difficultTerrain: false, blocksSight: false, provenance: prov,
      },
    ],
    terrain: {
      legend: { W: 'water_deep', w: 'water_shallow', s: 'sand', g: 'grass', '#': 'void', B: 'building' },
      rows,
      provenance: prov,
    },
    spawns: [], audit: [], generatedAt: '2026-01-01T00:00:00Z', sourceShas: {},
    ...overrides,
  };
}
