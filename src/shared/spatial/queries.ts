import type { Cell, CombatantLite, CoverGrade, RegionV2, TerrainClass } from './types.ts';
import type { MapModel } from './mapModel.ts';
import { coverAtLeast, sizeInCells } from './mapModel.ts';
import { chebyshev, direction, NEIGHBOURS_8 } from './geometry.ts';
import { cellKey, cellLabel, parseCellKey } from './labels.ts';
import { terrainLabel } from './terrainRules.ts';

export type RankBy = 'nearest_to_combatant' | 'nearest_to_near' | 'farthest_from_enemies' | 'most_cover';

export interface PositionQuery {
  forCombatant?: CombatantLite;
  region?: RegionV2;
  near?: Cell;
  withinFt?: number;
  terrain?: TerrainClass[];
  avoidTerrain?: TerrainClass[];
  nextToTerrain?: TerrainClass[];
  nearTerrain?: TerrainClass[];
  maxFtFromTerrain?: number;
  coverFrom?: CombatantLite;
  minCover?: CoverGrade;
  hiddenFrom?: CombatantLite;
  reachableThisTurn?: boolean;
  rankBy?: RankBy;
  limit?: number;
  /** Cells held by other creatures; the mover's own cells are ignored. */
  occupied?: Set<string>;
  /** Opposing creatures, used by farthest_from_enemies. */
  enemies?: CombatantLite[];
  /** Name of the `near` anchor for messages, e.g. "Grog" or "K20". */
  nearName?: string;
}

export interface PositionResult {
  cell: string;
  x: number;
  y: number;
  region?: string;
  terrain?: string;
  why: string[];
  moveFt?: number;
  cover?: CoverGrade;
}

export interface Stage {
  filter: string;
  remaining: number;
}

export interface PositionSearch {
  count: number;
  results: PositionResult[];
  filtersApplied: string[];
  stages?: Stage[];
  eliminatedBy?: string;
  hint?: string;
  error?: string;
}

const DIR_WORD: Record<string, string> = {
  North: 'north', 'North-East': 'north-east', East: 'east', 'South-East': 'south-east',
  South: 'south', 'South-West': 'south-west', West: 'west', 'North-West': 'north-west',
};

export function directionWord(from: Cell, to: Cell): string {
  return DIR_WORD[direction(from, to)] ?? 'here';
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function terrainWords(classes: TerrainClass[]): string {
  const water = classes.includes('water_deep') && classes.includes('water_shallow');
  if (water) return classes.length === 2 ? 'water' : joinWords([...classes.filter((c) => !c.startsWith('water')).map(terrainLabel), 'water']);
  return joinWords(classes.map(terrainLabel));
}

function regionLabel(r?: RegionV2): string | undefined {
  return r ? `${r.id} ${r.name}` : undefined;
}

export function speedBudget(c?: CombatantLite): number {
  const s = c?.speeds;
  return s?.walk ?? s?.swim ?? s?.fly ?? 30;
}

export function findPositions(model: MapModel, q: PositionQuery): PositionSearch {
  const filters: string[] = [];
  const stages: Stage[] = [];
  if (!model.isTactical) {
    return { count: 0, results: [], filtersApplied: [], error: 'This is an overview map, so tactical placement is not supported.' };
  }
  const needsTerrain = !!(q.terrain?.length || q.avoidTerrain?.length || q.nextToTerrain?.length || q.nearTerrain?.length);
  if (needsTerrain && !model.hasTerrain()) {
    return {
      count: 0, results: [], filtersApplied: [],
      error: 'Terrain data is not available for this map yet. Try a region-only or near-only search.',
    };
  }
  const mover = q.forCombatant;
  const own = new Set<string>();
  if (mover?.position) for (const c of model.footprint(mover.position, mover.size)) own.add(cellKey(c));
  const blocked = new Set([...(q.occupied ?? [])].filter((k) => !own.has(k)));

  // 1. Generate
  let candidates: Cell[] = [];
  const all = () => {
    const out: Cell[] = [];
    for (let y = 0; y < model.rows; y++) for (let x = 0; x < model.columns; x++) out.push({ x, y });
    return out;
  };
  if (q.region) {
    candidates = q.region.cells.map(parseCellKey);
    filters.push(`region ${q.region.id}`);
  }
  if (q.near) {
    const cells = Math.max(1, Math.round((q.withinFt ?? 30) / model.feetPerCell));
    const base = q.region ? candidates : all();
    candidates = base.filter((c) => chebyshev(c, q.near!) <= cells);
    filters.push(`within ${q.withinFt ?? 30} ft of ${q.nearName ?? cellLabel(q.near)}`);
  }
  if (!q.region && !q.near) candidates = all();
  stages.push({ filter: filters.join(', ') || 'whole map', remaining: candidates.length });

  const step = (name: string, keep: (c: Cell) => boolean) => {
    candidates = candidates.filter(keep);
    filters.push(name);
    stages.push({ filter: name, remaining: candidates.length });
  };

  // 2. Filter, cheap first
  step('inside the map', (c) => model.inBounds(c));
  step('standing room', (c) => model.canOccupy(c, mover) && model.footprint(c, mover?.size).every((f) => !blocked.has(cellKey(f))));
  if (q.terrain?.length) step(`terrain ${terrainWords(q.terrain)}`, (c) => q.terrain!.includes(model.terrainAt(c)));
  if (q.avoidTerrain?.length) step(`not ${terrainWords(q.avoidTerrain)}`, (c) => !q.avoidTerrain!.includes(model.terrainAt(c)));
  if (q.nextToTerrain?.length) step(`next to ${terrainWords(q.nextToTerrain)}`, (c) => model.touchesTerrain(c, q.nextToTerrain!));
  if (q.nearTerrain?.length) {
    const maxCells = (q.maxFtFromTerrain ?? 0) / model.feetPerCell;
    step(`within ${q.maxFtFromTerrain ?? 0} ft of ${terrainWords(q.nearTerrain)}`, (c) => model.distanceToTerrain(c, q.nearTerrain!) <= maxCells);
  }
  let reach: Map<string, number> | undefined;
  if (q.reachableThisTurn && mover?.position) {
    reach = model.reachable(mover.position, speedBudget(mover), mover, blocked);
    step('reachable this turn', (c) => reach!.has(cellKey(c)));
  }
  if (q.hiddenFrom?.position) {
    const from = q.hiddenFrom.position;
    step(`hidden from ${q.hiddenFrom.name}`, (c) => !model.lineOfSight(from, c));
  }
  const minCover = q.minCover ?? 'half';
  const coverCache = new Map<string, CoverGrade>();
  if (q.coverFrom?.position) {
    const from = q.coverFrom.position;
    step(`${minCover.replace('_', '-')} cover from ${q.coverFrom.name}`, (c) => {
      const g = model.cover(from, c).type;
      coverCache.set(cellKey(c), g);
      return coverAtLeast(g, minCover);
    });
  }

  if (candidates.length === 0) {
    const elim = stages.find((s, i) => i > 0 && s.remaining === 0);
    if (stages[0].remaining === 0) {
      return {
        count: 0, results: [], filtersApplied: filters, stages, eliminatedBy: stages[0].filter,
        hint: q.region && q.near ? `${q.region.id} and the area around ${q.nearName ?? 'that spot'} do not overlap. Search one or the other.` : 'The search area is empty.',
      };
    }
    return {
      count: 0, results: [], filtersApplied: filters, stages, eliminatedBy: elim?.filter,
      hint: buildHint(model, q, stages),
    };
  }

  // 3. Score
  const rank: RankBy = q.rankBy ?? (mover?.position ? 'nearest_to_combatant' : q.near ? 'nearest_to_near' : 'nearest_to_combatant');
  const anchor = rank === 'nearest_to_near' ? q.near : mover?.position ?? q.near;
  const enemyCells = (q.enemies ?? []).map((e) => e.position).filter((p): p is Cell => !!p);
  const coverOf = (c: Cell): number => {
    const from = q.coverFrom?.position ?? enemyCells[0];
    if (!from) return 0;
    const g = coverCache.get(cellKey(c)) ?? model.cover(from, c).type;
    coverCache.set(cellKey(c), g);
    return ['none', 'half', 'three_quarters', 'total'].indexOf(g);
  };
  const score = (c: Cell): number => {
    if (rank === 'farthest_from_enemies') {
      return -Math.min(...enemyCells.map((e) => chebyshev(e, c)), 99);
    }
    if (rank === 'most_cover') return -coverOf(c) * 1000 + (anchor ? chebyshev(anchor, c) : 0);
    return anchor ? chebyshev(anchor, c) : 0;
  };
  const sorted = [...candidates].sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
  const limit = Math.min(Math.max(q.limit ?? 3, 1), 10);
  const results = sorted.slice(0, limit).map((c) => describeCandidate(model, q, c, reach, coverCache));
  return { count: candidates.length, results, filtersApplied: filters };
}

function describeCandidate(
  model: MapModel, q: PositionQuery, c: Cell, reach: Map<string, number> | undefined, coverCache: Map<string, CoverGrade>,
): PositionResult {
  const why: string[] = [];
  const t = model.terrainAt(c);
  if (model.hasTerrain()) why.push(terrainLabel(t));
  if (q.nextToTerrain?.length) {
    const dirs = new Set<string>();
    for (const [dx, dy] of NEIGHBOURS_8) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (model.inBounds(n) && q.nextToTerrain.includes(model.terrainAt(n))) dirs.add(directionWord(c, n));
    }
    why.push(`${terrainWords(q.nextToTerrain)} touches it to the ${joinWords([...dirs])}`);
  }
  if (q.coverFrom?.position) {
    const g = coverCache.get(cellKey(c)) ?? model.cover(q.coverFrom.position, c).type;
    const because = model.cover(q.coverFrom.position, c).blockers.join(', ');
    why.push(`${g.replace('_', '-')} cover from ${q.coverFrom.name}${because ? ` (${because})` : ''}`);
  }
  if (q.hiddenFrom?.position) why.push(`no line of sight from ${q.hiddenFrom.name}`);
  const mover = q.forCombatant;
  const out: PositionResult = { cell: cellLabel(c), x: c.x, y: c.y, why };
  const region = regionLabel(model.regionAt(c));
  if (region) out.region = region;
  if (model.hasTerrain()) out.terrain = terrainLabel(t);
  if (mover?.position) {
    const ft = chebyshev(mover.position, c) * model.feetPerCell;
    why.push(`${ft} ft from ${mover.name}'s current cell`);
    const moved = reach?.get(cellKey(c));
    if (moved !== undefined) out.moveFt = moved;
  }
  if (q.coverFrom?.position) out.cover = coverCache.get(cellKey(c));
  return out;
}

function buildHint(model: MapModel, q: PositionQuery, stages: Stage[]): string {
  const elimIndex = stages.findIndex((s, i) => i > 0 && s.remaining === 0);
  if (elimIndex < 0) return 'No cell matched.';
  const before = stages[elimIndex - 1]?.remaining ?? 0;
  const name = stages[elimIndex].filter;
  const where = q.region ? `in ${q.region.id}` : 'here';
  if (name.startsWith('next to') && q.nextToTerrain?.length && before > 0) {
    // Among the cells that passed the earlier filters, find the one nearest to the wanted terrain.
    let bestCell: Cell | undefined;
    let bestD = Infinity;
    for (let y = 0; y < model.rows; y++) {
      for (let x = 0; x < model.columns; x++) {
        const c = { x, y };
        const inSet = (q.region ? model.regionAt(c)?.id === q.region.id : true) && (!q.terrain || q.terrain.includes(model.terrainAt(c)));
        if (!inSet || !model.canOccupy(c, q.forCombatant)) continue;
        const d = model.distanceToTerrain(c, q.nextToTerrain);
        if (d > 0 && d < bestD) {
          bestD = d;
          bestCell = c;
        }
      }
    }
    const what = q.terrain ? terrainWords(q.terrain) : 'open';
    const tail = bestCell && Number.isFinite(bestD)
      ? ` Closest: ${cellLabel(bestCell)} (${bestD * model.feetPerCell} ft from ${terrainWords(q.nextToTerrain)}).` : '';
    return `No ${what} cell ${where} touches ${terrainWords(q.nextToTerrain)}.${tail}`;
  }
  if (name.startsWith('terrain') && q.region) {
    const counts = new Map<string, number>();
    for (const k of q.region.cells) {
      const t = terrainLabel(model.terrainAt(parseCellKey(k)));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n} cells)`);
    return `${q.region.id} has no matching terrain. It contains: ${top.join(', ')}.`;
  }
  if (name.startsWith('reachable')) return 'Nothing that matches is within this creature\'s movement this turn. Try a larger search or a different spot.';
  return `No cell passed the filter "${name}". Try relaxing it.`;
}

export { sizeInCells };
