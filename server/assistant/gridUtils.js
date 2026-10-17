/**
 * Shared grid coordinate and region helpers.
 *
 * These used to be defined twice — once in toolController.js and once in
 * combatantParser.js — which meant any fix (e.g. the columnIndexToLabel
 * Infinity-loop guard) had to be applied in both places by hand. Both
 * modules now import from here instead.
 */

/**
 * Converts a 0-indexed column number to spreadsheet column letters.
 * 0 -> A, 25 -> Z, 26 -> AA, etc.
 */
export function columnIndexToLabel(index) {
  if (index < 0 || typeof index !== 'number' || !Number.isFinite(index)) return '';
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode((num % 26) + 65) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
}

/**
 * Converts a (x, y) coordinate into standard D&D grid cell label (e.g. "A1", "C4").
 */
export function coordinateToLabel(x, y) {
  return `${columnIndexToLabel(x)}${y + 1}`;
}

/**
 * Converts spreadsheet column letters into 0-indexed column number.
 * "A" -> 0, "Z" -> 25, "AA" -> 26, "AB" -> 27, etc.
 */
export function columnLabelToIndex(label) {
  if (!label || typeof label !== 'string') return -1;
  const upper = label.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) return -1;
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Parses a coordinate label into a 0-indexed Position { x, y }.
 * Supports spreadsheet format ("A1" -> { x: 0, y: 0 }, "M9" -> { x: 12, y: 8 })
 * and comma-separated integers ("0,0" -> { x: 0, y: 0 }, "12, 8" -> { x: 12, y: 8 }).
 */
export function labelToCoordinate(label) {
  if (!label || typeof label !== 'string') {
    throw new Error(`Invalid coordinate label: "${label}". Must be a non-empty string.`);
  }

  const trimmed = label.trim();

  // Support "x,y" or "x, y" format
  const commaMatch = trimmed.match(/^(\d+)\s*,\s*(\d+)$/);
  if (commaMatch) {
    return {
      x: parseInt(commaMatch[1], 10),
      y: parseInt(commaMatch[2], 10),
    };
  }

  // Support spreadsheet format like "A1", "M9", "AA10", "A-1"
  const alphaMatch = trimmed.match(/^([A-Za-z]+)\s*[-_]?\s*(\d+)$/);
  if (!alphaMatch) {
    throw new Error(`Invalid coordinate label "${label}". Expected format like "A1", "M9", or "x,y".`);
  }

  const colLetters = alphaMatch[1];
  const rowNumber = parseInt(alphaMatch[2], 10);

  if (rowNumber < 1) {
    throw new Error(`Invalid coordinate label "${label}": row number must be >= 1.`);
  }

  const x = columnLabelToIndex(colLetters);
  if (x < 0) {
    throw new Error(`Invalid coordinate label "${label}": invalid column letters.`);
  }

  const y = rowNumber - 1;
  return { x, y };
}

/**
 * Calculates standard D&D 5e Chebyshev grid distance in feet between two positions.
 */
export function calculateDistance(from, to) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 5;
}

/**
 * Resolves the semantic map region name for a given grid position from regions list.
 */
export function resolveRegionName(pos, regions) {
  if (!regions || !Array.isArray(regions) || regions.length === 0) return undefined;

  const cellKey = `${pos.x},${pos.y}`;

  // 1. Direct cell membership check
  for (const reg of regions) {
    if (reg.cells && Array.isArray(reg.cells) && reg.cells.includes(cellKey)) {
      return reg.name;
    }
  }

  // 2. Bounding box fallback
  for (const reg of regions) {
    if (reg.bounds) {
      const { minCol, maxCol, minRow, maxRow } = reg.bounds;
      if (pos.x >= minCol && pos.x <= maxCol && pos.y >= minRow && pos.y <= maxRow) {
        return reg.name;
      }
    }
  }

  return undefined;
}

/**
 * Calculates adjacent combatants to a grid position (Chebyshev distance <= 5 ft),
 * categorized by relationship to the moving combatant (allies, enemies, neutral).
 */
export function calculateAdjacencies(pos, movingUnit, combatants) {
  const result = {
    allies: [],
    enemies: [],
    neutral: [],
  };

  if (!combatants || !Array.isArray(combatants) || combatants.length === 0) {
    return result;
  }

  const isMoverPlayer = movingUnit.isPlayer || movingUnit.faction === 'ally';
  const isMoverEnemy = movingUnit.faction === 'enemy' || (!movingUnit.isPlayer && movingUnit.faction !== 'ally' && movingUnit.faction !== 'neutral');

  for (const c of combatants) {
    // Exclude moving combatant itself. Match by instanceId only when the
    // mover has one: two combatants can share a name (e.g. two "Goblin"s),
    // and excluding by name as well would hide the *other* same-named
    // combatant from the adjacency lists too, understating who is actually
    // standing there (see N-6). Name is only used as a fallback for movers
    // that genuinely have no instanceId.
    if (movingUnit.instanceId) {
      if (c.instanceId === movingUnit.instanceId) continue;
    } else if (movingUnit.name && c.name && c.name.toLowerCase() === movingUnit.name.toLowerCase()) {
      continue;
    }

    if (!c.position || typeof c.position.x !== 'number' || typeof c.position.y !== 'number') {
      continue;
    }

    // 5e Chebyshev distance: 5 ft for orthogonal or diagonal adjacency
    const dist = calculateDistance(pos, c.position);
    if (dist <= 5) {
      const name = c.name || 'Unknown';
      const isCPlayer = c.isPlayer || c.faction === 'ally';
      const isCEnemy = c.faction === 'enemy' || (!c.isPlayer && c.faction !== 'ally' && c.faction !== 'neutral');
      const isCNeutral = c.faction === 'neutral';

      if (isCNeutral) {
        result.neutral.push(name);
      } else if (isMoverPlayer) {
        if (isCPlayer) {
          result.allies.push(name);
        } else {
          result.enemies.push(name);
        }
      } else if (isMoverEnemy) {
        if (isCEnemy) {
          result.allies.push(name);
        } else {
          result.enemies.push(name);
        }
      } else {
        result.neutral.push(name);
      }
    }
  }

  return result;
}
