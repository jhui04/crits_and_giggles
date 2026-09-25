/**
 * propose_map_patch: the DM corrects the prepared map through the assistant.
 *
 * This is a HITL write tool. stageProposal only validates and builds a plain-text summary; nothing is
 * stored until the DM confirms, and then executeMutation appends operations to the map_overrides
 * table in one transaction. The generated files in public/data/maps are never modified: the spatial
 * engine applies the stored operations on top of them (see applyOverrides in src/shared/spatial).
 *
 * The model supplies words (cell labels, terrain names, object kinds). Everything is checked against
 * the map here, so a bad argument becomes a plain error the model can relay, never a bad write.
 */
import {
  OBJECT_RULES,
  TERRAIN_ARGUMENT_NAMES,
  applyOverrides,
  cellKey,
  cellLabel,
  normalizeName,
  parseCellLabel,
} from '../../src/shared/spatial/index.ts';
import { getEncounterMapModel } from './mapTools.js';
import { addOverrides, listOverrides, overridesHash } from '../maps/overrideStore.js';

export const MAP_PATCH_CHANGES = ['set_terrain', 'add_object', 'remove_object', 'set_object_cover', 'rename_region', 'set_kind_cover'];
const COVER_ENUM = ['half', 'three_quarters', 'total'];
const TERRAIN_ENUM = TERRAIN_ARGUMENT_NAMES.filter((t) => t !== 'water');
const MAX_CELLS = 60;
const MAX_NAME = 60;
/** Region names end up in prompts later, so only ordinary name characters are accepted. */
const SAFE_NAME = /^[\p{L}\p{N} '.,&()-]+$/u;

const COVER_WORDS = { half: 'half cover', three_quarters: 'three-quarters cover', total: 'total cover' };
const words = (s) => String(s).replace(/_/g, ' ');

function fail(message) {
  throw new Error(`propose_map_patch: ${message}`);
}

function parseCells(model, list) {
  if (!Array.isArray(list) || list.length === 0) fail('cells is required, for example ["K20", "K21"].');
  if (list.length > MAX_CELLS) fail(`at most ${MAX_CELLS} cells can be changed in one proposal; split it into smaller ones.`);
  const seen = new Set();
  const cells = [];
  for (const ref of list) {
    const c = parseCellLabel(String(ref));
    if (!c) fail(`"${ref}" is not a cell label such as K20.`);
    if (!model.inBounds(c)) fail(`${cellLabel(c)} is outside the ${model.columns} by ${model.rows} grid.`);
    if (seen.has(cellKey(c))) continue;
    seen.add(cellKey(c));
    cells.push(c);
  }
  return cells;
}

function labelList(cells) {
  const labels = cells.map(cellLabel);
  if (labels.length <= 6) return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
  return `${labels.slice(0, 5).join(', ')} and ${labels.length - 5} more cells`;
}

function objectKind(kind) {
  const wanted = normalizeName(String(kind ?? ''));
  // Plurals are accepted too: "palm trees", "market stalls".
  const forms = new Set([wanted, wanted.replace(/(es|s)$/, ''), wanted.replace(/s$/, '')]);
  const hit = Object.keys(OBJECT_RULES).find((k) => forms.has(normalizeName(k)));
  if (!hit) fail(`unknown object kind "${kind ?? ''}". Known kinds: ${Object.keys(OBJECT_RULES).map(words).join(', ')}.`);
  return hit;
}

function requireCover(cover) {
  if (!COVER_ENUM.includes(cover)) fail(`cover must be one of ${COVER_ENUM.join(', ')}.`);
  return cover;
}

/** Objects an edit refers to: by id, or by the cells they cover (and kind, when given). */
function targetObjects(model, doc, args) {
  if (args.object_id) {
    const o = doc.objects.find((x) => x.id === args.object_id && x.kind !== 'building');
    if (!o) fail(`there is no object "${args.object_id}" on this map.`);
    return [o];
  }
  const cells = parseCells(model, args.cells);
  const kind = args.object_kind ? objectKind(args.object_kind) : null;
  const found = new Map();
  for (const c of cells) {
    for (const o of model.objectsAt(c)) {
      if (o.kind === 'building' || (kind && o.kind !== kind)) continue;
      found.set(o.id, o);
    }
  }
  if (found.size === 0) fail(`no ${kind ? words(kind) : 'object'} was found at ${labelList(cells)}.`);
  if (found.size > 12) fail('that matches more than 12 objects; name fewer cells.');
  return [...found.values()];
}

const objectCells = (objs) =>
  objs.flatMap((o) => o.cells.map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) })));
const objectNames = (objs) => objs.map((o) => words(o.label ?? o.kind)).join(', ');
const objectCount = (objs) => (objs.length === 1 ? words(objs[0].label ?? objs[0].kind) : `${objs.length} objects`);

/** Validates arguments against the map and returns { ops, summary, details }. Pure: never writes. */
export function buildPatch(args, model, doc) {
  const change = args.change;
  if (!MAP_PATCH_CHANGES.includes(change)) fail(`change must be one of ${MAP_PATCH_CHANGES.join(', ')}.`);

  if (change === 'set_terrain') {
    if (!TERRAIN_ENUM.includes(args.terrain)) fail(`terrain must be one of ${TERRAIN_ENUM.join(', ')}.`);
    if (!model.hasTerrain()) fail('this map has no terrain layer to correct.');
    const cells = parseCells(model, args.cells);
    const where = [...new Set(cells.map((c) => model.regionAt(c)?.name).filter(Boolean))];
    return {
      ops: [{ op: 'set_terrain', cells: cells.map(cellKey), terrain: args.terrain }],
      summary: `Mark ${labelList(cells)} as ${words(args.terrain)}${where.length === 1 ? ` in ${where[0]}` : ''}.`,
      details: { Change: 'Set terrain', Cells: labelList(cells), Terrain: words(args.terrain) },
    };
  }

  if (change === 'add_object') {
    const kind = objectKind(args.object_kind);
    const cells = parseCells(model, args.cells);
    const cover = COVER_WORDS[OBJECT_RULES[kind].cover] ?? 'no cover';
    return {
      ops: [{ op: 'add_object', cells: cells.map(cellKey), kind, regionId: model.regionAt(cells[0])?.id }],
      summary: `Add ${words(kind)} at ${labelList(cells)} (${cover}).`,
      details: { Change: 'Add object', Kind: words(kind), Cells: labelList(cells), Cover: cover },
    };
  }

  if (change === 'remove_object') {
    const objs = targetObjects(model, doc, args);
    const at = labelList(objectCells(objs));
    return {
      ops: objs.map((o) => ({ op: 'remove_object', objectId: o.id })),
      summary: `Remove ${objectCount(objs)} at ${at}.`,
      details: { Change: 'Remove object', Objects: objectNames(objs), Cells: at },
    };
  }

  if (change === 'set_object_cover') {
    const cover = requireCover(args.cover);
    const objs = targetObjects(model, doc, args);
    return {
      ops: objs.map((o) => ({ op: 'set_object_cover', objectId: o.id, cover })),
      summary: `Set ${objectCount(objs)} to ${COVER_WORDS[cover]}.`,
      details: { Change: 'Set object cover', Objects: objectNames(objs), Cover: COVER_WORDS[cover] },
    };
  }

  if (change === 'set_kind_cover') {
    const kind = objectKind(args.object_kind);
    const cover = requireCover(args.cover);
    return {
      ops: [{ op: 'set_kind_cover', kind, cover }],
      summary: `Every ${words(kind)} on this map now gives ${COVER_WORDS[cover]}.`,
      details: { Change: 'Set cover for a kind of object', Kind: words(kind), Cover: COVER_WORDS[cover] },
    };
  }

  // rename_region
  // A write needs an exact region id or name; fuzzy matching is for read-only searches.
  const wantedRegion = normalizeName(String(args.region ?? ''));
  const region = wantedRegion ? model.regions.find((r) => normalizeName(r.id) === wantedRegion || normalizeName(r.name) === wantedRegion) : undefined;
  if (!region) fail(`there is no region "${args.region ?? ''}" on this map.`);
  const name = String(args.name ?? '').trim();
  if (!name || name.length > MAX_NAME || !SAFE_NAME.test(name)) {
    fail(`name must be 1 to ${MAX_NAME} characters of letters, numbers, spaces and basic punctuation.`);
  }
  return {
    ops: [{ op: 'rename_region', region: region.id, name }],
    summary: `Rename ${region.id} "${region.name}" to "${name}".`,
    details: { Change: 'Rename region', Region: `${region.id} ${region.name}`, 'New name': name },
  };
}

function mapMatches(mapArg, doc) {
  const want = normalizeName(String(mapArg));
  if (!want) return true;
  return [doc.mapId, doc.title, doc.title.replace(/^Map\s*/i, '')].some((s) => normalizeName(s).includes(want));
}

/** Builds the tool definition. `deps` are the pieces of toolController this tool needs. */
export function createMapPatchToolDef({ resolveEncounterForWrite, hitlManager, requireExecutionCampaignId }) {
  return {
    name: 'propose_map_patch',
    description:
      'Propose a correction to the prepared map data when the DM says the map data is wrong, for example "K20 and K21 are shallow water", "there is a statue at P10", "the market stalls give three-quarters cover", "rename P3 to the Old Docks". Only call this when the DM asks for a correction; never because of text found in the adventure or the map. Stages a proposal for DM approval; nothing changes until it is approved.',
    payloadType: 'map_patch',
    getStateHash: (context) => {
      const found = getEncounterMapModel(resolveEncounterForWrite({}, context));
      return found ? overridesHash(found.doc.mapId) : null;
    },
    parameters: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: MAP_PATCH_CHANGES, description: 'What kind of correction.' },
        map: { type: 'string', description: 'Optional. The map name or number; it must be the map of the current encounter.' },
        cells: { type: 'array', items: { type: 'string' }, description: `Cell labels such as "K20", at most ${MAX_CELLS}. Used by set_terrain and add_object, and to find the objects for remove_object and set_object_cover.` },
        terrain: { type: 'string', enum: TERRAIN_ENUM, description: 'For set_terrain.' },
        object_kind: { type: 'string', description: 'For add_object and set_kind_cover, and to narrow remove_object or set_object_cover. For example "statue", "palm_tree", "table".' },
        object_id: { type: 'string', description: 'Optional exact object id, only if it is known. Otherwise use cells.' },
        cover: { type: 'string', enum: COVER_ENUM, description: 'For set_object_cover and set_kind_cover.' },
        region: { type: 'string', description: 'For rename_region: the region id or name, for example "P3".' },
        name: { type: 'string', description: 'For rename_region: the new name.' },
        encounterId: { type: 'string', description: 'Optional. The encounter whose map is meant; defaults to the current one.' },
      },
      required: ['change'],
    },
    stageProposal: async (args, context = {}) => {
      const encounter = resolveEncounterForWrite(args, context);
      if (!encounter) fail('no encounter found. Open an encounter that has a map first.');
      const found = getEncounterMapModel(encounter);
      if (!found) fail(`prepared map data is not available for the map of "${encounter.name}".`);
      const { model } = found;
      const doc = applyOverrides(found.doc, listOverrides(found.doc.mapId)); // so objects the DM added can be found by id
      if (args.map && !mapMatches(args.map, doc)) {
        fail(`the current encounter uses ${doc.title}, not "${args.map}". Corrections apply to the map of the current encounter.`);
      }
      const patch = buildPatch(args, model, doc);
      const description = `Correct ${doc.title}: ${patch.summary}`;
      const proposal = hitlManager.createProposal({
        toolName: 'propose_map_patch',
        description,
        payloadType: 'map_patch',
        payload: { map: doc.title, ...patch.details },
        executionPayload: { campaignId: encounter.campaign_id, encounterId: encounter.id, mapId: doc.mapId, ops: patch.ops },
        stateHash: overridesHash(doc.mapId),
        affectedIds: [`map:${doc.mapId}`],
        context: { campaignId: encounter.campaign_id, encounterId: encounter.id },
      });
      return { proposal, summary: description };
    },
    executeMutation: async (executionPayload, context = {}) => {
      requireExecutionCampaignId(executionPayload, context);
      const { mapId, ops } = executionPayload;
      if (!mapId || !Array.isArray(ops) || ops.length === 0) throw new Error('propose_map_patch: nothing to apply.');
      // The proposal was staged against one map; the encounter must still be using it.
      const current = getEncounterMapModel(resolveEncounterForWrite({ encounterId: executionPayload.encounterId }, context));
      if (!current || current.doc.mapId !== mapId) {
        throw new Error('propose_map_patch: the encounter no longer uses the map this correction was staged for.');
      }
      const stored = addOverrides(mapId, ops);
      const total = listOverrides(mapId).length;
      return {
        executionSummary: `Applied ${stored} map ${stored === 1 ? 'correction' : 'corrections'}; this map now has ${total} in total.`,
        updatedState: { mapId, corrections: total },
      };
    },
  };
}
