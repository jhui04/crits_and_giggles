import type { Cell, CombatantLite, MapObject, RegionV2, TerrainClass, WallSegment } from './types.ts';
import type { MapModel } from './mapModel.ts';
import { chebyshev, NEIGHBOURS_8 } from './geometry.ts';
import { cellKey, cellLabel, parseCellKey } from './labels.ts';
import { TERRAIN_RULES, terrainLabel } from './terrainRules.ts';
import { objectKindLabel } from './objectRules.ts';
import { directionWord, findPositions } from './queries.ts';

const COVER_TEXT: Record<string, string> = { none: 'no cover', half: 'half cover', three_quarters: 'three-quarters cover', total: 'total cover' };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(label: string, n: number): string {
  if (n === 1) return label;
  return /s$/.test(label) ? label : `${label}s`;
}

function regionText(r?: RegionV2): string | undefined {
  return r ? `${r.id} ${r.name}` : undefined;
}

/** Opposing creatures of `subject`: enemies face players and allies, and the reverse. */
export function opponentsOf(subject: CombatantLite, all: CombatantLite[]): CombatantLite[] {
  const isEnemy = subject.faction === 'enemy' || (!subject.isPlayer && subject.faction !== 'ally' && subject.faction !== 'neutral');
  return all.filter((c) => c.instanceId !== subject.instanceId && c.position &&
    (isEnemy ? (c.isPlayer || c.faction === 'ally') : c.faction === 'enemy'));
}

function distanceToSegmentCells(p: { x: number; y: number }, w: WallSegment): { d: number; closest: { x: number; y: number } } {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len));
  const closest = { x: w.a.x + t * dx, y: w.a.y + t * dy };
  return { d: Math.hypot(p.x - closest.x, p.y - closest.y), closest };
}

function dataQualityText(model: MapModel): string {
  const parts: string[] = [];
  if (!model.hasTerrain()) parts.push('Terrain data is not available for this map.');
  else parts.push('Terrain was detected automatically and may have mistakes.');
  const trusted = model.walls.length;
  const stored = model.doc.walls.filter((w) => w.kind !== 'invisible').length;
  if (stored && !trusted) parts.push('Walls are stored but could not be aligned, so they are ignored.');
  else if (!stored) parts.push('No wall data for this map.');
  return parts.join(' ');
}

export function describeSurroundings(
  model: MapModel, subject: CombatantLite, others: CombatantLite[], radiusFt = 30,
): Record<string, unknown> {
  const pos = subject.position;
  if (!pos) return { error: `${subject.name} has no position on the map.` };
  const radius = Math.max(1, Math.round(radiusFt / model.feetPerCell));
  const out: Record<string, unknown> = { subject: subject.name, cell: cellLabel(pos) };
  const region = regionText(model.regionAt(pos));
  if (region) out.region = region;
  if (!model.isTactical) return { ...out, note: 'Overview map: tactical rules do not apply.' };

  const home: TerrainClass = model.terrainAt(pos);
  if (model.hasTerrain()) {
    out.standingOn = terrainLabel(home);
    // Nearest cell of each different terrain class within the radius.
    const nearest = new Map<TerrainClass, { c: Cell; d: number }>();
    for (let y = pos.y - radius; y <= pos.y + radius; y++) {
      for (let x = pos.x - radius; x <= pos.x + radius; x++) {
        const c = { x, y };
        if (!model.inBounds(c)) continue;
        const t = model.terrainAt(c);
        if (t === home || t === 'unknown') continue;
        const d = chebyshev(pos, c);
        const cur = nearest.get(t);
        if (!cur || d < cur.d) nearest.set(t, { c, d });
      }
    }
    out.terrain = [...nearest.entries()].sort((a, b) => a[1].d - b[1].d).slice(0, 5).map(([t, v]) => {
      const rule = TERRAIN_RULES[t];
      const note = rule.note ? ` (${rule.note})` : '';
      return `${capitalize(terrainLabel(t))} starts ${v.d * model.feetPerCell} ft ${directionWord(pos, v.c)}${note}`;
    });
  }

  // Features: nearest of each object kind, then nearest walls and doors.
  const features: Array<{ d: number; text: string }> = [];
  const seenKind = new Set<string>();
  const found: Array<{ o: MapObject; c: Cell; d: number }> = [];
  for (let y = pos.y - radius; y <= pos.y + radius; y++) {
    for (let x = pos.x - radius; x <= pos.x + radius; x++) {
      const c = { x, y };
      if (!model.inBounds(c)) continue;
      for (const o of model.objectsAt(c)) found.push({ o, c, d: chebyshev(pos, c) });
    }
  }
  found.sort((a, b) => a.d - b.d);
  for (const { o, c, d } of found) {
    if (o.kind === 'building' || seenKind.has(o.id)) continue;
    seenKind.add(o.id);
    const dir = d === 0 ? 'in the same square' : `${d * model.feetPerCell} ft ${directionWord(pos, c)}`;
    features.push({ d, text: `${capitalize(o.label)} ${dir}: ${COVER_TEXT[o.cover]}` });
    if (features.length >= 6) break;
  }
  const wallSeen = new Set<string>();
  const centre = { x: pos.x + 0.5, y: pos.y + 0.5 };
  const nearWalls = model.walls
    .map((w) => ({ w, ...distanceToSegmentCells(centre, w) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d);
  for (const { w, d, closest } of nearWalls) {
    const name = w.name ?? w.kind.replace(/_/g, ' ');
    if (wallSeen.has(name)) continue;
    wallSeen.add(name);
    const state = w.door ? ` (${w.door.state})` : '';
    const ft = Math.max(5, Math.round(d) * model.feetPerCell);
    features.push({ d: d + 0.5, text: `${capitalize(name)} ${ft} ft ${directionWord(pos, { x: Math.floor(closest.x), y: Math.floor(closest.y) })}${state}` });
    if (wallSeen.size >= 3) break;
  }
  out.features = features.sort((a, b) => a.d - b.d).slice(0, 8).map((f) => f.text);

  // Cover against the opposing side, right now.
  const foes = opponentsOf(subject, others).sort((a, b) => chebyshev(pos, a.position!) - chebyshev(pos, b.position!));
  out.coverNow = foes.slice(0, 4).map((f) => {
    const r = model.cover(f.position!, pos);
    const item: Record<string, unknown> = { from: f.name, distanceFt: chebyshev(pos, f.position!) * model.feetPerCell, cover: r.type.replace('_', '-') };
    if (r.blockers.length) item.because = r.blockers.join(', ');
    return item;
  });

  // Nearby cells with cover against the closest foe that this creature can reach this turn.
  if (foes.length) {
    const foe = foes[0];
    const occupied = new Set(others.filter((o) => o.position && o.instanceId !== subject.instanceId).map((o) => cellKey(o.position!)));
    const search = findPositions(model, {
      forCombatant: subject, near: pos, withinFt: radiusFt, coverFrom: foe, minCover: 'half', reachableThisTurn: true,
      rankBy: 'most_cover', limit: 4, occupied,
    });
    out.coverOptions = search.results.filter((r) => !(r.x === pos.x && r.y === pos.y)).slice(0, 3).map((r) => ({
      cell: r.cell, moveFt: r.moveFt ?? 0, coverFrom: foe.name, cover: (r.cover ?? 'half').replace('_', '-'),
      because: model.cover(foe.position!, { x: r.x, y: r.y }).blockers.join(', ') || undefined,
    }));
  }
  out.dataQuality = dataQualityText(model);
  return out;
}

// ------------------------------------------------------------------ overview

const SECTORS = [['north-west', 'north', 'north-east'], ['west', 'centre', 'east'], ['south-west', 'south', 'south-east']];

function sectorOf(c: Cell, model: MapModel): string {
  const col = Math.min(2, Math.floor((c.x / model.columns) * 3));
  const row = Math.min(2, Math.floor((c.y / model.rows) * 3));
  return SECTORS[row][col];
}

function meanCell(cells: Cell[]): Cell {
  const n = cells.length || 1;
  return { x: Math.round(cells.reduce((s, c) => s + c.x, 0) / n), y: Math.round(cells.reduce((s, c) => s + c.y, 0) / n) };
}

function regionEntry(model: MapModel, r: RegionV2): Record<string, unknown> {
  const cells = r.cells.map(parseCellKey);
  const entry: Record<string, unknown> = { id: r.id, name: r.name };
  if (!cells.length) {
    const lc = r.labelCells[0];
    if (lc) entry.where = sectorOf(lc, model);
    entry.size = 'extent unknown';
    return entry;
  }
  const centre = meanCell(cells);
  entry.where = sectorOf(centre, model);
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const f = model.feetPerCell;
  entry.size = `about ${(Math.max(...xs) - Math.min(...xs) + 1) * f} x ${(Math.max(...ys) - Math.min(...ys) + 1) * f} ft`;
  if (model.hasTerrain()) {
    const counts = new Map<string, number>();
    for (const c of cells) {
      const t = terrainLabel(model.terrainAt(c));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    entry.terrain = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([t, n]) => `${t} ${Math.round((100 * n) / cells.length)}%`).join(', ');
  }
  const kinds = new Map<string, { label: string; n: number; cover: string }>();
  const own = new Set(r.cells);
  const seen = new Set<string>();
  for (const k of own) {
    for (const o of model.objectsAt(parseCellKey(k))) {
      if (o.kind === 'building' || seen.has(o.id)) continue;
      seen.add(o.id);
      const cur = kinds.get(o.kind) ?? { label: objectKindLabel(o.kind), n: 0, cover: COVER_TEXT[o.cover] };
      cur.n++;
      kinds.set(o.kind, cur);
    }
  }
  const feats = [...kinds.values()].sort((a, b) => b.n - a.n).map((v) => `${v.n} ${plural(v.label, v.n)} (${v.cover})`);
  if (feats.length) entry.features = feats.length > 4 ? [...feats.slice(0, 4), `and ${feats.length - 4} more`] : feats;

  // What borders the region: other regions and water, with compass directions from its centre.
  const borders = new Map<string, Set<string>>();
  const waterDirs = new Set<string>();
  for (const c of cells) {
    for (const [dx, dy] of NEIGHBOURS_8) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (!model.inBounds(n) || own.has(cellKey(n))) continue;
      const other = model.regionAt(n);
      if (other && other.id !== r.id) {
        const set = borders.get(`${other.id} ${other.name}`) ?? new Set();
        set.add(directionWord(centre, n));
        borders.set(`${other.id} ${other.name}`, set);
      }
      const t = model.terrainAt(n);
      if (t === 'water_deep' || t === 'water_shallow') waterDirs.add(directionWord(centre, n));
    }
  }
  const lines = [...borders.entries()].slice(0, 3).map(([name, dirs]) => `${name} to the ${[...dirs][0]}`);
  if (waterDirs.size) lines.push(`water to the ${[...waterDirs].slice(0, 3).join(', ')}`);
  if (lines.length) entry.borders = lines;
  return entry;
}

export function mapOverview(model: MapModel, combatants: CombatantLite[] = [], includeCombatants = true): Record<string, unknown> {
  const doc = model.doc;
  const w = model.columns;
  const h = model.rows;
  const f = model.feetPerCell;
  const out: Record<string, unknown> = { map: doc.title, kind: doc.kind };
  if (!model.isTactical) {
    out.note = 'Overview map: distances are not 5-ft squares and tactical rules do not apply.';
    out.regions = doc.regions.map((r) => ({ id: r.id, name: r.name }));
    return out;
  }
  out.size = `${w} x ${h} cells (${w * f} x ${h * f} ft), ${f} ft per cell; printed scale ${doc.grid.printedScale}`;
  const q: string[] = [];
  const wallsStored = doc.walls.filter((x) => x.kind !== 'invisible').length;
  q.push(wallsStored === 0 ? 'Walls: none recorded' : model.walls.length ? 'Walls: verified' : 'Walls: stored but not aligned, ignored');
  if (model.hasTerrain()) {
    const conf = doc.terrain?.confidence ?? {};
    const low = Object.keys(conf).length;
    const pct = Math.max(0, Math.round(100 * (1 - low / (w * h))));
    q.push(`Terrain: automatic, ${pct}% of cells confident`);
  } else q.push('Terrain: not available');
  const methods = new Set(doc.regions.map((r) => r.extentMethod));
  q.push(methods.has('polygon') ? 'Regions: book outlines' : 'Regions: book labels, approximate extents');
  out.dataQuality = q;
  out.regions = doc.regions.map((r) => regionEntry(model, r));
  if (includeCombatants) {
    out.combatants = combatants.filter((c) => c.position).map((c) => {
      const item: Record<string, unknown> = { name: c.name, cell: cellLabel(c.position!) };
      const rg = regionText(model.regionAt(c.position!));
      if (rg) item.region = rg;
      if (model.hasTerrain()) item.terrain = terrainLabel(model.terrainAt(c.position!));
      return item;
    });
  }
  return fitBudget(out, 4000);
}

function fitBudget(out: Record<string, unknown>, budget: number): Record<string, unknown> {
  const size = () => JSON.stringify(out).length;
  const regions = out.regions as Array<Record<string, unknown>>;
  for (const key of ['borders', 'features', 'terrain', 'size']) {
    if (size() <= budget) break;
    for (const r of regions) delete r[key];
  }
  if (size() > budget && Array.isArray(out.combatants) && out.combatants.length > 12) {
    const all = out.combatants as unknown[];
    out.combatants = all.slice(0, 12);
    out.combatantsNote = `and ${all.length - 12} more not listed`;
  }
  if (size() > budget) out.regions = regions.map((r) => ({ id: r.id, name: r.name }));
  return out;
}

// ------------------------------------------------------------------ placement checks

export interface PlacementInfo {
  /** Ground under the creature, in words (absent when the map has no terrain data). */
  terrain?: string;
  /** Short plain-English facts for the DM to hear before approving a move. */
  notes: string[];
  /** Set when the footprint sits on empty space or a building the terrain data is sure about. */
  blocked?: { reason: string };
}

/** Facts about putting `mover` on `cell`: ground, water contact, cover from opponents, hazards. */
export function describePlacement(model: MapModel, cell: Cell, mover: CombatantLite, others: CombatantLite[]): PlacementInfo {
  const notes: string[] = [];
  const info: PlacementInfo = { notes };
  if (!model.isTactical) return info;
  const cells = model.footprint(cell, mover.size);
  if (model.hasTerrain()) {
    for (const c of cells) {
      const t = model.terrainAt(c);
      if ((t === 'void' || t === 'building') && model.terrainConfidenceAt(c) >= 0.8) {
        info.blocked = { reason: `${cellLabel(c)} is ${terrainLabel(t)}` };
        break;
      }
    }
    const t = model.terrainAt(cell);
    info.terrain = terrainLabel(t);
    const water: TerrainClass[] = ['water_deep', 'water_shallow'];
    let line = capitalize(terrainLabel(t));
    if (t !== 'water_deep' && t !== 'water_shallow') {
      const dirs = new Set<string>();
      for (const [dx, dy] of NEIGHBOURS_8) {
        const n = { x: cell.x + dx, y: cell.y + dy };
        if (model.inBounds(n) && water.includes(model.terrainAt(n))) dirs.add(directionWord(cell, n));
      }
      if (dirs.size) line += `; water touches it to the ${[...dirs].join(' and ')}`;
    }
    notes.push(line);
    if (t === 'water_deep' && !((mover.speeds?.swim ?? 0) > 0)) notes.push('Deep water: this creature has no swim speed');
    else if (t === 'water_shallow') notes.push('Shallow water is difficult terrain');
  }
  for (const foe of opponentsOf(mover, others).sort((a, b) => chebyshev(cell, a.position!) - chebyshev(cell, b.position!)).slice(0, 3)) {
    const r = model.cover(foe.position!, cell);
    if (r.type !== 'none') notes.push(`${capitalize(r.type.replace('_', '-'))} cover from ${foe.name}${r.blockers.length ? ` (${r.blockers.join(', ')})` : ''}`);
  }
  return info;
}
