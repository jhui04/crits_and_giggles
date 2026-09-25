/**
 * Read-only map intelligence tools for the Assistant: get_map_overview,
 * describe_surroundings, find_positions.
 *
 * These never write. They resolve the encounter, load its compiled MapDocument
 * (public/data/maps, see tools/maps) and hand ALL spatial reasoning to the shared
 * engine in src/shared/spatial. The model only turns language into arguments and
 * picks among the small, labelled results returned here. A creature is moved with
 * the existing move_combatant HITL flow.
 */
import { db } from '../db.js';
import { getMapDocumentByUrl, getMapModel } from '../maps/mapStore.js';
import { listOverrides } from '../maps/overrideStore.js';
import {
  TERRAIN_ARGUMENT_NAMES,
  cellLabel,
  describeSurroundings,
  expandTerrainNames,
  findPositions,
  mapOverview,
  opponentsOf,
  parseCellLabel,
} from '../../src/shared/spatial/index.ts';

const TERRAIN_ENUM = [...TERRAIN_ARGUMENT_NAMES];
const COVER_ENUM = ['half', 'three_quarters', 'total'];
const RANK_ENUM = ['nearest_to_combatant', 'nearest_to_near', 'farthest_from_enemies', 'most_cover'];
const MAP_COLUMNS = 'id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config';

const terrainList = (description) => ({
  type: 'array',
  items: { type: 'string', enum: TERRAIN_ENUM },
  description,
});

export const MAP_READ_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_map_overview',
      description:
        'List the areas of the current battle map (book keys like P1, names, where they are, terrain, features, what borders them) and where each combatant is. Use this for "which areas are next to the water" or "what is on this map". Works from prepared map data, not from the image.',
      parameters: {
        type: 'object',
        properties: {
          include_combatants: {
            type: 'boolean',
            description: 'Include each combatant with its cell, area, and terrain. Defaults to true.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_surroundings',
      description:
        'Describe what is around one combatant: the ground it stands on, nearby terrain changes, objects and walls, the cover it has against enemies right now, and nearby cells it could move to for cover. Use this for "what is around Sahuagin 2" or "what can it use for cover".',
      parameters: {
        type: 'object',
        properties: {
          combatant: { type: 'string', description: 'Name or instanceId of the combatant, e.g. "Sahuagin 2".' },
          radius_ft: {
            type: 'integer',
            minimum: 5,
            maximum: 60,
            description: 'How far to look, in feet. Defaults to 30.',
          },
        },
        required: ['combatant'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_positions',
      description:
        'Find grid cells that fit a placement request, best first, so a creature can be moved there with move_combatant. Combine filters. For "at the edge of the water but still on the beach" use terrain ["sand"] and next_to_terrain ["water"]. Never work out coordinates yourself: use a cell from the results.',
      parameters: {
        type: 'object',
        properties: {
          for_combatant: {
            type: 'string',
            description: 'Name of the creature that will stand there. Used for size, speed, and ranking. Its own cell counts as free.',
          },
          region: { type: 'string', description: 'Area id or name to search in, e.g. "P1" or "South Shore".' },
          near: { type: 'string', description: 'Combatant name or cell label (e.g. "K20") to search around.' },
          within_ft: {
            type: 'integer',
            minimum: 5,
            maximum: 120,
            description: 'Maximum distance from `near`. Defaults to 30.',
          },
          terrain: terrainList('The cell must be one of these ground types.'),
          avoid_terrain: terrainList('The cell must not be any of these ground types.'),
          next_to_terrain: terrainList(
            'The cell must touch one of these (8 directions). For "at the edge of the water, still on the beach" use terrain ["sand"] and next_to_terrain ["water"].'
          ),
          near_terrain: terrainList('With max_ft_from_terrain: the cell must be within that distance of this ground type.'),
          max_ft_from_terrain: {
            type: 'integer',
            minimum: 0,
            maximum: 120,
            description: 'Used with near_terrain.',
          },
          cover_from: { type: 'string', description: 'Combatant name; the cell must give cover from them (at least min_cover).' },
          min_cover: { type: 'string', enum: COVER_ENUM, description: 'Minimum cover for cover_from. Defaults to half.' },
          hidden_from: { type: 'string', description: 'Combatant name; the cell must have no line of sight from them.' },
          reachable_this_turn: {
            type: 'boolean',
            description: 'Only cells for_combatant can reach with its speed this turn.',
          },
          rank_by: { type: 'string', enum: RANK_ENUM, description: 'How to order the results.' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many cells to return. Defaults to 3.' },
        },
      },
    },
  },
];

export const MAP_READ_TOOL_NAMES = MAP_READ_TOOL_DEFS.map((t) => t.function.name);

/** Same selection order as get_current_map: context encounter, then a running one with a map. */
function resolveEncounterWithMap(context) {
  const { campaignId, encounterId } = context;
  let encounter = null;
  if (encounterId) {
    encounter = campaignId
      ? db.prepare(`SELECT ${MAP_COLUMNS} FROM encounters WHERE id = ? AND campaign_id = ?`).get(encounterId, campaignId)
      : db.prepare(`SELECT ${MAP_COLUMNS} FROM encounters WHERE id = ?`).get(encounterId);
  }
  if (!encounter && campaignId) {
    encounter = db
      .prepare(
        `SELECT ${MAP_COLUMNS} FROM encounters WHERE campaign_id = ? AND (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1`
      )
      .get(campaignId);
  }
  if (!encounter) {
    encounter = db
      .prepare(
        `SELECT ${MAP_COLUMNS} FROM encounters WHERE (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1`
      )
      .get();
  }
  return encounter;
}

function speedsOf(c) {
  const s = c.fullData?.attributes?.speeds;
  if (!s || typeof s !== 'object') return { walk: 30 };
  const out = {};
  for (const k of ['walk', 'swim', 'fly', 'climb']) if (Number.isFinite(Number(s[k])) && Number(s[k]) > 0) out[k] = Number(s[k]);
  if (!Object.keys(out).length) out.walk = 30;
  return out;
}

const SIZES = new Set(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

export function combatantToLite(c) {
  const size = c.fullData?.meta?.size;
  const pos = c.position;
  const hasPos = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
  return {
    instanceId: c.instanceId,
    name: c.name,
    isPlayer: !!c.isPlayer,
    faction: c.faction === 'ally' || c.faction === 'enemy' || c.faction === 'neutral' ? c.faction : undefined,
    position: hasPos ? { x: pos.x, y: pos.y } : null,
    size: SIZES.has(size) ? size : 'Medium',
    speeds: speedsOf(c),
  };
}

/**
 * Loads everything a map tool needs. Returns { error, hint } instead of throwing for the
 * normal "nothing to work with" cases so the model can tell the DM plainly.
 */
export function loadMapContext(context, deps) {
  const encounter = resolveEncounterWithMap(context || {});
  if (!encounter) {
    return { error: 'No combat encounter with a map was found.', hint: 'Open or create an encounter that has a battle map.' };
  }
  const found = getEncounterMapModel(encounter);
  if (!found) {
    return {
      error: `Prepared map data is not available for the map of "${encounter.name}".`,
      hint: 'Use get_current_map to look at the image instead.',
      encounterId: encounter.id,
    };
  }
  const raw = deps.loadEncounterCombatants(encounter.id, encounter.running_state, encounter.campaign_id);
  return { encounter, doc: found.doc, model: found.model, raw, combatants: raw.map(combatantToLite), deps };
}

function listNames(list) {
  return list.map((c) => c.name).slice(0, 12).join(', ') || 'none';
}

function findCombatant(mc, ref) {
  const found = mc.deps.resolveCombatantRef(mc.raw, ref, ref);
  if (!found) return null;
  return mc.combatants.find((c) => c.instanceId === found.instanceId) || null;
}

/** Like findCombatant, but an ambiguous name becomes a plain { error } instead of a thrown error. */
function findCombatantSafe(mc, ref) {
  try {
    return { combatant: findCombatant(mc, ref) };
  } catch (err) {
    return { error: err.message };
  }
}

function cellFromRef(mc, ref) {
  const text = String(ref).trim();
  const looksLikeCell = /^[A-Za-z]{1,2}\s*[-_]?\s*\d{1,3}$/.test(text) || /^\d+\s*,\s*\d+$/.test(text);
  if (looksLikeCell) {
    const cell = parseCellLabel(text);
    if (cell && mc.model.inBounds(cell)) return { cell, name: cellLabel(cell) };
  }
  // A name such as "Ox 1" can look like a cell label, so a combatant match is tried too.
  const { combatant: c, error } = findCombatantSafe(mc, text);
  if (error) return { error };
  if (c?.position) return { cell: c.position, name: c.name };
  if (c) return { error: `${c.name} has no position on the map.` };
  if (looksLikeCell) return { error: `"${ref}" is outside the ${mc.model.columns} by ${mc.model.rows} grid.` };
  return { error: `"${ref}" is neither a cell label nor a combatant on this map.` };
}

function occupiedCells(mc, exceptId) {
  const set = new Set();
  for (const c of mc.combatants) {
    if (!c.position || c.instanceId === exceptId) continue;
    // Larger creatures hold more than their anchor cell.
    for (const f of mc.model.footprint(c.position, c.size)) set.add(`${f.x},${f.y}`);
  }
  return set;
}

export function runGetMapOverview(args, context, deps) {
  const mc = loadMapContext(context, deps);
  if (mc.error) return mc;
  return mapOverview(mc.model, mc.combatants, args.include_combatants !== false);
}

export function runDescribeSurroundings(args, context, deps) {
  const mc = loadMapContext(context, deps);
  if (mc.error) return mc;
  const found = findCombatantSafe(mc, args.combatant);
  if (found.error) return { error: found.error };
  const subject = found.combatant;
  if (!subject) {
    return { error: `Combatant "${args.combatant}" was not found.`, hint: `Combatants here: ${listNames(mc.combatants)}.` };
  }
  return describeSurroundings(mc.model, subject, mc.combatants, args.radius_ft ?? 30);
}

export function runFindPositions(args, context, deps) {
  const mc = loadMapContext(context, deps);
  if (mc.error) return mc;
  const model = mc.model;
  const query = { limit: args.limit ?? 3, rankBy: args.rank_by };

  if (args.for_combatant) {
    const lookup = findCombatantSafe(mc, args.for_combatant);
    if (lookup.error) return { error: lookup.error };
    const c = lookup.combatant;
    if (!c) return { error: `Combatant "${args.for_combatant}" was not found.`, hint: `Combatants here: ${listNames(mc.combatants)}.` };
    query.forCombatant = c;
    query.occupied = occupiedCells(mc, c.instanceId);
    query.enemies = opponentsOf(c, mc.combatants);
  } else {
    query.occupied = occupiedCells(mc, null);
  }
  if (args.region) {
    const region = model.findRegion(args.region);
    if (!region) {
      const ids = model.regions.map((r) => `${r.id} ${r.name}`).join('; ') || 'none';
      return { error: `No area matches "${args.region}".`, hint: `Valid areas: ${ids}.` };
    }
    query.region = region;
  }
  if (args.near) {
    const n = cellFromRef(mc, args.near);
    if (n.error) return { error: n.error };
    query.near = n.cell;
    query.nearName = n.name;
    query.withinFt = args.within_ft ?? 30;
  }
  if (args.terrain) query.terrain = expandTerrainNames(args.terrain);
  if (args.avoid_terrain) query.avoidTerrain = expandTerrainNames(args.avoid_terrain);
  if (args.next_to_terrain) query.nextToTerrain = expandTerrainNames(args.next_to_terrain);
  if (args.near_terrain) {
    query.nearTerrain = expandTerrainNames(args.near_terrain);
    query.maxFtFromTerrain = args.max_ft_from_terrain ?? 0;
  }
  for (const [key, field] of [['cover_from', 'coverFrom'], ['hidden_from', 'hiddenFrom']]) {
    if (!args[key]) continue;
    const lookup = findCombatantSafe(mc, args[key]);
    if (lookup.error) return { error: lookup.error };
    const c = lookup.combatant;
    if (!c) return { error: `Combatant "${args[key]}" was not found.`, hint: `Combatants here: ${listNames(mc.combatants)}.` };
    if (!c.position) return { error: `${c.name} has no position on the map.` };
    query[field] = c;
  }
  if (args.min_cover) query.minCover = args.min_cover;
  if (args.rank_by === 'farthest_from_enemies' && !query.forCombatant) {
    return { error: 'rank_by farthest_from_enemies needs for_combatant, so it is known which side the enemies are.' };
  }
  if (args.rank_by === 'most_cover' && !query.coverFrom && !(query.enemies && query.enemies.length)) {
    return { error: 'rank_by most_cover needs cover_from or for_combatant with enemies on the map.' };
  }
  if (args.reachable_this_turn) {
    if (!query.forCombatant?.position) return { error: 'reachable_this_turn needs for_combatant, and it must be on the map.' };
    query.reachableThisTurn = true;
  }
  return findPositions(model, query);
}

/** The compiled map document and spatial model an encounter uses, or null when it has none. */
export function getEncounterMapModel(encounter) {
  if (!encounter) return null;
  const doc = getMapDocumentByUrl(encounter.dm_map_url || encounter.player_map_url);
  return doc ? { doc, model: getMapModel(doc, listOverrides(doc.mapId)) } : null;
}
