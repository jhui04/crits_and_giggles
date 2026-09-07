import type { Position, MapSize, EncounterUnit, MapRegion } from '../types';

/**
 * Calculates standard D&D 5e grid distance in feet between two positions.
 * Uses Chebyshev distance (max(abs(dx), abs(dy)) * 5) where diagonals count as 5 ft.
 */
export function calculateDistance(from: Position, to: Position): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 5;
}

/**
 * Calculates the 8-point compass direction from origin to destination.
 * Note: Screen/grid Y coordinates increase downwards (South is +dy, North is -dy).
 */
export function calculateDirection(from: Position, to: Position): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) {
    return 'Self';
  }

  // -dy inverts screen Y to standard Cartesian Y so North (+Y) is up
  const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
  const normalized = (angle + 360) % 360;

  if (normalized >= 22.5 && normalized < 67.5) return 'North-East';
  if (normalized >= 67.5 && normalized < 112.5) return 'North';
  if (normalized >= 112.5 && normalized < 157.5) return 'North-West';
  if (normalized >= 157.5 && normalized < 202.5) return 'West';
  if (normalized >= 202.5 && normalized < 247.5) return 'South-West';
  if (normalized >= 247.5 && normalized < 292.5) return 'South';
  if (normalized >= 292.5 && normalized < 337.5) return 'South-East';
  return 'East';
}

/**
 * Converts a 0-indexed column number to spreadsheet column letters.
 * 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, etc.
 */
export function columnIndexToLabel(index: number): string {
  if (index < 0) return '';
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode((num % 26) + 65) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
}

/**
 * Converts a {x, y} coordinate into human- and screen-reader-friendly label (e.g. "A1", "C4").
 */
export function coordinateToLabel(pos: Position): string {
  return `${columnIndexToLabel(pos.x)}${pos.y + 1}`;
}

/**
 * Calculates the representative center cell for a map region.
 * Computes the mean coordinate (centroid) of the region's cells, then finds
 * the actual member cell closest to that centroid (minimizing Euclidean distance).
 * This guarantees the center cell always belongs inside the region, even for irregular,
 * non-convex, or curved shapes.
 */
export function getRegionCenter(region: MapRegion): Position {
  if (!region.cells || region.cells.length === 0) {
    if (region.bounds) {
      return {
        x: Math.floor((region.bounds.minCol + region.bounds.maxCol) / 2),
        y: Math.floor((region.bounds.minRow + region.bounds.maxRow) / 2)
      };
    }
    return { x: 0, y: 0 };
  }

  const coords = region.cells.map(c => {
    const [x, y] = c.split(',').map(Number);
    return { x, y };
  });

  // Arithmetic centroid
  let sumX = 0;
  let sumY = 0;
  for (const p of coords) {
    sumX += p.x;
    sumY += p.y;
  }
  const avgX = sumX / coords.length;
  const avgY = sumY / coords.length;

  // Closest member cell to centroid
  let bestCell = coords[0];
  let minDistanceSq = Infinity;

  for (const p of coords) {
    const dx = p.x - avgX;
    const dy = p.y - avgY;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestCell = p;
    }
  }

  return bestCell;
}

/**
 * Categorizes a coordinate into a human-readable 9-quadrant tactical sector
 * on the battlemap (e.g. "North-West", "North", "North-East", "West", "Central", "East", "South-West", "South", "South-East").
 */
export function getRegionSector(pos: Position, mapSize?: MapSize): string {
  if (!mapSize || mapSize.width <= 0 || mapSize.height <= 0) return 'Central';

  const relX = pos.x / mapSize.width;
  const relY = pos.y / mapSize.height;

  let vert = 'Central';
  if (relY < 0.35) vert = 'North';
  else if (relY > 0.65) vert = 'South';

  let horiz = 'Central';
  if (relX < 0.35) horiz = 'West';
  else if (relX > 0.65) horiz = 'East';

  if (vert === 'Central' && horiz === 'Central') return 'Central';
  if (vert === 'Central') return horiz;
  if (horiz === 'Central') return vert;
  return `${vert}-${horiz}`;
}

/**
 * Organizes regions in order of map location.
 * Sorts primarily from North to South (top of map / lower Y to bottom / higher Y),
 * and secondarily from West to East (left / lower X to right / higher X).
 */
export function sortRegionsByLocation(regions: MapRegion[], mapSize?: MapSize): Array<{ region: MapRegion; center: Position; sector: string }> {
  const list = regions.map(reg => {
    const center = getRegionCenter(reg);
    const sector = getRegionSector(center, mapSize);
    return { region: reg, center, sector };
  });

  return list.sort((a, b) => {
    if (a.center.y !== b.center.y) {
      return a.center.y - b.center.y;
    }
    return a.center.x - b.center.x;
  });
}

/**
 * Automatically assigns positions to units that do not have one, ensuring
 * they do not collide with already positioned units.
 * Monsters/enemies are placed in the North (rows 1, 2, ...).
 * Players/allies are placed in the South (rows height - 2, height - 3, ...).
 */
export function autoDeployUnits(units: EncounterUnit[], mapSize: MapSize): EncounterUnit[] {
  const occupied = new Set<string>();

  // Register existing valid positions
  units.forEach(u => {
    if (u.position && u.position.x >= 0 && u.position.x < mapSize.width && u.position.y >= 0 && u.position.y < mapSize.height) {
      occupied.add(`${u.position.x},${u.position.y}`);
    }
  });

  let monsterCol = 1;
  let monsterRow = 1;
  let playerCol = 1;
  let playerRow = Math.max(1, mapSize.height - 2);

  return units.map(unit => {
    if (unit.position && uPositionValid(unit.position, mapSize)) {
      return unit;
    }

    let pos: Position;

    if (unit.isPlayer) {
      while (occupied.has(`${playerCol},${playerRow}`)) {
        playerCol++;
        if (playerCol >= mapSize.width - 1) {
          playerCol = 1;
          playerRow = Math.max(0, playerRow - 1);
        }
      }
      pos = { x: playerCol, y: playerRow };
      occupied.add(`${pos.x},${pos.y}`);
      playerCol++;
      if (playerCol >= mapSize.width - 1) {
        playerCol = 1;
        playerRow = Math.max(0, playerRow - 1);
      }
    } else {
      while (occupied.has(`${monsterCol},${monsterRow}`)) {
        monsterCol++;
        if (monsterCol >= mapSize.width - 1) {
          monsterCol = 1;
          monsterRow = Math.min(mapSize.height - 1, monsterRow + 1);
        }
      }
      pos = { x: monsterCol, y: monsterRow };
      occupied.add(`${pos.x},${pos.y}`);
      monsterCol++;
      if (monsterCol >= mapSize.width - 1) {
        monsterCol = 1;
        monsterRow = Math.min(mapSize.height - 1, monsterRow + 1);
      }
    }

    return {
      ...unit,
      position: pos
    };
  });
}

function uPositionValid(pos: Position, mapSize: MapSize): boolean {
  return pos.x >= 0 && pos.x < mapSize.width && pos.y >= 0 && pos.y < mapSize.height;
}

/**
 * Retrieves the walk speed in feet for a unit, defaulting to standard 30 ft.
 */
export function getCreatureSpeed(unit: EncounterUnit): number {
  if (unit.fullData?.attributes?.speeds?.walk) {
    const s = unit.fullData.attributes.speeds.walk;
    if (typeof s === 'number') return s;
  }
  return 30;
}

export interface MoveTowardsResult {
  newPos: Position;
  movedFeet: number;
  stoppedEarly: boolean;
  adjacentToTarget: boolean;
}

/**
 * Calculates a new position moving from 'from' towards 'to' by up to 'feet'.
 * Prevents ending movement on an occupied cell (such as the target's square).
 */
export function calculateMoveTowards(
  from: Position,
  to: Position,
  feet: number,
  occupied?: Set<string>
): MoveTowardsResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const totalCells = Math.max(Math.abs(dx), Math.abs(dy));

  if (totalCells === 0 || feet <= 0) {
    return {
      newPos: from,
      movedFeet: 0,
      stoppedEarly: false,
      adjacentToTarget: totalCells <= 1
    };
  }

  const requestedCells = Math.floor(feet / 5);
  const maxStep = Math.min(totalCells, requestedCells);

  // Compute points along path
  const path: Position[] = [];
  for (let i = 1; i <= maxStep; i++) {
    const x = from.x + Math.round((i * dx) / totalCells);
    const y = from.y + Math.round((i * dy) / totalCells);
    path.push({ x, y });
  }

  // Find furthest step that is NOT in occupied set
  let validIndex = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i];
    const key = `${p.x},${p.y}`;
    if (!occupied || !occupied.has(key)) {
      validIndex = i;
      break;
    }
  }

  if (validIndex === -1) {
    return {
      newPos: from,
      movedFeet: 0,
      stoppedEarly: true,
      adjacentToTarget: calculateDistance(from, to) <= 5
    };
  }

  const finalPos = path[validIndex];
  const movedFeet = (validIndex + 1) * 5;
  const stoppedEarly = validIndex < maxStep - 1;
  const distToTargetAfter = calculateDistance(finalPos, to);

  return {
    newPos: finalPos,
    movedFeet,
    stoppedEarly,
    adjacentToTarget: distToTargetAfter <= 5
  };
}

