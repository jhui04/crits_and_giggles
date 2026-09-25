import type {
  Cell, CombatantLite, CoverGrade, CoverResult, CreatureSize, MapDocument, MapObject, MapOverride,
  RegionV2, TerrainClass, WallSegment,
} from './types.ts';
import { cellCenter, chebyshev, levenshtein, NEIGHBOURS_8, segmentsIntersect, sideOf } from './geometry.ts';
import type { Point2D } from './geometry.ts';
import { cellKey, parseCellKey } from './labels.ts';
import { TERRAIN_CODES, TERRAIN_RULES } from './terrainRules.ts';
import { OBJECT_RULES } from './objectRules.ts';

export interface StepBlock {
  blocked: boolean;
  by?: WallSegment | MapObject;
}

export interface MapModel {
  doc: MapDocument;
  columns: number;
  rows: number;
  feetPerCell: number;
  isTactical: boolean;
  /** Walls the rules engine trusts (confidence above the threshold, not invisible). */
  walls: WallSegment[];
  regions: RegionV2[];
  inBounds(c: Cell): boolean;
  terrainAt(c: Cell): TerrainClass;
  hasTerrain(): boolean;
  terrainConfidenceAt(c: Cell): number;
  regionAt(c: Cell): RegionV2 | undefined;
  findRegion(idOrName: string): RegionV2 | undefined;
  objectsAt(c: Cell): MapObject[];
  isWalkable(c: Cell, mover?: CombatantLite): boolean;
  canOccupy(anchor: Cell, mover?: CombatantLite): boolean;
  stepBlocked(from: Cell, to: Cell): StepBlock;
  stepCostFeet(from: Cell, to: Cell, mover?: CombatantLite): number | null;
  distanceToTerrain(c: Cell, classes: TerrainClass[]): number;
  touchesTerrain(c: Cell, classes: TerrainClass[]): boolean;
  cover(attacker: Cell, target: Cell, ignoreIds?: string[]): CoverResult;
  lineOfSight(a: Cell, b: Cell): boolean;
  reachable(from: Cell, budgetFeet: number, mover?: CombatantLite, occupied?: Set<string>): Map<string, number>;
  footprint(c: Cell, size?: CreatureSize): Cell[];
}

const SIZE_CELLS: Record<CreatureSize, number> = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };

export function sizeInCells(size?: CreatureSize): number {
  return size ? SIZE_CELLS[size] ?? 1 : 1;
}

const COVER_RANK: Record<CoverGrade, number> = { none: 0, half: 1, three_quarters: 2, total: 3 };

export function coverAtLeast(actual: CoverGrade, wanted: CoverGrade): boolean {
  return COVER_RANK[actual] >= COVER_RANK[wanted];
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "p01" -> "p1" so zero-padded book keys still match. */
function normalizeKey(s: string): string {
  return normalizeName(s).replace(/^([a-z]+)0+(\d)/, '$1$2');
}

export function applyOverrides(doc: MapDocument, overrides: MapOverride[]): MapDocument {
  if (!overrides.length) return doc;
  const out: MapDocument = JSON.parse(JSON.stringify(doc));
  const prov = { source: 'dm-override' as const, confidence: 1, note: 'set by the DM' };
  let nextId = 1;
  const kindCover = new Map<string, CoverGrade>(); // set_kind_cover also covers objects added afterwards
  for (const o of overrides) {
    if (o.op === 'set_terrain' && out.terrain) {
      let code = Object.entries(out.terrain.legend).find(([, cls]) => cls === o.terrain)?.[0];
      if (!code) {
        // The class is new to this map: add it to the legend under its standard code.
        code = TERRAIN_CODES[o.terrain];
        out.terrain.legend[code] = o.terrain;
      }
      const rows = out.terrain.rows.map((r) => r.split(''));
      for (const k of o.cells) {
        const c = parseCellKey(k);
        if (rows[c.y] && rows[c.y][c.x] !== undefined) rows[c.y][c.x] = code;
        if (out.terrain.confidence) delete out.terrain.confidence[k];
        if (out.terrain.mixed) delete out.terrain.mixed[k];
      }
      out.terrain.rows = rows.map((r) => r.join(''));
    } else if (o.op === 'add_object') {
      const rule = OBJECT_RULES[o.kind] ?? OBJECT_RULES.crate;
      out.objects.push({
        id: `obj-override-${nextId++}`, kind: o.kind, label: o.label ?? o.kind.replace(/_/g, ' '),
        cells: o.cells, cover: kindCover.get(o.kind) ?? rule.cover, blocksMovement: rule.blocksMovement,
        difficultTerrain: rule.difficultTerrain, blocksSight: rule.blocksSight, regionId: o.regionId, provenance: prov,
      });
    } else if (o.op === 'remove_object') {
      out.objects = out.objects.filter((x) => x.id !== o.objectId);
    } else if (o.op === 'set_object_cover') {
      const obj = out.objects.find((x) => x.id === o.objectId);
      if (obj) {
        obj.cover = o.cover;
        obj.provenance = prov;
      }
    } else if (o.op === 'set_kind_cover') {
      kindCover.set(o.kind, o.cover);
      for (const obj of out.objects) if (obj.kind === o.kind) obj.cover = o.cover;
    } else if (o.op === 'rename_region') {
      const wanted = normalizeKey(o.region);
      const r = out.regions.find((x) => normalizeKey(x.id) === wanted || normalizeName(x.name) === normalizeName(o.region));
      if (r) r.name = o.name;
    }
  }
  return out;
}

export function buildMapModel(input: MapDocument, opts: { minConfidence?: number; overrides?: MapOverride[] } = {}): MapModel {
  const minConf = opts.minConfidence ?? 0.5;
  const doc = applyOverrides(input, opts.overrides ?? []);
  const columns = doc.grid.columns;
  const rows = doc.grid.rows;
  const feet = doc.grid.feetPerCell;
  const tactical = doc.kind === 'tactical';

  const trusted = (p: { confidence: number }) => p.confidence >= minConf;
  const walls = doc.walls.filter((w) => w.kind !== 'invisible' && trusted(w.provenance));
  const objects = doc.objects.filter((o) => trusted(o.provenance));

  // ---- indexes
  const wallBuckets = new Map<string, WallSegment[]>();
  const longWalls: WallSegment[] = [];
  for (const w of walls) {
    const x0 = Math.floor(Math.min(w.a.x, w.b.x));
    const x1 = Math.floor(Math.max(w.a.x, w.b.x));
    const y0 = Math.floor(Math.min(w.a.y, w.b.y));
    const y1 = Math.floor(Math.max(w.a.y, w.b.y));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) {
      longWalls.push(w); // too big to bucket: checked on every query instead
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = wallBuckets.get(k);
        if (list) list.push(w);
        else wallBuckets.set(k, [w]);
      }
    }
  }
  const objectsByCell = new Map<string, MapObject[]>();
  for (const o of objects) {
    for (const k of o.cells) {
      const list = objectsByCell.get(k);
      if (list) list.push(o);
      else objectsByCell.set(k, [o]);
    }
  }
  const regionByCell = new Map<string, RegionV2>();
  for (const r of doc.regions) for (const k of r.cells) if (!regionByCell.has(k)) regionByCell.set(k, r);

  const terrainRows = doc.terrain?.rows;
  const legend = doc.terrain?.legend ?? {};
  const inBounds = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < columns && c.y < rows;

  function wallsBetween(a: Cell, b: Cell): WallSegment[] {
    const seen = new Set<WallSegment>(longWalls);
    for (let x = Math.min(a.x, b.x) - 1; x <= Math.max(a.x, b.x) + 1; x++) {
      for (let y = Math.min(a.y, b.y) - 1; y <= Math.max(a.y, b.y) + 1; y++) {
        const list = wallBuckets.get(`${x},${y}`);
        if (list) for (const w of list) seen.add(w);
      }
    }
    return [...seen];
  }

  const isOpenDoor = (w: WallSegment) => w.door?.state === 'open';

  function terrainAt(c: Cell): TerrainClass {
    if (!terrainRows || !inBounds(c)) return 'unknown';
    return legend[terrainRows[c.y]?.[c.x]] ?? 'unknown';
  }

  function footprint(c: Cell, size?: CreatureSize): Cell[] {
    const n = sizeInCells(size);
    const out: Cell[] = [];
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: c.x + dx, y: c.y + dy });
    return out;
  }

  function isWalkable(c: Cell, mover?: CombatantLite): boolean {
    if (!inBounds(c)) return false;
    const t = terrainAt(c);
    const rule = TERRAIN_RULES[t];
    if (!rule.walkable && !(t === 'cliff' && (mover?.speeds?.climb ?? 0) > 0) && !((mover?.speeds?.fly ?? 0) > 0 && t !== 'void')) {
      return false;
    }
    for (const o of objectsByCell.get(cellKey(c)) ?? []) {
      if (o.blocksMovement && !((mover?.speeds?.fly ?? 0) > 0)) return false;
    }
    return true;
  }

  function canOccupy(anchor: Cell, mover?: CombatantLite): boolean {
    return footprint(anchor, mover?.size).every((c) => isWalkable(c, mover));
  }

  function stepBlockedSingle(from: Cell, to: Cell): StepBlock {
    const a = cellCenter(from);
    const b = cellCenter(to);
    for (const w of wallsBetween(from, to)) {
      if (!w.blocksMovement || isOpenDoor(w)) continue;
      if (!segmentsIntersect(a, b, w.a, w.b)) continue;
      if (w.oneWay) {
        // A one-way wall only stops creatures approaching from its marked side.
        const s = sideOf(w.a, w.b, a);
        const blockedFrom = w.oneWay === 'left' ? s < 0 : s > 0;
        if (!blockedFrom) continue;
      }
      return { blocked: true, by: w };
    }
    return { blocked: false };
  }

  function stepBlocked(from: Cell, to: Cell): StepBlock {
    return stepBlockedSingle(from, to);
  }

  function stepCostFeet(from: Cell, to: Cell, mover?: CombatantLite): number | null {
    if (chebyshev(from, to) !== 1) return null;
    if (!canOccupy(to, mover)) return null;
    // A larger creature moves as a block: every footprint cell must make the same step.
    const fpFrom = footprint(from, mover?.size);
    for (const c of fpFrom) {
      if (stepBlockedSingle(c, { x: c.x + (to.x - from.x), y: c.y + (to.y - from.y) }).blocked) return null;
    }
    const flying = (mover?.speeds?.fly ?? 0) > 0;
    const swims = (mover?.speeds?.swim ?? 0) > 0;
    let mult = 1;
    for (const c of footprint(to, mover?.size)) {
      const t = terrainAt(c);
      let m = TERRAIN_RULES[t].cost;
      if (t === 'water_deep' && swims) m = 1;
      if (t === 'water_shallow' && swims) m = 1;
      if (flying) m = 1;
      if (!Number.isFinite(m)) m = 1; // reached only when climbing or flying
      for (const o of objectsByCell.get(cellKey(c)) ?? []) if (o.difficultTerrain && !flying) m = Math.max(m, 2);
      mult = Math.max(mult, m);
    }
    return feet * mult;
  }

  const terrainDistCache = new Map<string, Float32Array>();
  function distanceField(classes: TerrainClass[]): Float32Array {
    const key = [...classes].sort().join('|');
    const cached = terrainDistCache.get(key);
    if (cached) return cached;
    const dist = new Float32Array(columns * rows).fill(Infinity);
    const queue: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        if (classes.includes(terrainAt({ x, y }))) {
          dist[y * columns + x] = 0;
          queue.push(y * columns + x);
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % columns;
      const y = Math.floor(i / columns);
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const j = ny * columns + nx;
        if (dist[j] === Infinity) {
          dist[j] = dist[i] + 1;
          queue.push(j);
        }
      }
    }
    terrainDistCache.set(key, dist);
    return dist;
  }

  function distanceToTerrain(c: Cell, classes: TerrainClass[]): number {
    if (!inBounds(c)) return Infinity;
    return distanceField(classes)[c.y * columns + c.x];
  }

  function touchesTerrain(c: Cell, classes: TerrainClass[]): boolean {
    return NEIGHBOURS_8.some(([dx, dy]) => {
      const n = { x: c.x + dx, y: c.y + dy };
      return inBounds(n) && classes.includes(terrainAt(n));
    });
  }

  // ---- cover
  function cornersOf(c: Cell): Point2D[] {
    return [
      { x: c.x + 0.1, y: c.y + 0.1 }, { x: c.x + 0.9, y: c.y + 0.1 },
      { x: c.x + 0.1, y: c.y + 0.9 }, { x: c.x + 0.9, y: c.y + 0.9 },
    ];
  }

  function rayHitsCell(p: Point2D, q: Point2D, c: Cell): boolean {
    const d1a = { x: c.x + 0.05, y: c.y + 0.05 };
    const d1b = { x: c.x + 0.95, y: c.y + 0.95 };
    const d2a = { x: c.x + 0.05, y: c.y + 0.95 };
    const d2b = { x: c.x + 0.95, y: c.y + 0.05 };
    return segmentsIntersect(p, q, d1a, d1b) || segmentsIntersect(p, q, d2a, d2b);
  }

  interface RayResult {
    grade: CoverGrade;
    name?: string;
  }

  function coverBonus(g: CoverGrade): number {
    return g === 'half' ? 2 : g === 'three_quarters' ? 5 : 0;
  }

  function cover(attacker: Cell, target: Cell, ignoreIds: string[] = []): CoverResult {
    const none: CoverResult = { type: 'none', acBonus: 0, dexSaveBonus: 0, description: 'No cover', blockers: [] };
    if (attacker.x === target.x && attacker.y === target.y) return none;
    const segs = wallsBetween(attacker, target).filter((w) => !isOpenDoor(w) && !ignoreIds.includes(w.id));
    const objs: MapObject[] = [];
    const seenObj = new Set<string>();
    for (let x = Math.min(attacker.x, target.x); x <= Math.max(attacker.x, target.x); x++) {
      for (let y = Math.min(attacker.y, target.y); y <= Math.max(attacker.y, target.y); y++) {
        if ((x === attacker.x && y === attacker.y) || (x === target.x && y === target.y)) continue;
        for (const o of objectsByCell.get(`${x},${y}`) ?? []) {
          if (o.cover === 'none' || ignoreIds.includes(o.id) || seenObj.has(o.id)) continue;
          objs.push(o);
          seenObj.add(o.id);
        }
      }
    }
    if (!segs.length && !objs.length) return none;

    function testRay(p: Point2D, q: Point2D): RayResult {
      let best: RayResult = { grade: 'none' };
      const consider = (grade: CoverGrade, name: string) => {
        if (COVER_RANK[grade] > COVER_RANK[best.grade]) best = { grade, name };
      };
      for (const w of segs) {
        if (segmentsIntersect(p, q, w.a, w.b)) {
          consider(w.cover, w.name ?? w.kind.replace(/_/g, ' '));
          if (best.grade === 'total') return best;
        }
      }
      for (const o of objs) {
        for (const k of o.cells) {
          const c = parseCellKey(k);
          // The attacker's and target's own squares never give cover, even inside a larger object.
          if ((c.x === attacker.x && c.y === attacker.y) || (c.x === target.x && c.y === target.y)) continue;
          if (rayHitsCell(p, q, c)) {
            consider(o.cover, o.label);
            if (best.grade === 'total') return best;
            break;
          }
        }
      }
      return best;
    }

    let bestBlocked = Infinity;
    let bestSolid = 0;
    let bestThree = 0;
    let bestNames: string[] = [];
    const tCorners = cornersOf(target);
    for (const a of cornersOf(attacker)) {
      let blocked = 0;
      let solid = 0;
      let three = 0;
      const names = new Set<string>();
      for (const t of tCorners) {
        const r = testRay(a, t);
        if (r.grade !== 'none') {
          blocked++;
          if (r.grade === 'total') solid++;
          else if (r.grade === 'three_quarters') three++;
          if (r.name) names.add(r.name);
        }
      }
      if (blocked < bestBlocked) {
        bestBlocked = blocked;
        bestSolid = solid;
        bestThree = three;
        bestNames = [...names];
      }
    }
    const because = bestNames.length ? ` behind ${bestNames.join(', ')}` : '';
    if (bestSolid === 4) {
      return { type: 'total', acBonus: 0, dexSaveBonus: 0, description: `Total cover${because}`, blockers: bestNames };
    }
    if (bestSolid >= 3 || (bestBlocked >= 3 && (bestThree > 0 || bestSolid > 0)) || bestThree >= 2) {
      return { type: 'three_quarters', acBonus: 5, dexSaveBonus: 5, description: `Three-quarters cover${because}`, blockers: bestNames };
    }
    if (bestBlocked >= 1) {
      return { type: 'half', acBonus: coverBonus('half'), dexSaveBonus: 2, description: `Half cover${because}`, blockers: bestNames };
    }
    return none;
  }

  function lineOfSight(a: Cell, b: Cell): boolean {
    if (a.x === b.x && a.y === b.y) return true;
    const p = cellCenter(a);
    const q = cellCenter(b);
    let limited = 0;
    for (const w of wallsBetween(a, b)) {
      if (isOpenDoor(w) || w.blocksSight === 'none') continue;
      if (!segmentsIntersect(p, q, w.a, w.b)) continue;
      if (w.blocksSight === 'full') return false;
      limited++;
      if (limited >= 2) return false;
    }
    // Sample along the line for solid objects and building terrain between the two cells.
    const steps = Math.max(2, Math.ceil(chebyshev(a, b) * 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const c = { x: Math.floor(p.x + (q.x - p.x) * t), y: Math.floor(p.y + (q.y - p.y) * t) };
      if ((c.x === a.x && c.y === a.y) || (c.x === b.x && c.y === b.y)) continue;
      if (terrainAt(c) === 'building') return false;
      for (const o of objectsByCell.get(cellKey(c)) ?? []) if (o.blocksSight) return false;
    }
    return true;
  }

  function reachable(from: Cell, budgetFeet: number, mover?: CombatantLite, occupied?: Set<string>): Map<string, number> {
    const best = new Map<string, number>([[cellKey(from), 0]]);
    const heap: Array<[number, Cell]> = [[0, from]];
    const pop = () => {
      // Binary heap keyed on cost.
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    const push = (item: [number, Cell]) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    while (heap.length) {
      const [cost, c] = pop();
      if (cost > (best.get(cellKey(c)) ?? Infinity)) continue;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const n = { x: c.x + dx, y: c.y + dy };
        const step = stepCostFeet(c, n, mover);
        if (step === null) continue;
        const total = cost + step;
        if (total > budgetFeet) continue;
        const k = cellKey(n);
        if (total < (best.get(k) ?? Infinity)) {
          best.set(k, total);
          push([total, n]);
        }
      }
    }
    if (occupied) for (const k of occupied) if (k !== cellKey(from)) best.delete(k);
    return best;
  }

  // ---- regions
  function regionAt(c: Cell): RegionV2 | undefined {
    return regionByCell.get(cellKey(c));
  }

  function findRegion(idOrName: string): RegionV2 | undefined {
    if (!idOrName) return undefined;
    const key = normalizeKey(idOrName);
    const name = normalizeName(idOrName);
    const byId = doc.regions.find((r) => normalizeKey(r.id) === key);
    if (byId) return byId;
    const byName = doc.regions.find((r) => normalizeName(r.name) === name);
    if (byName) return byName;
    if (!name) return undefined;
    const contains = doc.regions.filter((r) => normalizeName(r.name).includes(name) || (name.length > 3 && name.includes(normalizeName(r.name))));
    if (contains.length === 1) return contains[0];
    let best: RegionV2 | undefined;
    let bestD = 3;
    for (const r of doc.regions) {
      const d = name.length >= 5 ? levenshtein(name, normalizeName(r.name)) : Infinity;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  return {
    doc, columns, rows, feetPerCell: feet, isTactical: tactical, walls, regions: doc.regions,
    inBounds, terrainAt,
    hasTerrain: () => !!terrainRows && terrainRows.some((r) => /[^?]/.test(r)),
    terrainConfidenceAt: (c) => doc.terrain?.confidence?.[cellKey(c)] ?? (terrainRows ? 1 : 0),
    regionAt, findRegion,
    objectsAt: (c) => objectsByCell.get(cellKey(c)) ?? [],
    isWalkable, canOccupy, stepBlocked, stepCostFeet, distanceToTerrain, touchesTerrain, cover, lineOfSight,
    reachable, footprint,
  };
}
