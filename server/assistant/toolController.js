import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { db } from '../db.js';
import { searchVectorStore } from './vectorStore.js';
import { hitlManager } from './hitlManager.js';
import { projectHpApplication } from './combatHpUtils.js';
import { validateAgainstSchema, formatSchemaErrors } from './schemaValidator.js';
import {
  parseScenarioCombatants,
  allocateTokenCoordinates,
  formatPhaseLabel,
  findMonster,
} from './combatantParser.js';
import {
  columnIndexToLabel,
  coordinateToLabel,
  columnLabelToIndex,
  labelToCoordinate,
  calculateDistance,
  resolveRegionName,
  calculateAdjacencies,
} from './gridUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');
const PUBLIC_MAPS_DIR = path.resolve(__dirname, '../../public/maps');
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// Cache static datasets
let cachedSpells = null;
let cachedMonsters = null;
let cachedMagicItems = null;

function getSpells() {
  if (!cachedSpells) {
    const p = path.join(PUBLIC_DATA_DIR, 'spells.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      cachedSpells = Array.isArray(parsed) ? parsed : (parsed.spells || []);
    } else {
      cachedSpells = [];
    }
  }
  return cachedSpells;
}

function getMonsters() {
  if (!cachedMonsters) {
    const p = path.join(PUBLIC_DATA_DIR, 'monsters.json');
    if (fs.existsSync(p)) {
      cachedMonsters = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } else {
      cachedMonsters = [];
    }
  }
  return cachedMonsters;
}

// Exact id/name -> monster lookup map, built once from the (already cached)
// monster list, so callers that just need an exact match (e.g. attaching a
// stat block to a live combatant by monsterId) don't linearly scan all ~800
// monsters. Fuzzy/substring lookups still need a full scan and are
// unaffected.
let cachedMonsterLookup = null;
function getMonsterLookup() {
  const monsters = getMonsters();
  if (cachedMonsterLookup && cachedMonsterLookup.source === monsters) {
    return cachedMonsterLookup.map;
  }
  const map = new Map();
  for (const m of monsters) {
    if (m.id !== undefined && m.id !== null) map.set(String(m.id).toLowerCase(), m);
    if (m.name) {
      const key = m.name.toLowerCase();
      if (!map.has(key)) map.set(key, m);
    }
  }
  cachedMonsterLookup = { source: monsters, map };
  return map;
}

function getMagicItems() {
  if (!cachedMagicItems) {
    const p = path.join(PUBLIC_DATA_DIR, 'magic_items.json');
    if (fs.existsSync(p)) {
      cachedMagicItems = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } else {
      cachedMagicItems = [];
    }
  }
  return cachedMagicItems;
}

let cachedMapGrids = null;
export function getMapGrids() {
  if (!cachedMapGrids) {
    const p = path.join(PUBLIC_DATA_DIR, 'map_grids.json');
    if (fs.existsSync(p)) {
      try {
        cachedMapGrids = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        cachedMapGrids = {};
      }
    } else {
      cachedMapGrids = {};
    }
  }
  return cachedMapGrids;
}

const MAX_COMBATANT_HP = 10000;
const MAX_CONFIGURED_COMBATANTS = 50;

/**
 * Escapes SQL LIKE wildcards so user/LLM-supplied text matches literally.
 * Use with `LIKE ? ESCAPE '\\'`.
 */
function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, '\\$&');
}

/**
 * Auto-numbers combatants that share a name ("Goblin", "Goblin" ->
 * "Goblin 1", "Goblin 2"), mirroring what parseScenarioCombatants does for
 * counted groups. Mutates the array in place; unique names are untouched.
 */
export function numberDuplicateCombatantNames(combatants) {
  const totals = new Map();
  for (const c of combatants) {
    const k = c.name.toLowerCase();
    totals.set(k, (totals.get(k) || 0) + 1);
  }
  const seen = new Map();
  for (const c of combatants) {
    const k = c.name.toLowerCase();
    if (totals.get(k) > 1) {
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      c.name = `${c.name} ${n}`;
    }
  }
  return combatants;
}

/**
 * Returns the combatants that the client actually shows (and indexes turnIndex
 * into): those whose phase is in running_state.activePhases (default [1]),
 * in stored order. See EncounterRunner.tsx `visibleCombatants`.
 */
export function getVisibleCombatants(rs) {
  const combatants = Array.isArray(rs?.combatants) ? rs.combatants : [];
  const phases = Array.isArray(rs?.activePhases) && rs.activePhases.length > 0 ? rs.activePhases : [1];
  return combatants.filter((u) => phases.includes(u.phase || 1));
}

/**
 * Resolves the target encounter for a write tool call, given explicit args and
 * conversation context. Never reaches outside a known campaign: once
 * `context.campaignId` is known, only encounters belonging to that campaign are
 * considered. The "first encounter in the whole DB" fallback is used only when
 * no campaign is known at all (e.g. isolated tool tests).
 */
function resolveEncounterForWrite(args, context = {}) {
  const cols = 'id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config';
  let encounter = null;
  const encounterId = args.encounterId || context.encounterId;

  if (encounterId) {
    // (id, campaign_id) is the encounters primary key, so id alone is not unique.
    if (context.campaignId) {
      encounter = db
        .prepare(`SELECT ${cols} FROM encounters WHERE id = ? AND campaign_id = ?`)
        .get(encounterId, context.campaignId);
      if (!encounter && db.prepare('SELECT 1 FROM encounters WHERE id = ?').get(encounterId)) {
        throw new Error(
          `Encounter "${encounterId}" does not belong to the active campaign "${context.campaignId}".`
        );
      }
    } else {
      encounter = db.prepare(`SELECT ${cols} FROM encounters WHERE id = ?`).get(encounterId);
    }
    if (!encounter && args.encounterId) {
      // An explicitly supplied id that doesn't exist must not silently retarget
      // a different encounter.
      throw new Error(`Encounter "${args.encounterId}" was not found.`);
    }
  }

  if (!encounter && context.campaignId) {
    encounter =
      db.prepare(`SELECT ${cols} FROM encounters WHERE campaign_id = ? AND running_state IS NOT NULL ORDER BY id LIMIT 1`).get(context.campaignId) ||
      db.prepare(`SELECT ${cols} FROM encounters WHERE campaign_id = ? ORDER BY id LIMIT 1`).get(context.campaignId);
  }

  // Only reach outside the known campaign when no campaign is known at all.
  if (!encounter && !context.campaignId) {
    encounter =
      db.prepare(`SELECT ${cols} FROM encounters WHERE running_state IS NOT NULL ORDER BY id LIMIT 1`).get() ||
      db.prepare(`SELECT ${cols} FROM encounters ORDER BY id LIMIT 1`).get();
  }

  return encounter;
}

/**
 * Loads the current combatant roster for an encounter, preferring the live
 * running_state snapshot and falling back to the encounter_units table.
 * Attaches monster stat blocks (fullData) when missing so resistance/immunity
 * calculations can run.
 */
function loadEncounterCombatants(encounterId, runningStateJson, campaignId) {
  let allCombatants = [];
  if (runningStateJson) {
    try {
      const rs = JSON.parse(runningStateJson);
      if (Array.isArray(rs.combatants)) {
        allCombatants = rs.combatants.map((c) => ({
          instanceId: c.instanceId || c.id,
          name: c.name || 'Unknown',
          currentHp: c.currentHp,
          maxHp: c.maxHp,
          tempHp: c.tempHp || 0,
          initiative: c.initiative,
          isPlayer: !!c.isPlayer,
          faction: c.faction,
          monsterId: c.monsterId,
          fullData: c.fullData,
          position: c.position || null,
        }));
      }
    } catch {}
  }

  if (allCombatants.length === 0) {
    const units = db
      .prepare(
        `SELECT instanceId, name, currentHp, maxHp, tempHp, hpDice, dexMod, initiative, isPlayer, monsterId, faction, position_x, position_y FROM encounter_units WHERE encounter_id = ?${campaignId ? ' AND campaign_id = ?' : ''}`
      )
      .all(...(campaignId ? [encounterId, campaignId] : [encounterId]));
    allCombatants = units.map((u) => ({
      instanceId: u.instanceId,
      name: u.name || 'Unknown',
      currentHp: u.currentHp,
      maxHp: u.maxHp,
      tempHp: u.tempHp || 0,
      initiative: u.initiative,
      isPlayer: !!u.isPlayer,
      faction: u.faction,
      monsterId: u.monsterId,
      position: u.position_x !== null && u.position_y !== null ? { x: u.position_x, y: u.position_y } : null,
    }));
  }

  const monsterLookup = getMonsterLookup();
  for (const c of allCombatants) {
    if (!c.fullData && c.monsterId) {
      const found =
        monsterLookup.get(String(c.monsterId).toLowerCase()) ||
        (c.name ? monsterLookup.get(c.name.toLowerCase()) : undefined);
      if (found) {
        c.fullData = found;
      }
    }
  }

  return allCombatants;
}

/**
 * Resolves a combatant reference (instanceId preferred, name as fallback)
 * against a roster. Unlike a plain `find`, an ambiguous name match (multiple
 * combatants sharing the same or overlapping name) throws rather than
 * silently picking the first match, since the LLM commonly passes names for
 * encounters with repeated monster names (e.g. multiple "Goblin"s).
 */
function resolveCombatantRef(allCombatants, id, rawName) {
  if (id) {
    const byId = allCombatants.find((c) => c.instanceId === id);
    if (byId) return byId;
  }

  const name = (rawName || '').trim().replace(/@\w+\[.*?\]\{([^}]+)\}/g, '$1').trim().toLowerCase();
  if (!name) return null;

  const exact = allCombatants.filter((c) => (c.name || '').toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Combatant name "${rawName}" is ambiguous: ${exact.length} combatants share this name (${exact
        .map((c) => c.instanceId)
        .join(', ')}). Specify combatantId instead.`
    );
  }

  const partial = allCombatants.filter((c) => (c.name || '').toLowerCase().includes(name));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Combatant name "${rawName}" matches multiple combatants (${partial
        .map((c) => c.name)
        .join(', ')}). Specify combatantId instead.`
    );
  }

  return null;
}

/**
 * Shared combatant lookup for the read-only get_*_hp / get_entity_position
 * tools. Rejects empty references, then looks in the live running_state of the
 * scoped encounter(s) and finally the encounter_units table, using
 * resolveCombatantRef's exact -> partial -> ambiguity rules (ambiguous
 * references throw). Matching happens in JS, so no SQL LIKE wildcards from
 * the reference ever reach the database.
 *
 * @param {string} nameOrId
 * @param {{campaignId?: string, encounterId?: string}} scope
 * @param {(c: object) => boolean} [accept] Extra requirement on a match.
 * @returns {{combatant: object, encounterName: string|null, source: 'running_state'|'encounter_units'}|null}
 */
function lookupCombatantForRead(nameOrId, { campaignId, encounterId } = {}, accept = () => true) {
  const ref = typeof nameOrId === 'string' ? nameOrId.trim() : '';
  if (!ref) {
    throw new Error('name_or_id is required and must not be empty.');
  }

  let encQuery = 'SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL';
  const encParams = [];
  if (encounterId) {
    encQuery += ' AND id = ?';
    encParams.push(encounterId);
  }
  if (campaignId) {
    encQuery += ' AND campaign_id = ?';
    encParams.push(campaignId);
  }

  for (const enc of db.prepare(encQuery).all(...encParams)) {
    let rs;
    try {
      rs = JSON.parse(enc.running_state);
    } catch {
      continue;
    }
    if (!Array.isArray(rs?.combatants)) continue;
    const found = resolveCombatantRef(rs.combatants, ref, ref);
    if (found && accept(found)) {
      return { combatant: found, encounterName: enc.name, source: 'running_state' };
    }
  }

  let unitQuery =
    'SELECT instanceId, name, currentHp, maxHp, isPlayer, position_x, position_y FROM encounter_units';
  const unitParams = [];
  const unitConds = [];
  if (encounterId) {
    unitConds.push('encounter_id = ?');
    unitParams.push(encounterId);
  }
  if (campaignId) {
    unitConds.push('campaign_id = ?');
    unitParams.push(campaignId);
  }
  if (unitConds.length > 0) unitQuery += ` WHERE ${unitConds.join(' AND ')}`;
  const units = db
    .prepare(unitQuery)
    .all(...unitParams)
    .map((u) => ({
      instanceId: u.instanceId,
      name: u.name || 'Unknown',
      currentHp: u.currentHp,
      maxHp: u.maxHp,
      isPlayer: !!u.isPlayer,
      position: u.position_x !== null && u.position_y !== null ? { x: u.position_x, y: u.position_y } : null,
    }));
  const foundUnit = resolveCombatantRef(units, ref, ref);
  if (foundUnit && accept(foundUnit)) {
    return { combatant: foundUnit, encounterName: null, source: 'encounter_units' };
  }
  return null;
}

/**
 * Builds a fresh default running_state document for an encounter from its
 * encounter_units rows. Used consistently by every write tool so an
 * approval never implicitly starts combat or drops fields.
 */
function buildDefaultRunningState(encounterId, campaignId) {
  const allUnits = campaignId
    ? db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').all(encounterId, campaignId)
    : db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ?').all(encounterId);
  return {
    isCombatStarted: false,
    round: 1,
    turnIndex: 0,
    activePhases: [1],
    combatants: allUnits.map((u) => ({
      instanceId: u.instanceId,
      monsterId: u.monsterId,
      name: u.name,
      maxHp: u.maxHp,
      currentHp: u.currentHp,
      tempHp: u.tempHp || 0,
      dexMod: u.dexMod || 0,
      initiative: u.initiative,
      isPlayer: !!u.isPlayer,
      faction: u.faction || 'enemy',
      position:
        u.position_x !== null && u.position_y !== null ? { x: u.position_x, y: u.position_y } : null,
      phase: u.phase || 1,
    })),
    combatLog: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Builds the human-readable description for a set of damage/healing/temp_hp
 * projections. Used both when staging the proposal and, after re-projecting
 * against live state, when actually applying it at approval time — so the
 * DM-facing summary and the combat log always describe what was actually
 * applied, not a stale snapshot from staging time (see N-5/G-4).
 * @param {Array} projectedTargets
 * @param {Array<{combatantId?: string, combatantName?: string}>} [skippedTargets] targets that could not be found/applied
 */
function buildDamageDescription(projectedTargets, skippedTargets = []) {
  let description = '';
  if (projectedTargets.length === 1) {
    const p = projectedTargets[0];
    if (p.actionType === 'damage') {
      const dTypeStr = p.damageType ? ` ${p.damageType}` : '';
      const tempStr = p.currentTempHp > 0 ? ` (+${p.currentTempHp} temp)` : '';
      const projTempStr = p.projectedTempHp > 0 ? ` (+${p.projectedTempHp} temp)` : '';
      description = `Apply ${p.amount}${dTypeStr} damage to ${p.combatantName} (HP: ${p.currentHp}${tempStr} -> ${p.projectedHp}${projTempStr}).`;
    } else if (p.actionType === 'healing') {
      description = `Apply ${p.amount} healing to ${p.combatantName} (HP: ${p.currentHp} -> ${p.projectedHp} / ${p.maxHp}).`;
    } else if (p.actionType === 'temp_hp') {
      description = `Grant ${p.amount} temporary HP to ${p.combatantName} (Temp HP: ${p.currentTempHp} -> ${p.projectedTempHp}).`;
    }
  } else if (projectedTargets.length > 1) {
    const summaries = projectedTargets.map((p) => {
      const typeStr = p.damageType ? `${p.damageType} ` : '';
      return `${p.combatantName}: ${p.actionType} ${p.amount} ${typeStr}(HP ${p.currentHp} -> ${p.projectedHp})`;
    });
    description = `Apply combat effects to ${projectedTargets.length} combatants: ${summaries.join('; ')}.`;
  }

  if (skippedTargets.length > 0) {
    const skippedNames = skippedTargets.map((t) => t.combatantName || t.combatantId || 'unknown').join(', ');
    const skippedNote = `Skipped ${skippedTargets.length} target(s) no longer in the encounter: ${skippedNames}.`;
    description = description ? `${description} ${skippedNote}` : skippedNote;
  }

  return description;
}

/**
 * Campaign scope for a write handler. encounter_units and encounters are keyed
 * by (id, campaign_id), so a mutation must never run without a campaign.
 */
function requireExecutionCampaignId(executionPayload, context) {
  const campaignId = executionPayload?.campaignId || context?.campaignId;
  if (!campaignId) {
    throw new Error('Cannot execute write: no campaignId is available to scope the mutation.');
  }
  return campaignId;
}

/**
 * Reads and parses running_state for an encounter, falling back to a fresh
 * default document (built from encounter_units) when absent or corrupt.
 */
function readRunningStateOrDefault(encounterId, campaignId) {
  const enc = campaignId
    ? db.prepare('SELECT id, running_state FROM encounters WHERE id = ? AND campaign_id = ?').get(encounterId, campaignId)
    : db.prepare('SELECT id, running_state FROM encounters WHERE id = ?').get(encounterId);
  if (enc?.running_state) {
    try {
      const rs = JSON.parse(enc.running_state);
      if (rs && Array.isArray(rs.combatants)) return rs;
    } catch {}
  }
  return buildDefaultRunningState(encounterId, campaignId);
}

/**
 * Computes a stable hash of everything about an encounter that the
 * combatant write tools (move/damage/configure/remove/update) can change:
 * every encounter_units row plus the combat-progress fields of
 * running_state. Staged proposals capture this hash and it is recomputed at
 * approval time (see hitlManager.registerStateHasher) so an approval is
 * rejected if the state it targeted has actually changed in the meantime —
 * instead of relying on a fixed timer that would reject an untouched,
 * still-valid proposal just because the DM took a while to review it.
 */
export function computeEncounterStateHash(encounterId, campaignId) {
  if (!encounterId) return null;

  const units = db
    .prepare(
      `SELECT instanceId, name, monsterId, maxHp, currentHp, tempHp, initiative, isPlayer, position_x, position_y, phase, faction FROM encounter_units WHERE encounter_id = ?${campaignId ? ' AND campaign_id = ?' : ''} ORDER BY instanceId`
    )
    .all(...(campaignId ? [encounterId, campaignId] : [encounterId]));

  const enc = campaignId
    ? db.prepare('SELECT running_state FROM encounters WHERE id = ? AND campaign_id = ?').get(encounterId, campaignId)
    : db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
  let combatProgress = null;
  if (enc?.running_state) {
    try {
      const rs = JSON.parse(enc.running_state);
      combatProgress = {
        isCombatStarted: !!rs.isCombatStarted,
        round: rs.round ?? 1,
        turnIndex: rs.turnIndex ?? 0,
      };
    } catch {}
  }

  const canonical = JSON.stringify({ units, combatProgress });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// Grid coordinate/region helpers (columnIndexToLabel, coordinateToLabel,
// columnLabelToIndex, labelToCoordinate, calculateDistance, resolveRegionName,
// calculateAdjacencies) live in gridUtils.js (imported above) and are
// re-exported here so existing imports from toolController.js keep working.
// combatantParser.js imports the same module instead of keeping its own
// copies (see R-1: these used to be defined twice, so a fix like the
// columnIndexToLabel Infinity-loop guard had to be applied in both places
// by hand).
export {
  columnIndexToLabel,
  coordinateToLabel,
  columnLabelToIndex,
  labelToCoordinate,
  calculateDistance,
  resolveRegionName,
  calculateAdjacencies,
};

/**
 * Compact audit-log summary of a tool result. Strips bulky base64 image data
 * URIs so the audit log / console never contain (or slice through) image bytes.
 */
export function summarizeResultForAudit(result) {
  let text;
  try {
    text = JSON.stringify(result, (key, value) =>
      key === 'image' && typeof value === 'string' && value.startsWith('data:')
        ? '[image omitted]'
        : value
    );
  } catch {
    text = String(result);
  }
  return (text ?? '').slice(0, 200);
}

function isInsideDir(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolves a map URL to a local filesystem path. Only files inside public/
 * are ever returned; anything that resolves outside it (".." segments,
 * absolute paths) yields null.
 */
export function resolveMapFilePath(mapUrl) {
  if (!mapUrl || typeof mapUrl !== 'string') return null;
  const cleaned = mapUrl.split('?')[0].trim();
  if (!cleaned) return null;
  const basename = path.basename(cleaned);

  // 1. Direct file in public/maps
  if (basename) {
    const p1 = path.resolve(PUBLIC_MAPS_DIR, basename);
    if (isInsideDir(PUBLIC_MAPS_DIR, p1) && fs.existsSync(p1)) return p1;
  }

  // 2. Relative from public directory
  const relPath = cleaned.replace(/^[/\\]+/, '');
  const p2 = path.resolve(PUBLIC_DIR, relPath);
  if (isInsideDir(PUBLIC_DIR, p2) && fs.existsSync(p2)) return p2;

  return null;
}

/**
 * Retrieves grid metadata (cell pitch, offsets, columns, rows) for a given map URL.
 */
export function getMapGridData(mapUrl, encounter = null) {
  const mapGrids = getMapGrids();
  if (mapUrl) {
    const cleaned = mapUrl.split('?')[0].trim();
    const basename = path.basename(cleaned);
    const candidateKeys = [
      cleaned,
      `/maps/${basename}`,
      `maps/${basename}`,
      basename,
      `/${basename}`,
    ];

    for (const key of candidateKeys) {
      if (mapGrids[key]) {
        return {
          ...mapGrids[key],
          columns: mapGrids[key].columns || 20,
          rows: mapGrids[key].rows || 20,
        };
      }
    }
  }

  // Fallback to encounter grid_config or map_size if available
  let gridConfig = null;
  let mapSize = null;
  try {
    if (encounter?.grid_config) {
      gridConfig = typeof encounter.grid_config === 'string' ? JSON.parse(encounter.grid_config) : encounter.grid_config;
    }
    if (encounter?.map_size) {
      mapSize = typeof encounter.map_size === 'string' ? JSON.parse(encounter.map_size) : encounter.map_size;
    }
  } catch {}

  const columns = gridConfig?.columns || mapSize?.width || 20;
  const rows = gridConfig?.rows || mapSize?.height || 20;
  const cellPitch = gridConfig?.cellPitch || 50;
  const offsetX = gridConfig?.offsetX || 0;
  const offsetY = gridConfig?.offsetY || 0;

  return {
    columns,
    rows,
    cellPitch,
    offsetX,
    offsetY,
    imageWidth: gridConfig?.imageWidth || columns * cellPitch,
    imageHeight: gridConfig?.imageHeight || rows * cellPitch,
  };
}

/**
 * Escapes characters for safe inclusion in SVG XML text nodes and attributes.
 */
export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Composites SVG combatant tokens onto a base map image and produces an optimized PNG buffer.
 */
export async function generateAnnotatedMapImage({
  imagePath,
  gridData,
  combatants = [],
  includeCombatants = true,
}) {
  let metadata;
  try {
    metadata = await sharp(imagePath).metadata();
  } catch (err) {
    throw new Error(`Failed to read image metadata for "${imagePath}": ${err.message}`);
  }

  const width = metadata.width || gridData.imageWidth || 1000;
  const height = metadata.height || gridData.imageHeight || 1000;

  // If actual image dimensions differ from calibrated grid definition, scale pitch and offsets
  const scale = gridData.imageWidth ? width / gridData.imageWidth : 1;

  const cols = gridData.columns || 20;
  const rawPitch = gridData.cellPitch || Math.floor(width / cols);
  const cellPitch = rawPitch * scale;
  const offsetX = (gridData.offsetX || 0) * scale;
  const offsetY = (gridData.offsetY || 0) * scale;

  const validCombatants = includeCombatants
    ? combatants.filter((c) => c.position && typeof c.position.x === 'number' && typeof c.position.y === 'number')
    : [];

  let compositedBuffer;

  if (validCombatants.length > 0) {
    const tokenRadius = Math.max(14, Math.min(Math.floor(cellPitch * 0.42), 36));

    const tokenSvgElements = validCombatants
      .map((c, idx) => {
        const cx = Math.round(offsetX + c.position.x * cellPitch + cellPitch / 2);
        const cy = Math.round(offsetY + c.position.y * cellPitch + cellPitch / 2);
        const isPlayer = !!c.isPlayer;
        const fillColor = isPlayer ? '#0284c7' : '#e11d48';
        const strokeColor = isPlayer ? '#bae6fd' : '#fecdd3';
        const badgeColor = isPlayer ? '#0369a1' : '#be123c';
        const initial = escapeXml((c.name || 'U').slice(0, 2).toUpperCase());
        const coordLabel = coordinateToLabel(c.position.x, c.position.y);
        const rawLabel = `${c.name} [${coordLabel}]`;
        const displayLabel = rawLabel.length > 18 ? rawLabel.slice(0, 17) + '…' : rawLabel;
        const escapedDisplayLabel = escapeXml(displayLabel);
        const badgeWidth = Math.max(76, displayLabel.length * 8 + 12);

        return `
          <g id="token-${idx}">
            <circle cx="${cx + 2}" cy="${cy + 2}" r="${tokenRadius}" fill="rgba(0,0,0,0.5)" />
            <circle cx="${cx}" cy="${cy}" r="${tokenRadius}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${Math.max(2, Math.floor(tokenRadius * 0.12))}" />
            <text x="${cx}" y="${cy + Math.floor(tokenRadius * 0.35)}" font-family="Arial, sans-serif" font-size="${Math.floor(tokenRadius * 0.9)}" font-weight="bold" fill="#ffffff" text-anchor="middle">${initial}</text>
            <rect x="${cx - Math.floor(badgeWidth / 2)}" y="${cy - tokenRadius - 22}" width="${badgeWidth}" height="20" rx="4" fill="${badgeColor}" fill-opacity="0.92" stroke="#ffffff" stroke-width="1.5" />
            <text x="${cx}" y="${cy - tokenRadius - 8}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapedDisplayLabel}</text>
          </g>
        `;
      })
      .join('\n');

    const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${tokenSvgElements}
    </svg>`;

    const pngOverlay = await sharp(Buffer.from(svgOverlay)).png().toBuffer();

    compositedBuffer = await sharp(imagePath)
      .composite([{ input: pngOverlay }])
      .png()
      .toBuffer();
  } else {
    compositedBuffer = await sharp(imagePath)
      .png()
      .toBuffer();
  }

  // Constrain max dimensions to 1024x1024 to optimize transfer speed & VRAM budget (<8GB VRAM)
  const outputBuffer = await sharp(compositedBuffer)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .png({ quality: 80, compressionLevel: 8 })
    .toBuffer();

  const base64 = outputBuffer.toString('base64');
  return {
    base64,
    dataUri: `data:image/png;base64,${base64}`,
    mimeType: 'image/png',
    width,
    height,
  };
}

/**
 * Levenshtein distance with 1D row memory optimization.
 */
export function levenshteinDistance(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let str1 = a;
  let str2 = b;
  if (str1.length < str2.length) {
    str1 = b;
    str2 = a;
  }

  const len1 = str1.length;
  const len2 = str2.length;
  let prevRow = new Int32Array(len2 + 1);
  let currRow = new Int32Array(len2 + 1);

  for (let j = 0; j <= len2; j++) prevRow[j] = j;

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    const c1 = str1.charCodeAt(i - 1);
    for (let j = 1; j <= len2; j++) {
      const cost = c1 === str2.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }
  return prevRow[len2];
}

/**
 * Normalized string similarity score between 0.0 and 1.0.
 */
export function stringSimilarity(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  // Short-circuit if length difference already precludes high similarity
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff / maxLen > 0.65) {
    return (maxLen - lenDiff) / maxLen * 0.5;
  }

  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

/**
 * Name similarity that compares both full strings and individual words within a multi-word name.
 */
export function nameSimilarity(query, targetName) {
  const q = (query || '').toLowerCase().trim();
  const target = (targetName || '').toLowerCase().trim();
  if (!q || !target) return 0;
  if (q === target) return 1.0;

  let best = stringSimilarity(q, target);
  const words = target.split(/\s+/);
  for (const w of words) {
    if (w.length > 2) {
      const sim = stringSimilarity(q, w);
      if (sim > best) best = sim;
    }
  }

  // Slight length-difference penalty so closer-length matches win over verbose names
  const lengthPenalty = Math.min(0.15, Math.abs(target.length - q.length) * 0.005);
  return Math.max(0, best - lengthPenalty);
}

export function tokenizeQuery(query) {
  if (!query) return [];
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

/**
 * Token overlap ratio between query (or pre-tokenized query array) and target text.
 */
export function matchTokens(queryOrTokens, text) {
  if (!queryOrTokens || !text) return 0;
  const qTokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenizeQuery(queryOrTokens);
  if (qTokens.length === 0) return 0;
  const lowerText = text.toLowerCase();
  let matches = 0;
  for (const tok of qTokens) {
    if (lowerText.includes(tok)) matches++;
  }
  return matches / qTokens.length;
}

// In-memory audit log for executed tool calls
export const toolAuditLog = [];
const MAX_TOOL_AUDIT_LOG_ENTRIES = 2000;

/**
 * Appends to the audit log and trims it so it doesn't grow unbounded over a
 * long-running server process (see G-17).
 */
export function pushToolAuditLog(entry) {
  toolAuditLog.push(entry);
  if (toolAuditLog.length > MAX_TOOL_AUDIT_LOG_ENTRIES) {
    toolAuditLog.splice(0, toolAuditLog.length - MAX_TOOL_AUDIT_LOG_ENTRIES);
  }
}

export function clearToolAuditLog() {
  toolAuditLog.length = 0;
}

export function getToolAuditLog() {
  return [...toolAuditLog];
}

/**
 * Extracts all markdown headings (#, ##, ###) from a chapter text.
 */
export function parseChapterOutline(content) {
  if (!content || typeof content !== 'string') return [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      heading: match[2].trim(),
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }
  return headings;
}

/**
 * Resolves a chapter from SQLite based on explicit name/ID or context.
 */
export function resolveChapter(chapterIdentifier, context = {}) {
  const { campaignId, chapterId, chapterName } = context;
  const cols = 'id, campaign_id, title, content';

  // 1. If explicit identifier provided, it must resolve (scoped to the active
  // campaign when one is known) or we report what is available instead of
  // silently substituting a different chapter.
  if (chapterIdentifier && typeof chapterIdentifier === 'string' && chapterIdentifier.trim()) {
    const raw = chapterIdentifier.trim();
    const lower = raw.toLowerCase();

    let ch = campaignId
      ? db.prepare(`SELECT ${cols} FROM chapters WHERE id = ? AND campaign_id = ?`).get(raw, campaignId)
      : db.prepare(`SELECT ${cols} FROM chapters WHERE id = ?`).get(raw);
    if (ch) return ch;

    const scope = campaignId ? 'campaign_id = ? AND ' : '';
    const scopeParams = campaignId ? [campaignId] : [];

    ch = db.prepare(`SELECT ${cols} FROM chapters WHERE ${scope}LOWER(title) = ?`).get(...scopeParams, lower);
    if (ch) return ch;
    ch = db
      .prepare(`SELECT ${cols} FROM chapters WHERE ${scope}LOWER(title) LIKE ? ESCAPE '\\'`)
      .get(...scopeParams, `%${escapeLike(lower)}%`);
    if (ch) return ch;

    // Fuzzy title match
    const allChaps = campaignId
      ? db.prepare(`SELECT ${cols} FROM chapters WHERE campaign_id = ?`).all(campaignId)
      : db.prepare(`SELECT ${cols} FROM chapters`).all();
    let bestMatch = null;
    let bestScore = 0;
    for (const c of allChaps) {
      const sim = nameSimilarity(raw, c.title);
      if (sim > bestScore) {
        bestScore = sim;
        bestMatch = c;
      }
    }
    if (bestMatch && bestScore >= 0.4) {
      return bestMatch;
    }

    const available = allChaps.slice(0, 25).map((c) => `"${c.title}" (${c.id})`);
    throw new Error(
      `Chapter "${raw}" not found. ${
        available.length > 0 ? `Available chapters: ${available.join(', ')}.` : 'There are no chapters available.'
      }`
    );
  }

  // 2. Fall back to context.chapterId
  if (chapterId) {
    const ch = campaignId
      ? db.prepare(`SELECT ${cols} FROM chapters WHERE id = ? AND campaign_id = ?`).get(chapterId, campaignId)
      : db.prepare(`SELECT ${cols} FROM chapters WHERE id = ?`).get(chapterId);
    if (ch) return ch;
  }

  // 3. Fall back to context.chapterName
  if (chapterName) {
    if (campaignId) {
      const ch = db.prepare(`SELECT ${cols} FROM chapters WHERE campaign_id = ? AND LOWER(title) = ?`).get(campaignId, chapterName.toLowerCase());
      if (ch) return ch;
    } else {
      const ch = db.prepare(`SELECT ${cols} FROM chapters WHERE LOWER(title) = ?`).get(chapterName.toLowerCase());
      if (ch) return ch;
    }
  }

  // 4. Fall back to first chapter of the campaign
  if (campaignId) {
    return db.prepare(`SELECT ${cols} FROM chapters WHERE campaign_id = ? ORDER BY order_index LIMIT 1`).get(campaignId) || null;
  }

  // 5. Only when no campaign is known at all: any chapter in the database
  return db.prepare(`SELECT ${cols} FROM chapters ORDER BY id LIMIT 1`).get() || null;
}

/**
 * Tool definitions exposed to the OpenAI API (OpenAI tool format)
 */
export const READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_spell',
      description: 'Look up full details, casting time, components, range, and description of a D&D spell.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the spell to look up (e.g. "Fireball", "Shield", "Cure Wounds")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_monster',
      description: 'Look up official monster statistics, armor class, hit points, actions, and abilities.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the monster (e.g. "Goblin", "Adult Red Dragon", "Aboleth")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monster_hp',
      description: 'Look up the HP of a monster: retrieves live HP if the monster is in the active encounter, or default stat block HP from the monster manual.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name of the monster or combatant instanceId (e.g. "Goblin", "Adult Red Dragon").',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_character_hp',
      description: 'Read the authoritative live current and maximum HP of an active encounter combatant or character from the database.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or instanceId of the combatant/character.',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entity_position',
      description: 'Read the authoritative current X, Y combat map grid position of a combatant from the database.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or instanceId of the entity.',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_initiative_order',
      description: 'Fetch the active combat encounter initiative order and current combat turn from the database.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_asset',
      description: 'Look up a specific NPC, item, location, or lore asset from the active campaign, world lore, or chapters with typo tolerance.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or ID of the asset (e.g. "Elminster", "Sunless Citadel", "Goblin Chief").',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_magic_item',
      description: 'Look up official D&D magic item properties, rarity, attunement, notes, and rules description by name or fuzzy keywords.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the magic item (e.g. "Amulet of Health", "Bag of Holding", "Vorpal Sword")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_assets_and_lore',
      description: 'Fuzzy search across campaign assets, world lore, chapter notes, monsters, spells, and magic items. Resolves typos (e.g. "gobln", "fierball") and finds entities matching character sheet abilities, traits, or descriptions (e.g. "telepathic monster with tentacles", "staff of power", "healing tavern keeper").',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text, name typo, or descriptive character sheet keywords.',
          },
          category: {
            type: 'string',
            enum: ['all', 'monster', 'spell', 'magic_item', 'campaign_asset', 'world_asset', 'chapter'],
            description: 'Optional category filter to restrict search scope.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description:
        'Search the D&D knowledge base (monsters, spells, magic items, SRD rules, campaign lore) using vector semantic similarity. Ideal for conceptual, thematic, biome-based, or descriptive queries (e.g. "burrowing desert monsters", "fiery escape spells", "rules for underwater combat", "undead swamp ambushers").',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The conceptual, thematic, or descriptive search query (e.g. "desert monster that burrows into sand", "spells to slow down enemies").',
          },
          category: {
            type: 'string',
            enum: ['all', 'monster', 'spell', 'magic_item', 'srd', 'campaign_asset', 'world_asset', 'chapter'],
            description: 'Optional category filter to restrict search scope to a specific type of content.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5, max: 10).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_outline',
      description:
        'Extract and return the structural markdown outline (headings #, ##, ###) of a campaign chapter. Useful for exploring chapter sections and discovering maps, room keys, encounters, or notes.',
      parameters: {
        type: 'object',
        properties: {
          chapter_name_or_id: {
            type: 'string',
            description:
              'Optional chapter name or ID. If omitted, defaults to the active chapter in the current campaign context.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_chapter_section',
      description:
        'Read the specific text content under a chapter heading until the next heading of equal or higher level. Use this to read specific rooms, encounters, maps, or lore sections from a chapter.',
      parameters: {
        type: 'object',
        properties: {
          headingName: {
            type: 'string',
            description: 'Name of the heading/section to read (e.g. "Area 1: Entrance", "Tactical Map", "Boss Encounter").',
          },
          chapter_name_or_id: {
            type: 'string',
            description:
              'Optional chapter name or ID. If omitted, defaults to the active chapter in the current campaign context.',
          },
        },
        required: ['headingName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_map',
      description:
        'Retrieve an image and tactical layout of the current combat encounter map, including character and monster grid locations, coordinates, and visual token markers.',
      parameters: {
        type: 'object',
        properties: {
          include_combatants: {
            type: 'boolean',
            description:
              'Whether to include and visually annotate character and monster positions on the map. Defaults to true.',
          },
          version: {
            type: 'string',
            enum: ['dm', 'player'],
            description:
              'Whether to retrieve the DM version (with secret notes/room numbers) or Player version of the map. Defaults to "dm".',
          },
        },
      },
    },
  },
];

export const ASSISTANT_TOOLS = [...READ_TOOLS];
export const WRITE_TOOLS_REGISTRY = new Map();
export const WRITE_TOOL_NAMES = new Set();
export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.function.name));
export const ALLOWED_TOOL_NAMES = new Set(READ_TOOL_NAMES);

/**
 * Registers a write tool with the tool controller and HITL manager.
 * Guarantees that write tools stage proposals rather than executing direct state mutations.
 */
export function registerWriteTool(writeToolDef) {
  const name = writeToolDef?.name || writeToolDef?.function?.name;
  if (!name || typeof name !== 'string') {
    throw new Error('registerWriteTool: write tool must specify name or function.name');
  }
  if (typeof writeToolDef.stageProposal !== 'function') {
    throw new Error(`registerWriteTool: write tool "${name}" must define a stageProposal(args, context) function`);
  }
  if (typeof writeToolDef.executeMutation !== 'function') {
    throw new Error(`registerWriteTool: write tool "${name}" must define an executeMutation(payload, context) function`);
  }

  const fnObj = writeToolDef.function || {
    name: writeToolDef.name,
    description: writeToolDef.description,
    parameters: writeToolDef.parameters,
  };

  const toolObj = {
    type: 'function',
    function: fnObj,
    isWriteTool: true,
    payloadType: writeToolDef.payloadType || 'generic',
    stageProposal: writeToolDef.stageProposal,
    executeMutation: writeToolDef.executeMutation,
  };

  WRITE_TOOLS_REGISTRY.set(name, toolObj);
  WRITE_TOOL_NAMES.add(name);
  ALLOWED_TOOL_NAMES.add(name);

  // Register mutation handler directly with the centralized HITL manager
  hitlManager.registerExecutionHandler(name, async (execPayload, context) => {
    return await toolObj.executeMutation(execPayload, context);
  });

  // Optionally register a state-hash function so approval can detect and
  // reject a proposal whose underlying state has changed since staging
  // (see hitlManager.resolveProposal). Tools that don't provide one are
  // never rejected for staleness.
  if (typeof writeToolDef.getStateHash === 'function') {
    hitlManager.registerStateHasher(name, writeToolDef.getStateHash);
  }

  // Rebuild ASSISTANT_TOOLS export in place
  ASSISTANT_TOOLS.length = 0;
  ASSISTANT_TOOLS.push(
    ...READ_TOOLS,
    ...Array.from(WRITE_TOOLS_REGISTRY.values()).map((wt) => ({
      type: wt.type,
      function: wt.function,
    }))
  );

  return toolObj;
}

export function clearWriteTools(keepBuiltins = false) {
  for (const name of WRITE_TOOL_NAMES) {
    ALLOWED_TOOL_NAMES.delete(name);
  }
  WRITE_TOOLS_REGISTRY.clear();
  WRITE_TOOL_NAMES.clear();
  ASSISTANT_TOOLS.length = 0;
  ASSISTANT_TOOLS.push(...READ_TOOLS);
  if (keepBuiltins) {
    registerBuiltInWriteTools();
  }
}

export function isWriteTool(toolName) {
  return WRITE_TOOL_NAMES.has(toolName);
}

export function isReadTool(toolName) {
  return READ_TOOL_NAMES.has(toolName);
}

export const MOVE_COMBATANT_TOOL_DEF = {
  name: 'move_combatant',
  description:
    'Propose moving a combatant (player character or monster) to a new grid position on the encounter battlemap. Stages a Human-in-the-Loop confirmation proposal with origin/destination coordinates, map region names, and adjacent allies/enemies.',
  payloadType: 'movement',
  getStateHash: (context) => computeEncounterStateHash(context.encounterId, context.campaignId),
  parameters: {
    type: 'object',
    properties: {
      combatantId: {
        type: 'string',
        description: 'The unique instanceId of the combatant to move.',
      },
      combatantName: {
        type: 'string',
        description: 'The name of the combatant to move (e.g. "Grog Strongjaw" or "Sahuagin Raider 1").',
      },
      destination: {
        type: 'string',
        description: 'The target destination grid coordinate label (e.g. "A1", "M9", "Q2") or "x,y" coordinates.',
      },
      encounterId: {
        type: 'string',
        description: 'The ID of the encounter. Optional if active encounter can be inferred from context.',
      },
    },
    required: ['destination'],
  },
  stageProposal: async (args, context = {}) => {
    // 1. Resolve encounter (never leaves a known campaign; see resolveEncounterForWrite)
    const encounter = resolveEncounterForWrite(args, context);
    if (!encounter) {
      throw new Error('No encounter found for move_combatant. Please specify a valid encounterId.');
    }
    const encounterId = encounter.id;

    // 2. Gather combatants
    const allCombatants = loadEncounterCombatants(encounterId, encounter.running_state, encounter.campaign_id);

    // 3. Find the moving combatant. No id or name supplied is an explicit error
    // rather than a silent guess (previously defaulted to allCombatants[0]).
    if (!args.combatantId && !args.combatantName) {
      throw new Error(
        'move_combatant: either combatantId or combatantName is required to identify which combatant to move.'
      );
    }
    const movingUnit = resolveCombatantRef(allCombatants, args.combatantId, args.combatantName);
    if (!movingUnit) {
      throw new Error(
        `Combatant "${args.combatantName || args.combatantId || 'unknown'}" not found in encounter "${encounter.name || encounterId}".`
      );
    }

    // 4. Resolve origin. A combatant with no recorded position is not on the
    // grid yet; say so explicitly rather than silently treating it as {0,0}.
    const wasUnplaced = !movingUnit.position;
    const origin = movingUnit.position || { x: 0, y: 0 };
    const originLabel = wasUnplaced ? 'not yet placed on the grid' : coordinateToLabel(origin.x, origin.y);

    // 5. Parse destination
    let destCoord = null;
    if (typeof args.destination === 'object' && args.destination !== null) {
      destCoord = { x: Number(args.destination.x), y: Number(args.destination.y) };
    } else {
      destCoord = labelToCoordinate(String(args.destination));
    }
    if (destCoord.x < 0 || destCoord.y < 0 || !Number.isFinite(destCoord.x) || !Number.isFinite(destCoord.y)) {
      throw new Error(`Invalid destination coordinates: { x: ${destCoord.x}, y: ${destCoord.y} }. Coordinates must be non-negative finite numbers.`);
    }

    // 6. Resolve regions and grid bounds
    const selectedMapUrl = encounter.dm_map_url || encounter.player_map_url;
    const gridData = getMapGridData(selectedMapUrl, encounter);

    if (
      gridData &&
      Number.isFinite(gridData.columns) &&
      Number.isFinite(gridData.rows) &&
      (destCoord.x >= gridData.columns || destCoord.y >= gridData.rows)
    ) {
      throw new Error(
        `Destination coordinates { x: ${destCoord.x}, y: ${destCoord.y} } are outside the ${gridData.columns}x${gridData.rows} map grid.`
      );
    }

    const destLabel = coordinateToLabel(destCoord.x, destCoord.y);
    let regions = gridData?.regions || null;
    if (!regions) {
      try {
        if (encounter.grid_config) {
          const gc = typeof encounter.grid_config === 'string' ? JSON.parse(encounter.grid_config) : encounter.grid_config;
          regions = gc.regions || null;
        }
        if (!regions && encounter.map_size) {
          const ms = typeof encounter.map_size === 'string' ? JSON.parse(encounter.map_size) : encounter.map_size;
          regions = ms.regions || null;
        }
      } catch {}
    }

    const originRegionName = resolveRegionName(origin, regions);
    const destRegionName = resolveRegionName(destCoord, regions);

    // 7. Calculate adjacencies
    const originAdjacencies = calculateAdjacencies(origin, movingUnit, allCombatants);
    const destinationAdjacencies = calculateAdjacencies(destCoord, movingUnit, allCombatants);

    const originRegionStr = originRegionName ? ` (${originRegionName})` : '';
    const destRegionStr = destRegionName ? ` (${destRegionName})` : '';
    const description = `Move ${movingUnit.name} from ${originLabel}${originRegionStr} to ${destLabel}${destRegionStr}.`;

    const proposalPayload = {
      combatantId: movingUnit.instanceId,
      combatantName: movingUnit.name,
      origin: {
        x: origin.x,
        y: origin.y,
        label: originLabel,
        regionName: originRegionName || undefined,
      },
      destination: {
        x: destCoord.x,
        y: destCoord.y,
        label: destLabel,
        regionName: destRegionName || undefined,
      },
      originAdjacencies,
      destinationAdjacencies,
    };

    const executionPayload = {
      encounterId: encounter.id,
      campaignId: encounter.campaign_id,
      combatantId: movingUnit.instanceId,
      combatantName: movingUnit.name,
      destination: destCoord,
      destinationLabel: destLabel,
    };

    const proposal = hitlManager.createProposal({
      toolName: 'move_combatant',
      description,
      payloadType: 'movement',
      payload: proposalPayload,
      executionPayload,
      stateHash: computeEncounterStateHash(encounterId, encounter.campaign_id),
      affectedIds: [movingUnit.instanceId],
      context: {
        campaignId: encounter.campaign_id,
        encounterId: encounter.id,
      },
    });

    return {
      proposal,
      summary: description,
    };
  },
  executeMutation: async (executionPayload, context = {}) => {
    const { encounterId, combatantId, combatantName, destination } = executionPayload;
    const { x, y } = destination;
    const campaignId = requireExecutionCampaignId(executionPayload, context);

    const updateTx = db.transaction(() => {
      // 1. Update encounter_units table
      db.prepare(
        'UPDATE encounter_units SET position_x = ?, position_y = ? WHERE instanceId = ? AND campaign_id = ? AND encounter_id = ?'
      ).run(x, y, combatantId, campaignId, encounterId);

      // 2. Update encounters.running_state
      const enc = db.prepare('SELECT id, running_state FROM encounters WHERE id = ? AND campaign_id = ?').get(encounterId, campaignId);
      if (enc) {
        let rs = null;
        if (enc.running_state) {
          try {
            const parsed = JSON.parse(enc.running_state);
            if (parsed && Array.isArray(parsed.combatants)) rs = parsed;
          } catch {}
        }
        if (!rs) {
          // Initialize running_state with all units from encounter_units
          rs = buildDefaultRunningState(encounterId, campaignId);
        }

        let found = false;
        // Match strictly on instanceId: name-based matching at execution time
        // would move every same-named combatant to the same cell (see G-7).
        rs.combatants = rs.combatants.map((c) => {
          if (c.instanceId === combatantId) {
            found = true;
            return {
              ...c,
              position: { x, y },
            };
          }
          return c;
        });
        if (!found) {
          // The combatant exists in encounter_units but hadn't yet appeared in
          // running_state; pull its real stats rather than pushing a bare
          // stub with no HP.
          const unitRow = db.prepare('SELECT * FROM encounter_units WHERE instanceId = ? AND campaign_id = ?').get(combatantId, campaignId);
          rs.combatants.push({
            instanceId: combatantId,
            monsterId: unitRow?.monsterId,
            name: unitRow?.name || combatantName || 'Unknown',
            maxHp: unitRow?.maxHp,
            currentHp: unitRow?.currentHp,
            tempHp: unitRow?.tempHp || 0,
            dexMod: unitRow?.dexMod || 0,
            initiative: unitRow?.initiative,
            isPlayer: !!unitRow?.isPlayer,
            faction: unitRow?.faction || 'enemy',
            phase: unitRow?.phase || 1,
            position: { x, y },
          });
        }
        rs.updatedAt = new Date().toISOString();

        db.prepare('UPDATE encounters SET running_state = ? WHERE id = ? AND campaign_id = ?').run(
          JSON.stringify(rs),
          encounterId,
          campaignId
        );
      }

      // Return updated combatant
      const updatedUnit = db.prepare('SELECT * FROM encounter_units WHERE instanceId = ? AND campaign_id = ?').get(combatantId, campaignId);
      return updatedUnit || { instanceId: combatantId, name: combatantName, position_x: x, position_y: y };
    });

    const updatedCombatant = updateTx();
    const destLabel = coordinateToLabel(x, y);

    return {
      executionSummary: `Moved ${combatantName || combatantId} to ${destLabel}.`,
      updatedState: {
        combatantId,
        combatantName,
        position: { x, y },
        destinationLabel: destLabel,
        encounterId,
      },
      combatant: updatedCombatant,
    };
  },
};

export const APPLY_COMBAT_DAMAGE_TOOL_DEF = {
  name: 'apply_combat_damage',
  description:
    'Propose applying damage, healing, or temporary HP to one or more combatants in the active combat encounter. Stages a Human-in-the-Loop confirmation proposal previewing current vs projected HP, temp HP absorption, and resistances before committing.',
  payloadType: 'damage',
  getStateHash: (context) => computeEncounterStateHash(context.encounterId, context.campaignId),
  parameters: {
    type: 'object',
    properties: {
      encounterId: {
        type: 'string',
        description: 'The ID of the encounter. Optional if active encounter can be inferred from context.',
      },
      targets: {
        type: 'array',
        description: 'List of target combatants to apply damage, healing, or temporary HP to.',
        items: {
          type: 'object',
          properties: {
            combatantId: {
              type: 'string',
              description: 'The unique instanceId of the combatant.',
            },
            combatantName: {
              type: 'string',
              description: 'The name of the combatant (e.g. "Grog Strongjaw" or "Goblin 1").',
            },
            amount: {
              type: 'number',
              description: 'The amount of damage, healing, or temporary HP to apply.',
            },
            actionType: {
              type: 'string',
              enum: ['damage', 'healing', 'temp_hp'],
              description: 'The type of action: damage, healing, or temp_hp.',
            },
            type: {
              type: 'string',
              enum: ['damage', 'healing', 'temp_hp'],
              description: 'Alias for actionType.',
            },
            damageType: {
              type: 'string',
              description: 'Optional damage type (e.g. "fire", "slashing", "cold", "radiant") for calculating resistances or immunities.',
            },
          },
          required: ['amount'],
        },
      },
    },
    required: ['targets'],
  },
  stageProposal: async (args, context = {}) => {
    // 1. Resolve encounter (never leaves a known campaign; see resolveEncounterForWrite)
    const encounter = resolveEncounterForWrite(args, context);
    if (!encounter) {
      throw new Error('No encounter found for apply_combat_damage. Please specify a valid encounterId.');
    }
    const encounterId = encounter.id;

    // 2. Gather combatants
    const allCombatants = loadEncounterCombatants(encounterId, encounter.running_state, encounter.campaign_id);

    // 3. Process targets. Entries are applied in order against a working copy
    // of each combatant's HP so the same target appearing twice in one call
    // (e.g. temp HP followed by damage) accumulates correctly instead of
    // each entry projecting from the same starting HP (see G-5).
    if (!args.targets || !Array.isArray(args.targets) || args.targets.length === 0) {
      throw new Error('apply_combat_damage: targets must be a non-empty array.');
    }

    const projectedTargets = [];

    for (const rawTarget of args.targets) {
      const targetId = rawTarget.combatantId || rawTarget.instanceId || rawTarget.id;
      const targetName = rawTarget.combatantName || rawTarget.name;

      const matchedCombatant = resolveCombatantRef(allCombatants, targetId, targetName);
      if (!matchedCombatant) {
        throw new Error(
          `Combatant "${rawTarget.combatantName || rawTarget.combatantId || 'unknown'}" not found in encounter "${encounter.name || encounterId}".`
        );
      }

      const actionType = rawTarget.actionType || rawTarget.type || 'damage';
      const amount = Number(rawTarget.amount) || 0;
      const damageType = rawTarget.damageType;

      const projection = projectHpApplication(matchedCombatant, actionType, amount, damageType);
      projectedTargets.push(projection);

      // Feed this projection's result back into the working copy so a
      // subsequent entry for the same combatant in this call sees it.
      matchedCombatant.currentHp = projection.projectedHp;
      matchedCombatant.tempHp = projection.projectedTempHp;
    }

    // 4. Construct human-readable description
    const description = buildDamageDescription(projectedTargets);

    const proposalPayload = {
      encounterId: encounter.id,
      targets: projectedTargets,
    };

    // Store the raw delta inputs (id, actionType, amount, damageType) rather
    // than the projected HP baked in at staging time. Approval re-projects
    // against whatever the combatant's HP actually is at that moment, so a
    // change that happens between staging and approval (a manual edit,
    // another approved proposal) is not silently overwritten (see G-4).
    const executionTargets = projectedTargets.map((p) => ({
      combatantId: p.combatantId,
      combatantName: p.combatantName,
      actionType: p.actionType,
      amount: p.amount,
      damageType: p.damageType,
    }));

    const executionPayload = {
      encounterId: encounter.id,
      campaignId: encounter.campaign_id,
      targets: executionTargets,
      summary: description,
    };

    const proposal = hitlManager.createProposal({
      toolName: 'apply_combat_damage',
      description,
      payloadType: 'damage',
      payload: proposalPayload,
      executionPayload,
      stateHash: computeEncounterStateHash(encounterId, encounter.campaign_id),
      affectedIds: executionTargets.map((t) => t.combatantId),
      context: {
        campaignId: encounter.campaign_id,
        encounterId: encounter.id,
      },
    });

    return {
      proposal,
      summary: description,
    };
  },
  executeMutation: async (executionPayload, context = {}) => {
    const { encounterId, targets } = executionPayload;
    const campaignId = requireExecutionCampaignId(executionPayload, context);

    const updateTx = db.transaction(() => {
      // Re-project against whatever HP the combatants actually have right
      // now, not the HP snapshot captured when the proposal was staged, so a
      // change that happened in between (a manual edit, another approved
      // proposal) is not silently overwritten. See G-4.
      const rs = readRunningStateOrDefault(encounterId, campaignId);
      const liveCombatants = loadEncounterCombatants(encounterId, JSON.stringify(rs), campaignId);

      const finalTargets = [];
      const skippedTargets = [];
      for (const t of targets) {
        // Match strictly on instanceId (resolved once at staging time); see G-7.
        const matched = liveCombatants.find((c) => c.instanceId === t.combatantId);
        if (!matched) {
          // The combatant was removed between staging and approval. Report
          // this in the summary rather than silently dropping it (see N-5).
          skippedTargets.push(t);
          continue;
        }
        const projection = projectHpApplication(matched, t.actionType, t.amount, t.damageType);
        finalTargets.push(projection);
        // Accumulate so repeated entries for the same combatant in one call apply in order (G-5).
        matched.currentHp = projection.projectedHp;
        matched.tempHp = projection.projectedTempHp;
      }

      // Rebuild the summary from what was actually applied just now, not the
      // stale sentence captured at staging time (see N-5): if HP changed
      // between staging and approval, the DM would otherwise be shown
      // "HP: 10 -> 7" while the DB now says 4.
      const finalSummary = buildDamageDescription(finalTargets, skippedTargets);

      // 1. Update encounter_units table in SQLite
      const updateUnitStmt = db.prepare(
        'UPDATE encounter_units SET currentHp = ?, tempHp = ? WHERE instanceId = ? AND campaign_id = ? AND encounter_id = ?'
      );
      for (const t of finalTargets) {
        updateUnitStmt.run(t.projectedHp, t.projectedTempHp, t.combatantId, campaignId, encounterId);
      }

      // 2. Update encounters.running_state in SQLite
      for (const t of finalTargets) {
        const match = rs.combatants.find((c) => c.instanceId === t.combatantId);
        if (match) {
          match.currentHp = t.projectedHp;
          match.tempHp = t.projectedTempHp;
        }
      }

      // 3. Log event in combat log
      if (!Array.isArray(rs.combatLog)) {
        rs.combatLog = [];
      }
      rs.combatLog.push({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type: 'combat_damage',
        description: finalSummary,
        targets: finalTargets.map((t) => ({
          combatantId: t.combatantId,
          combatantName: t.combatantName,
          actionType: t.actionType,
          damageType: t.damageType,
          amount: t.amount,
          previousHp: t.currentHp,
          newHp: t.projectedHp,
          previousTempHp: t.currentTempHp,
          newTempHp: t.projectedTempHp,
          effectiveChange: t.effectiveChange,
        })),
      });

      rs.updatedAt = new Date().toISOString();
      db.prepare('UPDATE encounters SET running_state = ? WHERE id = ? AND campaign_id = ?').run(
        JSON.stringify(rs),
        encounterId,
        campaignId
      );

      // Return refreshed units
      return {
        units: db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').all(encounterId, campaignId),
        finalTargets,
        skippedTargets,
        finalSummary,
      };
    });

    const { units: updatedUnits, finalTargets, skippedTargets, finalSummary } = updateTx();

    return {
      executionSummary: finalSummary || `Applied HP changes to ${finalTargets.length} combatant(s).`,
      updatedState: {
        encounterId,
        targets: finalTargets,
        skippedTargets: skippedTargets.length > 0 ? skippedTargets : undefined,
      },
      units: updatedUnits,
    };
  },
};

export const CONFIGURE_ENCOUNTER_COMBATANTS_TOOL_DEF = {
  name: 'configure_encounter_combatants',
  description:
    'Analyze scenario/chapter text or structured combatant list to configure participating combatants, starting map coordinates, and encounter phases (e.g. Phase 1 initial wave, Phase 2 reinforcements). Stages a Human-in-the-Loop confirmation proposal before mutating the database or encounter state.',
  payloadType: 'combatant_config',
  getStateHash: (context) => computeEncounterStateHash(context.encounterId, context.campaignId),
  parameters: {
    type: 'object',
    properties: {
      scenarioText: {
        type: 'string',
        description: 'Narrative or chapter text detailing combatants, waves, and starting positions.',
      },
      combatants: {
        type: 'array',
        description: 'Explicit structured combatants array with name, monsterId, coordinates, phase, and faction.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            monsterId: { type: 'string' },
            coordinates: { type: 'string' },
            phase: { type: 'integer' },
            faction: { type: 'string', enum: ['ally', 'enemy', 'neutral'] },
            hp: { type: 'integer' },
          },
          required: ['name', 'coordinates'],
        },
      },
      encounterId: {
        type: 'string',
        description: 'The target encounter ID. Optional if resolvable from active context.',
      },
    },
  },
  stageProposal: async (args, context = {}) => {
    // 1. Resolve encounter (never leaves a known campaign; see resolveEncounterForWrite)
    const encounter = resolveEncounterForWrite(args, context);
    if (!encounter) {
      throw new Error(
        'No encounter found for configure_encounter_combatants. Please specify a valid encounterId.'
      );
    }
    const encounterId = encounter.id;

    // 2. Resolve grid bounds/regions. Prefer the calibrated map_grids.json
    // entry for the encounter's actual map (same source move_combatant
    // uses) over encounter.grid_config, which is frequently absent or
    // stale and would otherwise silently default bounds to 50x50 (see G-12).
    const selectedMapUrl = encounter.dm_map_url || encounter.player_map_url;
    const gridData = getMapGridData(selectedMapUrl, encounter);
    const gridConfig = { columns: gridData.columns, rows: gridData.rows };
    let regions = gridData?.regions || [];

    const occupiedCells = new Set();
    const existingUnits = db
      .prepare('SELECT position_x, position_y FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?')
      .all(encounterId, encounter.campaign_id);
    for (const u of existingUnits) {
      if (u.position_x !== null && u.position_y !== null) {
        occupiedCells.add(`${u.position_x},${u.position_y}`);
      }
    }

    // 3. Extract combatants from scenarioText OR explicit combatants. Both
    // being supplied at once is a common LLM pattern (it narrates the scene
    // and also lists the roster it just described); honoring both would
    // double the roster, so the explicit structured list wins when present.
    const finalCombatants = [];
    const monstersList = getMonsters();
    const hasExplicitCombatants = Array.isArray(args.combatants) && args.combatants.length > 0;

    if (!hasExplicitCombatants && args.scenarioText) {
      const parsed = parseScenarioCombatants(args.scenarioText, encounter, monstersList, occupiedCells, gridData);
      finalCombatants.push(...parsed);
    }

    if (hasExplicitCombatants) {
      if (args.combatants.length > MAX_CONFIGURED_COMBATANTS) {
        throw new Error(
          `Too many combatants (${args.combatants.length}); at most ${MAX_CONFIGURED_COMBATANTS} may be configured in one proposal.`
        );
      }
      for (const raw of args.combatants) {
        if (!raw || typeof raw !== 'object') {
          throw new Error('Invalid combatant entry: must be an object.');
        }
        if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) {
          throw new Error('Invalid combatant: name is required and must be a non-empty string.');
        }
        if (!raw.coordinates) {
          throw new Error(`Invalid combatant "${raw.name}": coordinates are required.`);
        }

        let pos;
        if (typeof raw.coordinates === 'string') {
          pos = labelToCoordinate(raw.coordinates);
        } else if (
          typeof raw.coordinates === 'object' &&
          raw.coordinates.x !== undefined &&
          raw.coordinates.y !== undefined
        ) {
          pos = { x: Number(raw.coordinates.x), y: Number(raw.coordinates.y) };
        } else {
          throw new Error(`Invalid coordinates for combatant "${raw.name}".`);
        }

        if (
          !Number.isFinite(pos.x) ||
          !Number.isFinite(pos.y) ||
          pos.x < 0 ||
          pos.y < 0
        ) {
          throw new Error(
            `Invalid coordinates for combatant "${raw.name}": { x: ${pos.x}, y: ${pos.y} } must be non-negative finite numbers.`
          );
        }

        const phase = raw.phase !== undefined ? parseInt(raw.phase, 10) : 1;
        if (isNaN(phase) || phase < 1) {
          throw new Error(`Invalid phase ${raw.phase} for combatant "${raw.name}". Phase must be >= 1.`);
        }

        const faction = ['ally', 'enemy', 'neutral'].includes(raw.faction) ? raw.faction : 'enemy';

        const allocated = allocateTokenCoordinates(pos, occupiedCells, gridConfig);
        const label = allocated.label || coordinateToLabel(allocated.x, allocated.y);
        const regionName = resolveRegionName(allocated, regions);

        let hp;
        if (raw.hp !== undefined && raw.hp !== null && raw.hp !== '') {
          hp = Number(raw.hp);
          if (!Number.isInteger(hp) || hp < 1 || hp > MAX_COMBATANT_HP) {
            throw new Error(
              `Invalid hp ${JSON.stringify(raw.hp)} for combatant "${raw.name}": hp must be a positive integer no greater than ${MAX_COMBATANT_HP}.`
            );
          }
        }
        let dexMod = 0;
        let hpDice = null;
        let monsterType = raw.monsterType || raw.name;
        let monsterId = raw.monsterId;

        if (monsterId || raw.name) {
          const matched = findMonster(monsterId || raw.name, monstersList);
          if (matched) {
            if (!hp) hp = matched.attributes?.hp?.value || 10;
            dexMod = matched.stats?.DEX?.modifier ?? matched.stats?.dex?.modifier ?? 0;
            hpDice = matched.attributes?.hp?.dice || null;
            monsterType = matched.name;
            if (!monsterId) monsterId = matched.id;
          }
        }

        if (!hp) hp = 10;

        finalCombatants.push({
          name: raw.name.trim(),
          monsterId: monsterId || undefined,
          monsterType,
          coordinates: {
            x: allocated.x,
            y: allocated.y,
            label,
            regionName: regionName || undefined,
          },
          phase,
          faction,
          hp,
          hpDice,
          dexMod,
        });
      }
    }

    if (hasExplicitCombatants) {
      numberDuplicateCombatantNames(finalCombatants);
    }

    if (finalCombatants.length === 0) {
      throw new Error(
        'No combatants could be identified or configured. Please supply scenarioText or an explicit combatants array.'
      );
    }

    // Validate phases
    for (const c of finalCombatants) {
      if (typeof c.phase !== 'number' || isNaN(c.phase) || c.phase < 1) {
        throw new Error(`Invalid phase ${c.phase}: Phase must be a positive integer (>= 1).`);
      }
    }

    const uniquePhases = new Set(finalCombatants.map((c) => c.phase));
    const phaseSummary = Array.from(uniquePhases)
      .sort((a, b) => a - b)
      .map((p) => formatPhaseLabel(p))
      .join(', ');

    const description = `Configure ${finalCombatants.length} combatant(s) across ${uniquePhases.size} phase(s) (${phaseSummary}) for encounter "${encounter.name}"`;

    const proposalPayload = {
      encounterId: encounter.id,
      encounterName: encounter.name,
      scenarioTextSummary: args.scenarioText
        ? args.scenarioText.length > 120
          ? args.scenarioText.slice(0, 117) + '...'
          : args.scenarioText
        : undefined,
      combatants: finalCombatants,
    };

    const executionPayload = {
      encounterId: encounter.id,
      campaignId: encounter.campaign_id,
      combatants: finalCombatants.map((c, idx) => ({
        instanceId: `unit_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        encounterId: encounter.id,
        campaignId: encounter.campaign_id,
        monsterId: c.monsterId || null,
        name: c.name,
        maxHp: c.hp,
        currentHp: c.hp,
        tempHp: 0,
        hpDice: c.hpDice || null,
        dexMod: c.dexMod || 0,
        initiative: null,
        passivePerception: 10,
        isPlayer: 0,
        position_x: c.coordinates.x,
        position_y: c.coordinates.y,
        phase: c.phase || 1,
        faction: c.faction || 'enemy',
        monsterType: c.monsterType,
      })),
      summary: description,
    };

    const proposal = hitlManager.createProposal({
      toolName: 'configure_encounter_combatants',
      description,
      payloadType: 'combatant_config',
      payload: proposalPayload,
      executionPayload,
      stateHash: computeEncounterStateHash(encounterId, encounter.campaign_id),
      // Always adds brand-new combatants with freshly generated instanceIds
      // at execution time — it never reads or writes an existing
      // combatant's state, so it can never collide with another pending
      // proposal by id. An empty (not null) array here is a deliberate
      // "touches nothing existing" declaration, not "unknown".
      affectedIds: [],
      context: {
        campaignId: encounter.campaign_id,
        encounterId: encounter.id,
      },
    });

    return {
      proposal,
      summary: description,
    };
  },
  executeMutation: async (executionPayload, context = {}) => {
    const { encounterId, combatants, summary } = executionPayload;
    const campaignId = requireExecutionCampaignId(executionPayload, context);

    const updateTx = db.transaction(() => {
      // 1. Insert units into encounter_units in SQLite
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO encounter_units (
          instanceId, encounter_id, campaign_id, monsterId, name,
          maxHp, currentHp, tempHp, hpDice, dexMod, initiative,
          passivePerception, isPlayer, position_x, position_y, phase, faction
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `);

      for (const u of combatants) {
        insertStmt.run(
          u.instanceId,
          u.encounterId || encounterId,
          campaignId,
          u.monsterId,
          u.name,
          u.maxHp,
          u.currentHp,
          u.tempHp || 0,
          u.hpDice,
          u.dexMod || 0,
          u.initiative,
          u.passivePerception || 10,
          u.isPlayer || 0,
          u.position_x,
          u.position_y,
          u.phase || 1,
          u.faction || 'enemy'
        );
      }

      // 2. Update encounters.running_state in SQLite
      const enc = db
        .prepare('SELECT id, running_state FROM encounters WHERE id = ? AND campaign_id = ?')
        .get(encounterId, campaignId);

      if (enc) {
        let rs = null;
        if (enc.running_state) {
          try {
            rs = JSON.parse(enc.running_state);
          } catch {}
        }

        if (!rs || !Array.isArray(rs.combatants)) {
          rs = buildDefaultRunningState(encounterId, campaignId);
        } else {
          const existingIds = new Set(rs.combatants.map((c) => c.instanceId || c.id));
          for (const u of combatants) {
            if (!existingIds.has(u.instanceId)) {
              rs.combatants.push({
                instanceId: u.instanceId,
                monsterId: u.monsterId,
                name: u.name,
                maxHp: u.maxHp,
                currentHp: u.currentHp,
                tempHp: u.tempHp || 0,
                dexMod: u.dexMod || 0,
                initiative: u.initiative,
                isPlayer: !!u.isPlayer,
                faction: u.faction || 'enemy',
                position:
                  u.position_x !== null && u.position_y !== null
                    ? { x: u.position_x, y: u.position_y }
                    : null,
                phase: u.phase || 1,
              });
              existingIds.add(u.instanceId);
            }
          }
        }

        // 3. Log event in combat log
        if (!Array.isArray(rs.combatLog)) {
          rs.combatLog = [];
        }
        rs.combatLog.push({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toISOString(),
          type: 'combatants_configured',
          description: summary,
          combatantCount: combatants.length,
        });

        rs.updatedAt = new Date().toISOString();
        db.prepare('UPDATE encounters SET running_state = ? WHERE id = ? AND campaign_id = ?').run(
          JSON.stringify(rs),
          encounterId,
          campaignId
        );
      }

      return db.prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?').all(encounterId, campaignId);
    });

    const allUnits = updateTx();

    return {
      executionSummary: summary || `Configured ${combatants.length} combatant(s).`,
      updatedState: {
        encounterId,
        combatants,
      },
      units: allUnits,
    };
  },
};

export const REMOVE_COMBATANT_TOOL_DEF = {
  name: 'remove_combatant',
  description:
    'Propose removing a single combatant (player character or monster) entirely from the active combat encounter — off the map and out of the initiative order. Use this for precisely deleting one unit; use configure_encounter_combatants to set up a whole roster instead. Stages a Human-in-the-Loop confirmation proposal showing exactly which combatant will be removed before committing.',
  payloadType: 'generic',
  getStateHash: (context) => computeEncounterStateHash(context.encounterId, context.campaignId),
  parameters: {
    type: 'object',
    properties: {
      combatantId: {
        type: 'string',
        description: 'The unique instanceId of the combatant to remove.',
      },
      combatantName: {
        type: 'string',
        description: 'The name of the combatant to remove (e.g. "Goblin 2").',
      },
      encounterId: {
        type: 'string',
        description: 'The ID of the encounter. Optional if the active encounter can be inferred from context.',
      },
    },
  },
  stageProposal: async (args, context = {}) => {
    // 1. Resolve encounter (never leaves a known campaign; see resolveEncounterForWrite)
    const encounter = resolveEncounterForWrite(args, context);
    if (!encounter) {
      throw new Error('No encounter found for remove_combatant. Please specify a valid encounterId.');
    }
    const encounterId = encounter.id;

    // 2. Gather combatants and resolve the target. No id or name supplied is
    // an explicit error rather than a silent guess (see move_combatant).
    const allCombatants = loadEncounterCombatants(encounterId, encounter.running_state, encounter.campaign_id);
    if (!args.combatantId && !args.combatantName) {
      throw new Error(
        'remove_combatant: either combatantId or combatantName is required to identify which combatant to remove.'
      );
    }
    const target = resolveCombatantRef(allCombatants, args.combatantId, args.combatantName);
    if (!target) {
      throw new Error(
        `Combatant "${args.combatantName || args.combatantId || 'unknown'}" not found in encounter "${encounter.name || encounterId}".`
      );
    }

    const positionLabel = target.position
      ? coordinateToLabel(target.position.x, target.position.y)
      : 'not yet placed on the grid';
    const faction = target.faction || (target.isPlayer ? 'ally' : 'enemy');
    const description = `Remove ${target.name} from encounter "${encounter.name}" (currently at ${positionLabel}, HP ${target.currentHp ?? '?'}/${target.maxHp ?? '?'}).`;

    const proposalPayload = {
      Combatant: target.name,
      Faction: faction,
      Position: positionLabel,
      HP: `${target.currentHp ?? '?'}/${target.maxHp ?? '?'}`,
      Encounter: encounter.name,
    };

    const executionPayload = {
      encounterId: encounter.id,
      campaignId: encounter.campaign_id,
      combatantId: target.instanceId,
      combatantName: target.name,
    };

    const proposal = hitlManager.createProposal({
      toolName: 'remove_combatant',
      description,
      payloadType: 'generic',
      payload: proposalPayload,
      executionPayload,
      stateHash: computeEncounterStateHash(encounterId, encounter.campaign_id),
      affectedIds: [target.instanceId],
      context: {
        campaignId: encounter.campaign_id,
        encounterId: encounter.id,
      },
    });

    return {
      proposal,
      summary: description,
    };
  },
  executeMutation: async (executionPayload, context = {}) => {
    const { encounterId, combatantId, combatantName } = executionPayload;
    const campaignId = requireExecutionCampaignId(executionPayload, context);

    // By the time this runs, hitlManager has already verified the
    // encounter's state hash still matches what was captured at staging
    // time (see computeEncounterStateHash / registerStateHasher), so the
    // combatant is guaranteed to still be exactly where it was when the DM
    // was shown this proposal — there is no "already removed by someone
    // else" case left to handle here.
    db.transaction(() => {
      db.prepare('DELETE FROM encounter_units WHERE instanceId = ? AND campaign_id = ? AND encounter_id = ?').run(combatantId, campaignId, encounterId);

      const rs = readRunningStateOrDefault(encounterId, campaignId);
      // turnIndex indexes the phase-filtered list the client displays (see
      // getVisibleCombatants), not the full roster.
      const removedIndex = getVisibleCombatants(rs).findIndex((c) => c.instanceId === combatantId);
      rs.combatants = rs.combatants.filter((c) => c.instanceId !== combatantId);
      const visibleAfterCount = getVisibleCombatants(rs).length;

      // Keep turnIndex pointing at a valid entry after the roster shrinks: a
      // removal at or before the current turn shifts everyone after it down
      // by one, and the pointer is clamped back into range if it now falls
      // off the end of the (shorter) list.
      if (typeof rs.turnIndex === 'number') {
        if (removedIndex !== -1 && removedIndex < rs.turnIndex) {
          rs.turnIndex = Math.max(0, rs.turnIndex - 1);
        }
        if (visibleAfterCount === 0) {
          rs.turnIndex = 0;
        } else if (rs.turnIndex >= visibleAfterCount) {
          rs.turnIndex = visibleAfterCount - 1;
        }
      }

      if (!Array.isArray(rs.combatLog)) {
        rs.combatLog = [];
      }
      rs.combatLog.push({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type: 'combatant_removed',
        description: `Removed ${combatantName || combatantId} from the encounter.`,
      });
      rs.updatedAt = new Date().toISOString();

      db.prepare('UPDATE encounters SET running_state = ? WHERE id = ? AND campaign_id = ?').run(JSON.stringify(rs), encounterId, campaignId);
    })();

    return {
      executionSummary: `Removed ${combatantName || combatantId} from the encounter.`,
      updatedState: { encounterId, combatantId, combatantName },
    };
  },
};

export const UPDATE_COMBATANT_TOOL_DEF = {
  name: 'update_combatant',
  description:
    "Propose editing a single combatant's name and/or faction (ally, enemy, or neutral) without moving it or changing its HP. Use move_combatant for position changes and apply_combat_damage for HP/healing changes. Stages a Human-in-the-Loop confirmation proposal showing exactly which fields will change before committing.",
  payloadType: 'generic',
  getStateHash: (context) => computeEncounterStateHash(context.encounterId, context.campaignId),
  parameters: {
    type: 'object',
    properties: {
      combatantId: {
        type: 'string',
        description: 'The unique instanceId of the combatant to update.',
      },
      combatantName: {
        type: 'string',
        description: 'The current name of the combatant to update (e.g. "Goblin 2").',
      },
      newName: {
        type: 'string',
        description: 'The new name to give the combatant.',
      },
      faction: {
        type: 'string',
        enum: ['ally', 'enemy', 'neutral'],
        description: 'The new faction/allegiance for the combatant.',
      },
      encounterId: {
        type: 'string',
        description: 'The ID of the encounter. Optional if the active encounter can be inferred from context.',
      },
    },
  },
  stageProposal: async (args, context = {}) => {
    // 1. Resolve encounter (never leaves a known campaign; see resolveEncounterForWrite)
    const encounter = resolveEncounterForWrite(args, context);
    if (!encounter) {
      throw new Error('No encounter found for update_combatant. Please specify a valid encounterId.');
    }
    const encounterId = encounter.id;

    // 2. Gather combatants and resolve the target
    const allCombatants = loadEncounterCombatants(encounterId, encounter.running_state, encounter.campaign_id);
    if (!args.combatantId && !args.combatantName) {
      throw new Error(
        'update_combatant: either combatantId or combatantName is required to identify which combatant to update.'
      );
    }
    const target = resolveCombatantRef(allCombatants, args.combatantId, args.combatantName);
    if (!target) {
      throw new Error(
        `Combatant "${args.combatantName || args.combatantId || 'unknown'}" not found in encounter "${encounter.name || encounterId}".`
      );
    }

    // 3. Validate requested changes
    const requestedName = typeof args.newName === 'string' ? args.newName.trim() : undefined;
    if (args.newName !== undefined && !requestedName) {
      throw new Error('update_combatant: newName cannot be blank.');
    }

    let requestedFaction;
    if (args.faction !== undefined) {
      if (!['ally', 'enemy', 'neutral'].includes(args.faction)) {
        throw new Error(`update_combatant: invalid faction "${args.faction}". Must be "ally", "enemy", or "neutral".`);
      }
      requestedFaction = args.faction;
    }

    if (requestedName === undefined && requestedFaction === undefined) {
      throw new Error('update_combatant: at least one of newName or faction must be provided.');
    }

    // 4. Diff against current values. A requested value identical to the
    // current one is not a real change; reject the call outright rather than
    // staging a no-op proposal for the DM to confirm.
    const currentFaction = target.faction || (target.isPlayer ? 'ally' : 'enemy');
    const changes = [];
    const proposalPayload = { Combatant: target.name };
    let finalName;
    let finalFaction;

    if (requestedName !== undefined && requestedName !== target.name) {
      changes.push(`renamed to "${requestedName}"`);
      proposalPayload.Name = `${target.name} → ${requestedName}`;
      finalName = requestedName;
    }
    if (requestedFaction !== undefined && requestedFaction !== currentFaction) {
      changes.push(`faction changed to "${requestedFaction}"`);
      proposalPayload.Faction = `${currentFaction} → ${requestedFaction}`;
      finalFaction = requestedFaction;
    }

    if (changes.length === 0) {
      throw new Error(`update_combatant: no changes to make — ${target.name} already matches the requested value(s).`);
    }

    const description = `Update ${target.name}: ${changes.join(', ')} in encounter "${encounter.name}".`;

    const executionPayload = {
      encounterId: encounter.id,
      campaignId: encounter.campaign_id,
      combatantId: target.instanceId,
      combatantName: target.name,
      newName: finalName,
      faction: finalFaction,
    };

    const proposal = hitlManager.createProposal({
      toolName: 'update_combatant',
      description,
      payloadType: 'generic',
      payload: proposalPayload,
      executionPayload,
      stateHash: computeEncounterStateHash(encounterId, encounter.campaign_id),
      affectedIds: [target.instanceId],
      context: {
        campaignId: encounter.campaign_id,
        encounterId: encounter.id,
      },
    });

    return {
      proposal,
      summary: description,
    };
  },
  executeMutation: async (executionPayload, context = {}) => {
    const { encounterId, combatantId, combatantName, newName, faction } = executionPayload;
    const campaignId = requireExecutionCampaignId(executionPayload, context);

    const updateTx = db.transaction(() => {
      const existing = db.prepare('SELECT instanceId, name, faction FROM encounter_units WHERE instanceId = ? AND campaign_id = ? AND encounter_id = ?').get(combatantId, campaignId, encounterId);
      if (!existing) {
        throw new Error(`Combatant "${combatantName || combatantId}" no longer exists in this encounter.`);
      }

      const setClauses = [];
      const params = [];
      if (newName !== undefined) {
        setClauses.push('name = ?');
        params.push(newName);
      }
      if (faction !== undefined) {
        setClauses.push('faction = ?');
        params.push(faction);
      }
      if (setClauses.length > 0) {
        params.push(combatantId, campaignId, encounterId);
        db.prepare(`UPDATE encounter_units SET ${setClauses.join(', ')} WHERE instanceId = ? AND campaign_id = ? AND encounter_id = ?`).run(...params);
      }

      const rs = readRunningStateOrDefault(encounterId, campaignId);
      const match = rs.combatants.find((c) => c.instanceId === combatantId);
      if (match) {
        if (newName !== undefined) match.name = newName;
        if (faction !== undefined) match.faction = faction;
      }

      const changeParts = [];
      if (newName !== undefined) changeParts.push(`name -> "${newName}"`);
      if (faction !== undefined) changeParts.push(`faction -> "${faction}"`);
      const finalSummary = `Updated ${existing.name}: ${changeParts.join(', ')}.`;

      if (!Array.isArray(rs.combatLog)) {
        rs.combatLog = [];
      }
      rs.combatLog.push({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type: 'combatant_updated',
        description: finalSummary,
      });
      rs.updatedAt = new Date().toISOString();

      db.prepare('UPDATE encounters SET running_state = ? WHERE id = ? AND campaign_id = ?').run(JSON.stringify(rs), encounterId, campaignId);

      return {
        finalSummary,
        updatedUnit: db.prepare('SELECT * FROM encounter_units WHERE instanceId = ? AND campaign_id = ?').get(combatantId, campaignId),
      };
    });

    const { finalSummary, updatedUnit } = updateTx();

    return {
      executionSummary: finalSummary,
      updatedState: { encounterId, combatantId, name: updatedUnit?.name, faction: updatedUnit?.faction },
      combatant: updatedUnit,
    };
  },
};

export function registerBuiltInWriteTools() {
  registerWriteTool(MOVE_COMBATANT_TOOL_DEF);
  registerWriteTool(APPLY_COMBAT_DAMAGE_TOOL_DEF);
  registerWriteTool(CONFIGURE_ENCOUNTER_COMBATANTS_TOOL_DEF);
  registerWriteTool(REMOVE_COMBATANT_TOOL_DEF);
  registerWriteTool(UPDATE_COMBATANT_TOOL_DEF);
}

export {
  parseScenarioCombatants,
  allocateTokenCoordinates,
  formatPhaseLabel,
  findMonster,
};

// Auto-register built-in write tools on module load
registerBuiltInWriteTools();

/**
 * Validates tool calls and blocks any unauthorized mutation attempt.
 */
export function validateToolCall(toolName, args) {
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    throw new Error(
      `Execution blocked: Tool "${toolName}" is not allowed. The assistant only has access to explicit read-only tools and a small set of write tools that stage Human-in-the-Loop proposals; it cannot mutate game state directly.`
    );
  }

  if (typeof args !== 'object' || args === null) {
    throw new Error(`Invalid arguments for tool ${toolName}: Expected an object.`);
  }

  return true;
}

/**
 * Executes a tool:
 * - Write tools: stages a confirmation proposal (Phase 1, zero state mutation)
 * - Read tools: queries game state/rules and returns data
 */
export async function executeTool(toolName, rawArgs, context = {}) {
  let args = rawArgs;
  const timestamp = new Date().toISOString();
  if (args === undefined || args === null) {
    args = {};
  } else if (typeof rawArgs === 'string') {
    if (rawArgs.trim() === '') {
      args = {}; // no-argument call
    } else {
      try {
        args = JSON.parse(rawArgs);
      } catch (parseErr) {
        const message = `Invalid arguments for tool "${toolName}": the arguments were not valid JSON (${parseErr.message}). Send a single valid JSON object.`;
        pushToolAuditLog({ timestamp, toolName, args: rawArgs, success: false, error: message });
        throw new Error(message);
      }
    }
  }

  validateToolCall(toolName, args);

  // Schema validation (required/type/enum/...) happens BEFORE any staging or
  // tool logic so malformed model output never reaches stageProposal.
  const toolSchema =
    WRITE_TOOLS_REGISTRY.get(toolName)?.function?.parameters ||
    READ_TOOLS.find((t) => t.function.name === toolName)?.function?.parameters;
  if (toolSchema) {
    const check = validateAgainstSchema(toolSchema, args, { shallow: isWriteTool(toolName) });
    if (!check.valid) {
      const message = formatSchemaErrors(toolName, check.errors);
      pushToolAuditLog({ timestamp, toolName, args, success: false, error: message });
      throw new Error(message);
    }
    args = check.args;
  }

  // Phase 1: Write Tool Dispatch (Proposal Staging Only)
  if (isWriteTool(toolName)) {
    const writeTool = WRITE_TOOLS_REGISTRY.get(toolName);
    try {
      const { proposal, summary } = await writeTool.stageProposal(args, context);

      const logEntry = {
        timestamp,
        toolName,
        args,
        success: true,
        isWriteProposal: true,
        proposalId: proposal.proposalId,
        resultSummary: summary,
      };
      pushToolAuditLog(logEntry);

      return {
        status: 'proposal_staged',
        requiresConfirmation: true,
        proposal,
        summary,
      };
    } catch (err) {
      pushToolAuditLog({
        timestamp,
        toolName,
        args,
        success: false,
        error: err.message,
      });
      throw err;
    }
  }

  let result = null;

  try {
    switch (toolName) {
      case 'lookup_spell': {
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const spells = getSpells();

        // 1. Exact match
        let found = spells.find((s) => s.name && s.name.toLowerCase() === query);

        // 2. Prefix or substring match (spell name starts with or contains query)
        if (!found && query.length >= 3) {
          found = spells.find((s) => s.name && s.name.toLowerCase().startsWith(query));
          if (!found) {
            found = spells.find((s) => s.name && s.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match (typo resolution, e.g. "fierball" -> Fireball, "lightning blt" -> Lightning Bolt)
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const s of spells) {
            if (!s.name) continue;
            const sim = nameSimilarity(query, s.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = s;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Description keyword search fallback
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const s of spells) {
            const desc = s.description || s.desc || '';
            const matchRatio = matchTokens(qTokens, desc);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = s;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        result = found ? {
          name: found.name,
          level: found.level,
          school: found.school,
          casting_time: found.casting_time || found.castingTime,
          range: found.range,
          components: found.components,
          duration: found.duration,
          description: found.description || found.desc,
        } : {
          error: `Spell "${args.name}" not found.`,
          hint: 'No exact spell name match found. If you are looking for spells matching a description, effect, or tactical purpose, use the semantic_search tool with category "spell".',
        };
        break;
      }

      case 'lookup_monster': {
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const monsters = getMonsters();

        // 1. Exact match
        let found = monsters.find((m) => m.name && m.name.toLowerCase() === query);

        // 2. Prefix or substring match (monster name starts with or contains query)
        if (!found && query.length >= 3) {
          found = monsters.find((m) => m.name && m.name.toLowerCase().startsWith(query));
          if (!found) {
            found = monsters.find((m) => m.name && m.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match (typo resolution, e.g. "abolethh" -> Aboleth, "gobln" -> Goblin)
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const m of monsters) {
            if (!m.name) continue;
            const sim = nameSimilarity(query, m.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = m;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Character sheet abilities, actions, traits, or description keyword matching
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const m of monsters) {
            if (!m._fullSheetText) {
              const abilitiesText = (m.special_abilities || m.traits || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              const actionsText = (m.actions || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              m._fullSheetText = `${m.name || ''} ${m.meta?.type || m.type || ''} ${abilitiesText} ${actionsText}`;
            }
            const matchRatio = matchTokens(qTokens, m._fullSheetText);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = m;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        result = found ? {
          name: found.name,
          cr: found.challenge_rating || found.cr,
          ac: found.attributes?.ac?.value ?? found.armor_class ?? found.ac,
          hp: found.attributes?.hp?.value ?? found.hit_points ?? found.hp,
          hit_dice: found.attributes?.hp?.dice || found.hit_dice,
          speed: found.attributes?.speeds || found.speed,
          abilities: found.special_abilities || found.traits,
          actions: found.actions,
        } : {
          error: `Monster "${args.name}" not found.`,
          hint: 'No exact monster name match found. If you are searching for monsters by theme, biome, concept, or description (e.g. "burrowing desert monster"), please use the semantic_search tool instead.',
        };
        break;
      }

      case 'get_monster_hp': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const hit = lookupCombatantForRead(args.name_or_id, context);

        if (hit) {
          const c = hit.combatant;
          result = {
            ...(hit.encounterName ? { encounterName: hit.encounterName } : {}),
            instanceId: c.instanceId,
            name: c.name,
            currentHp: c.currentHp,
            maxHp: c.maxHp,
            isLiveCombatant: true,
            ...(hit.source === 'running_state' ? { conditions: c.conditions || [] } : {}),
            status: c.currentHp <= 0 ? (hit.source === 'encounter_units' && c.isPlayer ? 'Unconscious / Dying' : 'Dead / Defeated') : 'Alive',
          };
          break;
        }

        // Fallback to monster manual (exact name first, then partial)
        const monsters = getMonsters();
        const foundMonster =
          monsters.find((m) => m.name && m.name.toLowerCase() === nameOrId) ||
          monsters.find((m) => m.name && m.name.toLowerCase().includes(nameOrId));

        if (foundMonster) {
          result = {
            name: foundMonster.name,
            hp: foundMonster.attributes?.hp?.value ?? foundMonster.hit_points ?? foundMonster.hp,
            hit_dice: foundMonster.attributes?.hp?.dice || foundMonster.hit_dice,
            cr: foundMonster.challenge_rating || foundMonster.cr,
            ac: foundMonster.attributes?.ac?.value ?? foundMonster.armor_class ?? foundMonster.ac,
            isLiveCombatant: false,
            source: 'Monster Manual (Base Stat Block)',
          };
        } else {
          result = { error: `Monster or combatant "${args.name_or_id}" not found in active encounter or monster manual.` };
        }
        break;
      }

      case 'get_character_hp': {
        const hit = lookupCombatantForRead(args.name_or_id, context);
        if (hit) {
          const c = hit.combatant;
          result = {
            ...(hit.encounterName ? { encounterName: hit.encounterName } : {}),
            instanceId: c.instanceId,
            name: c.name,
            currentHp: c.currentHp,
            maxHp: c.maxHp,
            isPlayer: !!c.isPlayer,
            ...(hit.source === 'running_state' ? { conditions: c.conditions || [] } : {}),
            status: c.currentHp <= 0 ? (c.isPlayer ? 'Unconscious / Dying' : 'Dead / Defeated') : 'Alive',
          };
        } else {
          result = { error: `Character or combatant "${args.name_or_id}" not found in active encounter.` };
        }
        break;
      }

      case 'get_entity_position': {
        const hit = lookupCombatantForRead(args.name_or_id, context, (c) => !!c.position);
        if (hit) {
          const c = hit.combatant;
          result = {
            ...(hit.encounterName ? { encounterName: hit.encounterName } : {}),
            instanceId: c.instanceId,
            name: c.name,
            position: { x: c.position.x, y: c.position.y },
          };
        } else {
          result = { error: `Entity "${args.name_or_id}" position not found.` };
        }
        break;
      }

      case 'get_initiative_order': {
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Check running_state first
        let runningEncounter = null;
        if (encounterId && campaignId) {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE id = ? AND campaign_id = ?').get(encounterId, campaignId);
        } else if (encounterId) {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE id = ?').get(encounterId);
        } else if (campaignId) {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE campaign_id = ? AND running_state IS NOT NULL ORDER BY id LIMIT 1').get(campaignId);
        } else {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL ORDER BY id LIMIT 1').get();
        }

        if (runningEncounter && runningEncounter.running_state) {
          try {
            const rs = JSON.parse(runningEncounter.running_state);
            const combatants = (rs.combatants || []).slice().sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
            // turnIndex points into the phase-filtered list the client shows
            // (activePhases, default [1]), not the full roster.
            const currentTurn = rs.turnIndex ?? 0;
            const currentTurnUnit = getVisibleCombatants(rs)[currentTurn] || null;
            const currentTurnCombatant = currentTurnUnit?.name || null;

            result = {
              encounterName: runningEncounter.name,
              isCombatStarted: !!rs.isCombatStarted,
              round: rs.round ?? 1,
              turnIndex: currentTurn,
              currentTurnCombatant,
              count: combatants.length,
              order: combatants.map((c, idx) => ({
                rank: idx + 1,
                instanceId: c.instanceId,
                name: c.name,
                initiative: c.initiative,
                currentHp: c.currentHp,
                maxHp: c.maxHp,
                isPlayer: !!c.isPlayer,
                phase: c.phase || 1,
                isCurrentTurn: !!currentTurnUnit && c.instanceId === currentTurnUnit.instanceId,
                conditions: c.conditions || [],
                position: c.position || null,
              })),
            };
            break;
          } catch {}
        }

        // 2. Fallback to encounter_units
        let query = 'SELECT instanceId, name, initiative, currentHp, maxHp, isPlayer, position_x, position_y FROM encounter_units';
        const params = [];
        const conds = [];
        if (encounterId) {
          conds.push('encounter_id = ?');
          params.push(encounterId);
        }
        if (campaignId) {
          conds.push('campaign_id = ?');
          params.push(campaignId);
        }
        if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
        query += ' ORDER BY initiative DESC';

        const units = db.prepare(query).all(...params);
        result = {
          count: units.length,
          order: units.map((u, idx) => ({
            rank: idx + 1,
            instanceId: u.instanceId,
            name: u.name,
            initiative: u.initiative,
            currentHp: u.currentHp,
            maxHp: u.maxHp,
            isPlayer: !!u.isPlayer,
            position: u.position_x !== null ? { x: u.position_x, y: u.position_y } : null,
          })),
        };
        break;
      }

      case 'get_campaign_asset': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const campaignId = context.campaignId;

        // 1. Search campaign assets by exact name or id
        let asset = null;
        if (campaignId) {
          asset = db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ? AND (LOWER(name) = ? OR id = ?)').get(campaignId, nameOrId, nameOrId);
        } else {
          asset = db.prepare('SELECT id, type, name, description FROM assets WHERE LOWER(name) = ? OR id = ?').get(nameOrId, nameOrId);
        }

        // 2. Search world assets
        if (!asset) {
          let worldId = null;
          if (campaignId) {
            const camp = db.prepare('SELECT world_id FROM campaigns WHERE id = ?').get(campaignId);
            worldId = camp?.world_id;
          }
          if (worldId) {
            asset = db.prepare('SELECT id, type, name, description FROM world_assets WHERE world_id = ? AND (LOWER(name) = ? OR id = ?)').get(worldId, nameOrId, nameOrId);
          }
          if (!asset) {
            asset = db.prepare('SELECT id, type, name, description FROM world_assets WHERE LOWER(name) = ? OR id = ?').get(nameOrId, nameOrId);
          }
        }

        // 3. Search chapters
        if (!asset) {
          let chap = null;
          if (campaignId) {
            chap = db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ? AND (LOWER(title) = ? OR id = ?)').get(campaignId, nameOrId, nameOrId);
          } else {
            chap = db.prepare('SELECT id, title, content FROM chapters WHERE LOWER(title) = ? OR id = ?').get(nameOrId, nameOrId);
          }
          if (chap) {
            asset = { id: chap.id, type: 'Chapter', name: chap.title, description: chap.content };
          }
        }

        // 4. Fuzzy search across campaign assets, world assets, and chapters
        if (!asset && nameOrId.length > 2) {
          const qTokens = tokenizeQuery(nameOrId);
          const allCampaignAssets = campaignId
            ? db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ?').all(campaignId)
            : db.prepare('SELECT id, type, name, description FROM assets').all();
          const allWorldAssets = db.prepare('SELECT id, type, name, description FROM world_assets').all();
          const allChapters = campaignId
            ? db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId)
            : db.prepare('SELECT id, title, content FROM chapters').all();

          let bestMatch = null;
          let bestScore = 0;

          for (const ca of allCampaignAssets) {
            if (!ca.name) continue;
            const sim = nameSimilarity(nameOrId, ca.name);
            const tokenSim = matchTokens(qTokens, ca.description || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { ...ca, source: 'campaign_asset', matchScore: Number(score.toFixed(3)) };
            }
          }

          for (const wa of allWorldAssets) {
            if (!wa.name) continue;
            const sim = nameSimilarity(nameOrId, wa.name);
            const tokenSim = matchTokens(qTokens, wa.description || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { ...wa, source: 'world_asset', matchScore: Number(score.toFixed(3)) };
            }
          }

          for (const ch of allChapters) {
            if (!ch.title) continue;
            const sim = nameSimilarity(nameOrId, ch.title);
            const tokenSim = matchTokens(qTokens, ch.content || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { id: ch.id, type: 'Chapter', name: ch.title, description: ch.content, source: 'chapter', matchScore: Number(score.toFixed(3)) };
            }
          }

          if (bestMatch && bestScore >= 0.5) {
            asset = bestMatch;
          }
        }

        if (asset) {
          result = asset;
        } else {
          result = { error: `Asset "${args.name_or_id}" not found in campaign, world lore, or chapters.` };
        }
        break;
      }

      case 'lookup_magic_item': {
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const items = getMagicItems();

        // 1. Exact match
        let found = items.find((i) => (i.name && i.name.toLowerCase() === query) || String(i.id) === query || i.slug === query);

        // 2. Prefix or substring match (item name starts with or contains query)
        if (!found && query.length >= 3) {
          found = items.find((i) => i.name && i.name.toLowerCase().startsWith(query));
          if (!found) {
            found = items.find((i) => i.name && i.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const it of items) {
            if (!it.name) continue;
            const sim = nameSimilarity(query, it.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = it;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Description keyword match
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const it of items) {
            if (!it._fullSheetText) {
              const desc = Array.isArray(it.description) ? it.description.join(' ') : (it.description || '');
              it._fullSheetText = `${it.name || ''} ${it.type || ''} ${it.notes || ''} ${desc}`;
            }
            const matchRatio = matchTokens(qTokens, it._fullSheetText);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = it;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        if (found) {
          result = {
            id: found.id,
            name: found.name,
            type: found.type,
            subtype: found.subtype,
            rarity: found.rarity,
            requires_attunement: found.requires_attunement,
            attunement_notes: found.attunement_notes,
            notes: found.notes,
            description: found.description,
            source: found.source,
          };
        } else {
          result = {
            error: `Magic item "${args.name}" not found.`,
            hint: 'No exact magic item name match found. If you are searching by item description, theme, or properties, use the semantic_search tool with category "magic_item".',
          };
        }
        break;
      }

      case 'search_assets_and_lore': {
        const query = (args.query || '').trim().toLowerCase();
        const category = args.category || 'all';
        const campaignId = context.campaignId;

        if (!query) {
          result = {
            query: args.query,
            matchCount: 0,
            results: [],
          };
          break;
        }

        const qTokens = tokenizeQuery(query);
        const candidates = [];

        // 1. Spells
        if (category === 'all' || category === 'spell') {
          for (const sp of getSpells()) {
            if (!sp.name) continue;
            const sim = nameSimilarity(query, sp.name);
            const descMatch = matchTokens(qTokens, sp.description || sp.desc || '');
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Spell',
                name: sp.name,
                snippet: `${sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`} ${sp.school} - ${(sp.description || sp.desc || '').slice(0, 120)}...`,
                score,
              });
            }
          }
        }

        // 2. Monsters
        if (category === 'all' || category === 'monster') {
          for (const mo of getMonsters()) {
            if (!mo.name) continue;
            const sim = nameSimilarity(query, mo.name);
            if (!mo._searchSheetText) {
              const abilitiesText = (mo.special_abilities || mo.traits || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              mo._searchSheetText = `${mo.name || ''} ${mo.meta?.type || mo.type || ''} ${abilitiesText}`;
            }
            const descMatch = matchTokens(qTokens, mo._searchSheetText);
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Monster',
                name: mo.name,
                snippet: `CR ${mo.challenge_rating || mo.cr || 'Unknown'} - HP: ${mo.attributes?.hp?.value ?? mo.hp} - AC: ${mo.attributes?.ac?.value ?? mo.ac}`,
                score,
              });
            }
          }
        }

        // 3. Magic Items
        if (category === 'all' || category === 'magic_item') {
          for (const mi of getMagicItems()) {
            if (!mi.name) continue;
            const sim = nameSimilarity(query, mi.name);
            if (!mi._searchSheetText) {
              const desc = Array.isArray(mi.description) ? mi.description.join(' ') : (mi.description || '');
              mi._searchSheetText = `${mi.name || ''} ${mi.type || ''} ${desc}`;
            }
            const descMatch = matchTokens(qTokens, mi._searchSheetText);
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Magic Item',
                name: mi.name,
                snippet: `${mi.rarity || 'Common'} ${mi.type || 'Item'}: ${(Array.isArray(mi.description) ? mi.description.join(' ') : (mi.description || '')).slice(0, 120)}...`,
                score,
              });
            }
          }
        }

        // 4. Campaign Assets
        if (category === 'all' || category === 'campaign_asset') {
          try {
            const cas = campaignId
              ? db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ?').all(campaignId)
              : db.prepare('SELECT id, type, name, description FROM assets').all();
            for (const ca of cas) {
              if (!ca.name) continue;
              const sim = nameSimilarity(query, ca.name);
              const descMatch = matchTokens(qTokens, ca.description || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: `Campaign Asset (${ca.type})`,
                  name: ca.name,
                  snippet: (ca.description || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        // 5. World Assets
        if (category === 'all' || category === 'world_asset') {
          try {
            const was = db.prepare('SELECT id, type, name, description FROM world_assets').all();
            for (const wa of was) {
              if (!wa.name) continue;
              const sim = nameSimilarity(query, wa.name);
              const descMatch = matchTokens(qTokens, wa.description || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: `World Lore (${wa.type})`,
                  name: wa.name,
                  snippet: (wa.description || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        // 6. Chapters
        if (category === 'all' || category === 'chapter') {
          try {
            const chaps = campaignId
              ? db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId)
              : db.prepare('SELECT id, title, content FROM chapters').all();
            for (const ch of chaps) {
              if (!ch.title) continue;
              const sim = nameSimilarity(query, ch.title);
              const descMatch = matchTokens(qTokens, ch.content || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: 'Chapter Note',
                  name: ch.title,
                  snippet: (ch.content || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        candidates.sort((a, b) => b.score - a.score);
        const topResults = candidates.slice(0, 5);

        result = {
          query: args.query,
          matchCount: topResults.length,
          results: topResults,
        };
        if (topResults.length === 0) {
          result.hint = 'No exact keyword matches found. Since this looks like a conceptual, thematic, or descriptive query, please use the semantic_search tool.';
        }
        break;
      }

      case 'semantic_search': {
        const query = (args.query || '').trim();
        const category = args.category || 'all';
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
        const campaignId = context.campaignId;

        if (!query) {
          result = {
            query: args.query,
            category,
            matchCount: 0,
            results: [],
            hint: 'Please provide a non-empty query string for semantic search.',
          };
          break;
        }

        const categoryToSourceMap = {
          chapter: 'campaign_chapter',
        };
        const sourceFilter = category && category !== 'all' ? (categoryToSourceMap[category] || category) : null;

        const topPassages = await searchVectorStore(query, {
          campaignId,
          limit,
          sourceFilter,
        });

        result = {
          query: args.query,
          category,
          matchCount: topPassages.length,
          results: topPassages.map((p) => ({
            id: p.id,
            source: p.source,
            title: p.title,
            score: p.score,
            snippet: p.content && p.content.length > 1500 ? p.content.slice(0, 1500) + '...' : p.content,
            metadata: p.metadata,
          })),
        };

        if (topPassages.length === 0) {
          result.hint = 'No semantic matches found for this query. Try broadening your query terms or removing category filters.';
        }
        break;
      }

      case 'get_chapter_outline': {
        const chapter = resolveChapter(args.chapter_name_or_id, context);
        if (!chapter) {
          result = {
            error: 'No chapter found. Please create a chapter or specify a valid chapter name/ID.',
          };
          break;
        }

        const headings = parseChapterOutline(chapter.content || '');
        result = {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          headingCount: headings.length,
          outline: headings.map((h) => ({
            level: h.level,
            heading: h.heading,
          })),
        };
        if (headings.length === 0) {
          result.note = 'No markdown headings (#, ##, ###) found in this chapter.';
        }
        break;
      }

      case 'read_chapter_section': {
        const chapter = resolveChapter(args.chapter_name_or_id, context);
        if (!chapter) {
          result = {
            error: 'No chapter found. Please create a chapter or specify a valid chapter name/ID.',
          };
          break;
        }

        const content = chapter.content || '';
        const headings = parseChapterOutline(content);
        const queryHeading = (args.headingName || '').replace(/^#+\s*/, '').toLowerCase().trim();

        if (!queryHeading) {
          result = {
            error: 'Please provide a valid headingName to read.',
            availableHeadings: headings.map((h) => h.heading),
          };
          break;
        }

        // Check for introduction / prologue if requested
        if (
          (queryHeading === 'introduction' || queryHeading === 'intro' || queryHeading === 'prologue') &&
          headings.length > 0 &&
          headings[0].startIndex > 0
        ) {
          const introText = content.slice(0, headings[0].startIndex).trim();
          if (introText) {
            result = {
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              matchedHeading: 'Introduction',
              headingLevel: 1,
              sectionContent: introText,
            };
            break;
          }
        }

        if (headings.length === 0) {
          result = {
            error: `Chapter "${chapter.title}" contains no markdown headings.`,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            fullContent: content.slice(0, 2000),
          };
          break;
        }

        // Find best matching heading
        let matchedIdx = -1;
        let bestScore = 0;

        for (let i = 0; i < headings.length; i++) {
          const h = headings[i];
          const hLower = h.heading.toLowerCase();
          if (hLower === queryHeading) {
            matchedIdx = i;
            bestScore = 1.0;
            break;
          }
          if (hLower.includes(queryHeading) || queryHeading.includes(hLower)) {
            const score = 0.85;
            if (score > bestScore) {
              bestScore = score;
              matchedIdx = i;
            }
          } else {
            const sim = nameSimilarity(queryHeading, h.heading);
            if (sim > bestScore && sim >= 0.45) {
              bestScore = sim;
              matchedIdx = i;
            }
          }
        }

        if (matchedIdx === -1) {
          result = {
            error: `Section "${args.headingName}" not found in chapter "${chapter.title}".`,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            availableHeadings: headings.map((h) => h.heading),
          };
          break;
        }

        const targetHeading = headings[matchedIdx];
        const targetLevel = targetHeading.level;
        const startPos = targetHeading.contentStartIndex;

        // Find the next heading with level <= targetLevel
        let endPos = content.length;
        for (let j = matchedIdx + 1; j < headings.length; j++) {
          if (headings[j].level <= targetLevel) {
            endPos = headings[j].startIndex;
            break;
          }
        }

        const sectionText = content.slice(startPos, endPos).trim();
        result = {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          matchedHeading: targetHeading.heading,
          headingLevel: targetHeading.level,
          sectionContent: sectionText,
        };
        break;
      }

      case 'get_current_map': {
        const includeCombatants = args.include_combatants !== false;
        const requestedVersion = (args.version || 'dm').toLowerCase().trim();
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Locate the active or target encounter
        let encounter = null;
        if (encounterId) {
          const cols = 'id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config';
          encounter = campaignId
            ? db.prepare(`SELECT ${cols} FROM encounters WHERE id = ? AND campaign_id = ?`).get(encounterId, campaignId)
            : db.prepare(`SELECT ${cols} FROM encounters WHERE id = ?`).get(encounterId);
        }

        if (!encounter && campaignId) {
          // Prefer encounter with active running state AND a map, then any with a map in this campaign
          encounter = db
            .prepare(
              'SELECT id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config FROM encounters WHERE campaign_id = ? AND (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1'
            )
            .get(campaignId);
        }

        if (!encounter) {
          // Global fallback if no context provided
          encounter = db
            .prepare(
              'SELECT id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config FROM encounters WHERE (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1'
            )
            .get();
        }

        if (!encounter) {
          result = {
            error: 'No combat encounter found in active context.',
            hint: 'No encounters exist in the current campaign. Create or load an encounter with a tactical map.',
          };
          break;
        }

        // 2. Select map URL based on requested version (dm vs player)
        let selectedMapUrl = null;
        let chosenVersion = requestedVersion;

        if (requestedVersion === 'player') {
          selectedMapUrl = encounter.player_map_url || encounter.dm_map_url;
          if (!encounter.player_map_url && encounter.dm_map_url) {
            chosenVersion = 'dm (fallback - no player map available)';
          }
        } else {
          selectedMapUrl = encounter.dm_map_url || encounter.player_map_url;
          if (!encounter.dm_map_url && encounter.player_map_url) {
            chosenVersion = 'player (fallback - no DM map available)';
          }
        }

        if (!selectedMapUrl) {
          result = {
            error: `No tactical map configured for encounter "${encounter.name}" (ID: ${encounter.id}).`,
            hint: 'This encounter does not have a dmMapUrl or playerMapUrl assigned. Set a map in Encounter Builder or choose an encounter with a map.',
            encounterId: encounter.id,
            encounterName: encounter.name,
          };
          break;
        }

        // 3. Resolve map file on disk
        const filePath = resolveMapFilePath(selectedMapUrl);
        if (!filePath) {
          result = {
            error: `Map image file could not be found on disk for URL: "${selectedMapUrl}".`,
            hint: 'Verify that the map file exists in the public/maps/ directory.',
            encounterId: encounter.id,
            encounterName: encounter.name,
            mapUrl: selectedMapUrl,
          };
          break;
        }

        // 4. Retrieve Grid Configuration
        const gridData = getMapGridData(selectedMapUrl, encounter);

        // 5. Gather combatants and their positions
        let allCombatants = [];
        if (encounter.running_state) {
          try {
            const rs = JSON.parse(encounter.running_state);
            if (Array.isArray(rs.combatants)) {
              allCombatants = rs.combatants.map((c) => ({
                instanceId: c.instanceId,
                name: c.name || 'Unknown',
                currentHp: c.currentHp,
                maxHp: c.maxHp,
                initiative: c.initiative,
                isPlayer: !!c.isPlayer,
                position: c.position || null,
                conditions: c.conditions || [],
              }));
            }
          } catch {}
        }

        if (allCombatants.length === 0) {
          const units = db
            .prepare(
              'SELECT instanceId, name, currentHp, maxHp, initiative, isPlayer, position_x, position_y FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?'
            )
            .all(encounter.id, encounter.campaign_id);
          allCombatants = units.map((u) => ({
            instanceId: u.instanceId,
            name: u.name || 'Unknown',
            currentHp: u.currentHp,
            maxHp: u.maxHp,
            initiative: u.initiative,
            isPlayer: !!u.isPlayer,
            position:
              u.position_x !== null && u.position_y !== null
                ? { x: u.position_x, y: u.position_y }
                : null,
            conditions: [],
          }));
        }

        const combatantsWithPosition = allCombatants.filter(
          (c) => c.position && typeof c.position.x === 'number' && typeof c.position.y === 'number'
        );

        // 6. Generate Annotated Map Image
        const imageResult = await generateAnnotatedMapImage({
          imagePath: filePath,
          gridData,
          combatants: combatantsWithPosition,
          includeCombatants,
        });

        // 7. Format structured combatant locations
        const formattedCombatants = includeCombatants
          ? combatantsWithPosition.map((c) => ({
              name: c.name,
              instanceId: c.instanceId,
              team: c.isPlayer ? 'Player' : 'Monster/Enemy',
              coordinates: { x: c.position.x, y: c.position.y },
              cell: coordinateToLabel(c.position.x, c.position.y),
              hp: `${c.currentHp ?? '?'}/${c.maxHp ?? '?'}`,
              conditions: c.conditions || [],
            }))
          : [];

        result = {
          success: true,
          encounterId: encounter.id,
          encounterName: encounter.name,
          mapName: encounter.name,
          mapUrl: selectedMapUrl,
          version: chosenVersion,
          grid: {
            columns: gridData.columns,
            rows: gridData.rows,
            cellPitch: gridData.cellPitch,
          },
          combatantsCount: formattedCombatants.length,
          unplacedCombatantsCount: allCombatants.length - combatantsWithPosition.length,
          totalCombatantsInEncounter: allCombatants.length,
          combatants: formattedCombatants,
          image: imageResult.dataUri,
          imageAttached: true,
          mimeType: imageResult.mimeType,
        };
        break;
      }

      default:
        throw new Error(`Unrecognized tool: ${toolName}`);
    }

    const logEntry = {
      timestamp,
      toolName,
      args,
      success: true,
      resultSummary: summarizeResultForAudit(result),
    };
    pushToolAuditLog(logEntry);
    console.log(`[ToolController Audit] ${toolName}:`, JSON.stringify(args), '=>', logEntry.resultSummary);

    return result;
  } catch (err) {
    const errorLogEntry = {
      timestamp,
      toolName,
      args,
      success: false,
      error: err.message,
    };
    pushToolAuditLog(errorLogEntry);
    console.warn(`[ToolController Error] ${toolName}:`, err.message);
    throw err;
  }
}
