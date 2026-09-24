import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  columnIndexToLabel,
  coordinateToLabel,
  columnLabelToIndex,
  labelToCoordinate,
  resolveRegionName,
} from './gridUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.join(__dirname, '../../public/data');

const WORD_TO_NUM = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

let cachedMonsters = null;

/** Upper bound on how many combatants a single scenario clause may spawn. */
export const MAX_COMBATANTS_PER_CLAUSE = 50;

// Faction keywords must match whole words, not substrings: a plain
// `.includes('ally')` check would wrongly treat "Finally", "really",
// "usually", or "rally" as declaring an ally faction.
const FACTION_ALLY_REGEX = /\b(?:allies|friendly|ally)\b/i;
const FACTION_NEUTRAL_REGEX = /\bneutral\b/i;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps an already-escaped pattern fragment with boundary assertions, but
 * only on the sides that actually end in a word character. A plain `\b`
 * requires a word-char/non-word-char transition on *both* sides of where
 * it's placed: a name ending in ")" (e.g. "Deep Gnome (Svirfneblin)") is
 * itself non-word on that edge, so a trailing `\b` would require the very
 * next character to be a word character, which ordinary prose never
 * provides ("...wait at B2." is followed by punctuation/whitespace) — the
 * name could then never match (see N-3). Using a lookbehind/lookahead
 * instead of `\b` on the non-word edges still prevents mid-word matches on
 * the word-char edges without requiring an impossible transition.
 */
function withWordBoundaries(pattern) {
  const prefix = /^[a-zA-Z0-9_]/.test(pattern) ? '(?<![a-zA-Z0-9_])' : '';
  const suffix = /[a-zA-Z0-9_]$/.test(pattern) ? '(?![a-zA-Z0-9_])' : '';
  return `${prefix}${pattern}${suffix}`;
}

// Compiled per-monster name-matching regexes are cached per monstersList
// array (by reference) so repeated parseScenarioCombatants calls against
// the same (large, static) monster manual don't rebuild hundreds of RegExp
// objects on every clause.
const monsterRegexCache = new WeakMap();

function getMonsterRegexes(monstersList) {
  const cached = monsterRegexCache.get(monstersList);
  if (cached) return cached;

  const compiled = [];
  for (const m of monstersList) {
    if (!m.name || m.name.length < 3) continue;
    // Escape regex metacharacters in monster names before interpolating
    // them into a RegExp: unescaped names like "Deep Gnome (Svirfneblin)"
    // would otherwise turn the parentheses into a capture group that never
    // matches the literal text (and an unbalanced name would throw).
    const singular = escapeRegExp(m.name.toLowerCase());
    const plural = m.name.toLowerCase().endsWith('s') ? singular : `${singular}s`;
    compiled.push({
      monster: m,
      regex: new RegExp(`(?:${withWordBoundaries(singular)}|${withWordBoundaries(plural)})`, 'i'),
    });
  }

  monsterRegexCache.set(monstersList, compiled);
  return compiled;
}

export function getMonstersList() {
  if (!cachedMonsters) {
    const p = path.join(PUBLIC_DATA_DIR, 'monsters.json');
    if (fs.existsSync(p)) {
      try {
        cachedMonsters = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        cachedMonsters = [];
      }
    } else {
      cachedMonsters = [];
    }
  }
  return cachedMonsters;
}

export function formatPhaseLabel(phase) {
  const p = Number(phase) || 1;
  if (p === 1) return 'Phase 1: Initial Wave';
  if (p === 2) return 'Phase 2: Reinforcements';
  return `Phase ${p}: Reinforcements`;
}

/**
 * Allocates token coordinates, resolving placement conflicts on congested map cells.
 * If the requested position is already occupied, searches outward by Chebyshev distance
 * to find the nearest unoccupied cell within map bounds.
 */
export function allocateTokenCoordinates(requestedPos, occupiedCells = new Set(), gridConfig = null) {
  const maxCols = gridConfig?.columns || 50;
  const maxRows = gridConfig?.rows || 50;
  const key = (x, y) => `${x},${y}`;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < maxCols && y < maxRows;

  // Accept the requested cell directly only when it is both free AND inside
  // the grid; an out-of-grid request used to be accepted verbatim as long
  // as nothing else occupied that (invalid) cell (see G-11).
  if (inBounds(requestedPos.x, requestedPos.y) && !occupiedCells.has(key(requestedPos.x, requestedPos.y))) {
    occupiedCells.add(key(requestedPos.x, requestedPos.y));
    return {
      x: requestedPos.x,
      y: requestedPos.y,
      label: coordinateToLabel(requestedPos.x, requestedPos.y),
    };
  }

  // Outward ring search in Chebyshev distance order, starting from a
  // bounds-clamped version of the requested cell so an out-of-grid request
  // still resolves to the nearest valid free cell instead of falling
  // through to the full-grid fallback below.
  const originX = Math.min(Math.max(requestedPos.x, 0), maxCols - 1);
  const originY = Math.min(Math.max(requestedPos.y, 0), maxRows - 1);
  const maxDist = Math.max(maxCols, maxRows);

  const tryCell = (nx, ny) => {
    if (inBounds(nx, ny) && !occupiedCells.has(key(nx, ny))) {
      occupiedCells.add(key(nx, ny));
      return { x: nx, y: ny, label: coordinateToLabel(nx, ny) };
    }
    return null;
  };

  // Visit only the perimeter of each Chebyshev ring (row-major order), rather
  // than scanning the whole (2*dist+1)^2 square and discarding the interior.
  for (let dist = 0; dist <= maxDist; dist++) {
    for (let dy = -dist; dy <= dist; dy++) {
      const fullRow = dy === -dist || dy === dist;
      if (fullRow) {
        for (let dx = -dist; dx <= dist; dx++) {
          const hit = tryCell(originX + dx, originY + dy);
          if (hit) return hit;
        }
      } else {
        const left = tryCell(originX - dist, originY + dy);
        if (left) return left;
        const right = tryCell(originX + dist, originY + dy);
        if (right) return right;
      }
    }
  }

  // The grid has no free cells left at all. Flag this explicitly rather
  // than silently handing back an already-occupied cell, which would stack
  // two tokens on top of each other with no indication anything went wrong.
  return {
    x: originX,
    y: originY,
    label: coordinateToLabel(originX, originY),
    placementFailed: true,
  };
}

/**
 * Finds a monster in monstersList by ID, name, slug, or plural.
 */
export function findMonster(term, monstersList = []) {
  if (!term || typeof term !== 'string') return null;
  const clean = term.trim().toLowerCase();
  const cleanNoPlural = clean.endsWith('s') ? clean.slice(0, -1) : clean;

  // 1. Exact ID
  let match = monstersList.find(
    (m) => String(m.id).toLowerCase() === clean || (m.slug && m.slug.toLowerCase() === clean)
  );
  if (match) return match;

  // 2. Exact Name
  match = monstersList.find((m) => m.name && m.name.toLowerCase() === clean);
  if (match) return match;

  // 3. Singular Name
  if (cleanNoPlural !== clean) {
    match = monstersList.find((m) => m.name && m.name.toLowerCase() === cleanNoPlural);
    if (match) return match;
  }

  // 4. Slugified name
  const slugified = clean.replace(/[\s-_]+/g, '');
  match = monstersList.find(
    (m) => m.name && m.name.toLowerCase().replace(/[\s-_]+/g, '') === slugified
  );
  if (match) return match;

  // 5. Word-boundary prefix or suffix match (e.g. "goblin scout" -> "goblin")
  match = monstersList.find(
    (m) =>
      m.name &&
      (clean.startsWith(m.name.toLowerCase() + ' ') ||
        clean.startsWith(m.name.toLowerCase() + '-') ||
        m.name.toLowerCase().startsWith(clean + ' ') ||
        m.name.toLowerCase().startsWith(clean + '-'))
  );
  if (match) return match;

  return null;
}

/**
 * Splits scenario narrative text into discrete clauses for analysis.
 */
function splitScenarioClauses(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/(?:\r?\n)+|[.;]+|(?:,\s*)?\band\b(?=\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a\s+|an\s+|[A-Z]))/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parses scenario/chapter text to identify participating combatants, starting locations, and phases.
 *
 * @param {string} scenarioText
 * @param {Object} [encounter={}]
 * @param {Array} [monstersList=[]]
 * @param {Set<string>} [occupiedCells=new Set()]
 * @param {Object|null} [gridData=null] Already-resolved grid data (columns,
 *   rows, regions) from the calibrated map_grids.json entry for the
 *   encounter's actual map, as computed by getMapGridData. When provided,
 *   this takes precedence over encounter.grid_config, which is often
 *   absent/stale and would otherwise silently default bounds to 50x50 and
 *   miss region names entirely (see G-12/N-2).
 * @returns {Array<Object>} List of combatants configured for proposal
 */
export function parseScenarioCombatants(
  scenarioText,
  encounter = {},
  monstersList = [],
  occupiedCells = new Set(),
  gridData = null
) {
  if (!scenarioText || typeof scenarioText !== 'string' || !scenarioText.trim()) {
    return [];
  }

  const allMonsters = monstersList && monstersList.length > 0 ? monstersList : getMonstersList();

  // Prefer the caller's already-resolved grid data (from map_grids.json) over
  // encounter.grid_config; only fall back to grid_config when no gridData was
  // supplied at all.
  let regions = [];
  let gridConfig = null;
  if (gridData) {
    gridConfig = { columns: gridData.columns, rows: gridData.rows };
    regions = gridData.regions || [];
  } else if (encounter.grid_config) {
    try {
      gridConfig = typeof encounter.grid_config === 'string'
        ? JSON.parse(encounter.grid_config)
        : encounter.grid_config;
      if (gridConfig?.regions) regions = gridConfig.regions;
    } catch {}
  } else if (encounter.gridConfig) {
    gridConfig = encounter.gridConfig;
    if (gridConfig?.regions) regions = gridConfig.regions;
  }

  const clauses = splitScenarioClauses(scenarioText);
  const configuredCombatants = [];

  for (const clause of clauses) {
    // 1. Phase extraction
    let phase = 1;
    const lowerClause = clause.toLowerCase();

    if (
      lowerClause.includes('reinforcement') ||
      lowerClause.includes('reinforcements') ||
      lowerClause.includes('second wave')
    ) {
      phase = 2;
    } else if (
      lowerClause.includes('initial wave') ||
      lowerClause.includes('first wave') ||
      lowerClause.includes('wave 1') ||
      lowerClause.includes('phase 1') ||
      lowerClause.includes('round 1')
    ) {
      phase = 1;
    }

    // Explicit phase/wave/round pattern checks
    const phaseMatch = lowerClause.match(/\bphase\s*(\d+)\b/);
    if (phaseMatch) {
      phase = parseInt(phaseMatch[1], 10);
    } else {
      const waveMatch = lowerClause.match(/\bwave\s*(\d+)\b/);
      if (waveMatch) {
        phase = parseInt(waveMatch[1], 10);
      } else {
        const roundMatch = lowerClause.match(/\bround\s*(\d+)\b/);
        if (roundMatch) {
          const r = parseInt(roundMatch[1], 10);
          phase = r === 1 ? 1 : 2;
        }
      }
    }

    // 2. Faction extraction (whole-word match; see FACTION_ALLY_REGEX above)
    let faction = 'enemy';
    if (FACTION_ALLY_REGEX.test(clause)) {
      faction = 'ally';
    } else if (FACTION_NEUTRAL_REGEX.test(clause)) {
      faction = 'neutral';
    }

    // 3. Location / Coordinates / Region extraction
    let detectedCoord = null;
    let detectedRegionName = undefined;

    // Region check against encounter regions
    for (const reg of regions) {
      if (reg.name && lowerClause.includes(reg.name.toLowerCase())) {
        detectedRegionName = reg.name;
        break;
      }
    }

    // Coordinate in parentheses: e.g. (B3) or (H1) or (12, 8)
    const parenCoordMatch = clause.match(/\((([A-Za-z]+\d+)|(\d+\s*,\s*\d+))\)/);
    if (parenCoordMatch) {
      try {
        detectedCoord = labelToCoordinate(parenCoordMatch[1]);
      } catch {}
    }

    // Coordinate with preposition: e.g. at B3, from H1
    if (!detectedCoord) {
      const prepCoordMatch = clause.match(/\b(?:at|from|in|to)\s+(([A-Za-z]+\d+)|(\d+\s*,\s*\d+))\b/i);
      if (prepCoordMatch) {
        try {
          detectedCoord = labelToCoordinate(prepCoordMatch[1]);
        } catch {}
      }
    }

    // Standalone coordinate label check e.g. "B3", "H1", "M9"
    if (!detectedCoord) {
      const standaloneMatch = clause.match(/\b([A-Za-z]\d{1,2})\b/);
      if (standaloneMatch) {
        try {
          detectedCoord = labelToCoordinate(standaloneMatch[1]);
        } catch {}
      }
    }

    // If no coordinate found but region was found, pick region's first cell
    if (!detectedCoord && detectedRegionName) {
      const regObj = regions.find((r) => r.name === detectedRegionName);
      if (regObj && regObj.cells && regObj.cells.length > 0) {
        try {
          detectedCoord = labelToCoordinate(regObj.cells[0]);
        } catch {}
      }
    }

    // Default fallback coordinate. Flag this so the proposal card can tell
    // the DM "we had no idea" apart from "the text said A1" — otherwise a
    // clause with no location reads as a deliberate placement (see N-4).
    let placementInferred = false;
    if (!detectedCoord) {
      detectedCoord = { x: 0, y: 0 };
      placementInferred = true;
    }

    // 4. Monster & Quantity extraction
    let matchedMonster = null;
    let monsterName = '';
    let monsterId = undefined;
    let count = 1;

    // Check tag syntax: @Monster[goblin]{Goblin} or @Monster[goblin]
    const tagMatch = clause.match(/@Monster\[([^\]]+)\](?:\{([^}]+)\})?/i);
    if (tagMatch) {
      const tagId = tagMatch[1];
      const tagLabel = tagMatch[2] || tagId;
      matchedMonster = findMonster(tagId, allMonsters) || findMonster(tagLabel, allMonsters);
      monsterName = tagLabel;
      monsterId = matchedMonster ? matchedMonster.id : tagId;

      // Extract count preceding tag
      const preTag = clause.slice(0, tagMatch.index).trim();
      const numMatch = preTag.match(/\b(\d+)\b\s*$/);
      if (numMatch) {
        count = parseInt(numMatch[1], 10);
      } else {
        const wordMatch = preTag.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\b\s*$/i);
        if (wordMatch) {
          count = WORD_TO_NUM[wordMatch[1].toLowerCase()] || 1;
        }
      }
    } else {
      // Natural language matching against monster database
      // Check candidate monsters sorted by name length descending
      let bestMatch = null;
      let bestIndex = -1;
      let matchedTerm = '';

      for (const { monster: m, regex } of getMonsterRegexes(allMonsters)) {
        const match = clause.match(regex);
        if (match) {
          if (!bestMatch || m.name.length > bestMatch.name.length) {
            bestMatch = m;
            bestIndex = match.index;
            matchedTerm = match[0];
          }
        }
      }

      if (bestMatch) {
        matchedMonster = bestMatch;
        monsterName = bestMatch.name;
        monsterId = bestMatch.id;

        // Check for count preceding the monster name
        const preMonster = clause.slice(0, bestIndex).trim();
        const numMatch = preMonster.match(/\b(\d+)\b\s*$/);
        if (numMatch) {
          count = parseInt(numMatch[1], 10);
        } else {
          const wordMatch = preMonster.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\b\s*$/i);
          if (wordMatch) {
            count = WORD_TO_NUM[wordMatch[1].toLowerCase()] || 1;
          }
        }
      } else {
        // Fallback: extract capitalized word or phrase right after count
        const genericMatch = clause.match(/\b(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|a|an))\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)/);
        if (genericMatch) {
          const numStr = genericMatch[1];
          const wordStr = genericMatch[2];
          count = numStr ? parseInt(numStr, 10) : (WORD_TO_NUM[wordStr.toLowerCase()] || 1);
          let rawName = genericMatch[3].trim();
          if (rawName.endsWith('s') && rawName.length > 3) {
            rawName = rawName.slice(0, -1);
          }
          monsterName = rawName;
          monsterId = rawName.toLowerCase().replace(/\s+/g, '-');
          matchedMonster = findMonster(monsterName, allMonsters);
          if (matchedMonster) {
            monsterId = matchedMonster.id;
            monsterName = matchedMonster.name;
          }
        }
      }
    }

    // If still no monster identified, skip clause unless valid combatant detected
    if (!monsterName) continue;

    count = Math.max(1, count);
    if (count > MAX_COMBATANTS_PER_CLAUSE) {
      throw new Error(
        `Scenario asks for ${count} x "${monsterName}", which exceeds the maximum of ${MAX_COMBATANTS_PER_CLAUSE} combatants per group. Please use a smaller number.`
      );
    }

    // Resolve monster stats
    let hp = 10;
    let hpDice = '1d8';
    let dexMod = 0;
    let monsterType = monsterName;

    if (matchedMonster) {
      hp = matchedMonster.attributes?.hp?.value || 10;
      hpDice = matchedMonster.attributes?.hp?.dice || '1d8';
      dexMod = matchedMonster.stats?.DEX?.modifier ?? matchedMonster.stats?.dex?.modifier ?? 0;
      monsterType = matchedMonster.name;
      if (!monsterId) monsterId = matchedMonster.id;
    }

    // Generate units and allocate coordinates with conflict resolution
    for (let i = 1; i <= count; i++) {
      const unitName = count === 1 ? monsterName : `${monsterName} ${i}`;
      const allocated = allocateTokenCoordinates(detectedCoord, occupiedCells, gridConfig);
      const label = allocated.label || coordinateToLabel(allocated.x, allocated.y);
      const regName = detectedRegionName || resolveRegionName(allocated, regions);

      configuredCombatants.push({
        name: unitName,
        monsterId: monsterId || undefined,
        monsterType,
        coordinates: {
          x: allocated.x,
          y: allocated.y,
          label,
          regionName: regName || undefined,
          placementInferred: placementInferred || undefined,
        },
        phase,
        faction,
        hp,
        hpDice,
        dexMod,
      });
    }
  }

  return configuredCombatants;
}
