import type { MapObject, MapDocument, RegionV2, WallSegment } from './types.ts';
import type { MapGridConfig, MapRegion, MapWallsData, WallEdge, ObstacleCell } from '../../types.ts';

/** Legacy region shape used by the existing UI and server helpers. */
export function regionToLegacy(r: RegionV2): MapRegion {
  return { id: r.id, name: r.name, type: r.extentMethod, description: r.provenance.note, cells: r.cells };
}

/** A legacy cell-edge wall (between two adjacent cells) as a free segment in grid units. */
export function legacyEdgeToSegment(edge: WallEdge): WallSegment {
  const [x1, y1] = edge.c1;
  const [x2, y2] = edge.c2;
  let a = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  let b = { x: a.x + 0.5, y: a.y + 0.5 };
  if (x2 === x1 + 1 && y2 === y1) { a = { x: x1 + 1, y: y1 }; b = { x: x1 + 1, y: y1 + 1 }; }
  else if (x1 === x2 + 1 && y2 === y1) { a = { x: x2 + 1, y: y2 }; b = { x: x2 + 1, y: y2 + 1 }; }
  else if (x2 === x1 && y2 === y1 + 1) { a = { x: x1, y: y1 + 1 }; b = { x: x1 + 1, y: y1 + 1 }; }
  else if (x2 === x1 && y1 === y2 + 1) { a = { x: x2, y: y2 + 1 }; b = { x: x2 + 1, y: y2 + 1 }; }
  const t = edge.type;
  const solid = t === 'full' || t === 'door_closed';
  return {
    id: edge.id, a, b,
    kind: t === 'door_closed' || t === 'door_open' ? 'door' : t === 'window' ? 'window' : t === 'full' ? 'wall' : 'low_wall',
    blocksMovement: t !== 'door_open',
    blocksSight: solid ? 'full' : 'none',
    cover: t === 'full' || t === 'door_closed' ? 'total' : t === 'three_quarters' ? 'three_quarters' : 'half',
    door: t === 'door_closed' ? { state: 'closed' } : t === 'door_open' ? { state: 'open' } : undefined,
    name: edge.name,
    provenance: { source: 'legacy-handcoded', confidence: 1, note: 'converted from a cell-edge wall' },
  };
}

export function legacyObstacleToObject(key: string, obs: ObstacleCell): MapObject {
  return {
    id: `legacy-${key}`, kind: obs.name?.toLowerCase().includes('statue') ? 'statue' : 'obstacle',
    label: obs.name ?? 'Obstacle', cells: [key],
    cover: obs.type === 'full' ? 'total' : obs.type,
    blocksMovement: obs.type !== 'half', difficultTerrain: false, blocksSight: obs.type === 'full',
    provenance: { source: 'legacy-handcoded', confidence: 1, note: 'converted from an obstacle cell' },
  };
}

/** Fill the fields the existing UI reads from a MapDocument, keyed to the variant for `url`. */
export function mapDocumentToGridConfig(doc: MapDocument, url: string): MapGridConfig {
  const cleaned = url.split('?')[0];
  const base = cleaned.split('/').pop() ?? cleaned;
  const v = doc.images.find((i) => i.url === cleaned || i.url.split('/').pop() === base) ?? doc.images[0];
  const walls: MapWallsData = { edges: [], segments: doc.walls };
  return {
    columns: doc.grid.columns, rows: doc.grid.rows,
    // A document with no image variants cannot place pixels; the UI falls back to its default grid.
    cellPitch: v?.cellPx ?? 0, offsetX: v?.originX ?? 0, offsetY: v?.originY ?? 0,
    imageWidth: v?.width, imageHeight: v?.height, confidence: v ? 1 : 0,
    regions: doc.regions.map(regionToLegacy),
    walls,
    mapId: doc.mapId, mapKind: doc.kind, terrain: doc.terrain, objects: doc.objects,
  };
}
