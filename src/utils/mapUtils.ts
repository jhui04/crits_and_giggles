import type { Position, MapSize, EncounterUnit, MapRegion, MapWallsData } from '../types';
import { isStepBlockedByWall, wallEdgeToSegment, lineSegmentsIntersect } from './coverCalculation';

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
 * Converts a {x, y} coordinate into human- and screen-reader-friendly label (e.g. "A1", "C4").
 */
export function coordinateToLabel(pos: Position): string {
  return `${columnIndexToLabel(pos.x)}${pos.y + 1}`;
}

// columnLabelToIndex, labelToCoordinate, resolveRegionName, and
// calculateAdjacencies used to be duplicated here, but nothing in this
// frontend actually imported them — the equivalent (and actively used)
// server-side logic lives in server/assistant/gridUtils.js. Keeping an
// unused duplicate around risks silent drift between the two (that's
// exactly what happened with the G-15 damage-type substring bug); see R-2
// in out_of_scope.md for the reasoning. `columnIndexToLabel` and
// `coordinateToLabel` above remain here because production components
// (CombatMap, MoveTowardsModal, CreatureJumpModal, etc.) do use them for
// display.

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

  const width = Math.max(1, mapSize.width);
  const height = Math.max(1, mapSize.height);
  const maxAttempts = width * height;

  const startMonsterCol = width > 2 ? 1 : 0;
  const colLimit = width > 2 ? width - 1 : width;
  let monsterCol = startMonsterCol;
  let monsterRow = Math.min(1, height - 1);

  const startPlayerCol = width > 2 ? 1 : 0;
  let playerCol = startPlayerCol;
  let playerRow = Math.max(0, height - 2);

  return units.map(unit => {
    if (unit.position && uPositionValid(unit.position, mapSize)) {
      return unit;
    }

    let pos: Position;

    if (unit.isPlayer) {
      let attempts = 0;
      while (occupied.has(`${playerCol},${playerRow}`) && attempts < maxAttempts) {
        attempts++;
        playerCol++;
        if (playerCol >= colLimit) {
          playerCol = startPlayerCol;
          playerRow = playerRow > 0 ? playerRow - 1 : height - 1;
        }
      }
      pos = { x: playerCol, y: playerRow };
      occupied.add(`${pos.x},${pos.y}`);
      playerCol++;
      if (playerCol >= colLimit) {
        playerCol = startPlayerCol;
        playerRow = playerRow > 0 ? playerRow - 1 : height - 1;
      }
    } else {
      let attempts = 0;
      while (occupied.has(`${monsterCol},${monsterRow}`) && attempts < maxAttempts) {
        attempts++;
        monsterCol++;
        if (monsterCol >= colLimit) {
          monsterCol = startMonsterCol;
          monsterRow = (monsterRow + 1) % height;
        }
      }
      pos = { x: monsterCol, y: monsterRow };
      occupied.add(`${pos.x},${pos.y}`);
      monsterCol++;
      if (monsterCol >= colLimit) {
        monsterCol = startMonsterCol;
        monsterRow = (monsterRow + 1) % height;
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
 * Breadth-First Search (BFS) pathfinder that finds the shortest route on a square grid
 * avoiding walls, closed doors, and impassable obstacles.
 */
export function findPathAroundWalls(
  from: Position,
  to: Position,
  walls?: MapWallsData,
  mapSize?: MapSize
): Position[] | null {
  if (!walls || ((!walls.edges || walls.edges.length === 0) && (!walls.segments || walls.segments.length === 0) && (!walls.obstacleCells || Object.keys(walls.obstacleCells).length === 0))) {
    return null;
  }

  const width = mapSize?.width || 50;
  const height = mapSize?.height || 50;

  // 8 directions (cardinals first, then diagonals)
  const directions = [
    { dx: 0, dy: -1 }, // N
    { dx: 1, dy: 0 },  // E
    { dx: 0, dy: 1 },  // S
    { dx: -1, dy: 0 }, // W
    { dx: 1, dy: -1 }, // NE
    { dx: 1, dy: 1 },  // SE
    { dx: -1, dy: 1 }, // SW
    { dx: -1, dy: -1 } // NW
  ];

  const queue: Position[] = [from];
  const parentMap = new Map<string, Position | null>();
  parentMap.set(`${from.x},${from.y}`, null);

  let reachedTarget = false;
  let targetEndPos = to;

  const isDestSolid = walls.obstacleCells && walls.obstacleCells[`${to.x},${to.y}`]?.type === 'full';

  while (queue.length > 0) {
    const curr = queue.shift()!;

    if (curr.x === to.x && curr.y === to.y) {
      reachedTarget = true;
      targetEndPos = curr;
      break;
    }

    if (isDestSolid && calculateDistance(curr, to) <= 5) {
      reachedTarget = true;
      targetEndPos = curr;
      break;
    }

    for (const dir of directions) {
      const nx = curr.x + dir.dx;
      const ny = curr.y + dir.dy;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nKey = `${nx},${ny}`;
      if (parentMap.has(nKey)) continue;

      const nextPos: Position = { x: nx, y: ny };

      // Cardinal movement check
      if (dir.dx === 0 || dir.dy === 0) {
        const block = isStepBlockedByWall(curr, nextPos, walls);
        if (block.blocked) continue;
      } else {
        // Diagonal movement check: prevent corner cutting through wall corners
        const step1: Position = { x: curr.x + dir.dx, y: curr.y };
        const step2: Position = { x: curr.x, y: curr.y + dir.dy };

        const block1 = isStepBlockedByWall(curr, step1, walls);
        const block2 = isStepBlockedByWall(curr, step2, walls);

        // No corner cutting: a diagonal step is blocked if either orthogonal leg is blocked.
        if (block1.blocked || block2.blocked) continue;

        // Destination obstacle check
        if (walls.obstacleCells) {
          const obs = walls.obstacleCells[`${nx},${ny}`];
          if (obs && (obs.type === 'full' || obs.type === 'three_quarters')) continue;
        }

        // Direct diagonal intersection with wall edges
        // Wall segments live in grid-corner coordinates, so the diagonal is tested
        // between cell centres (+0.5). Segment ends are shrunk slightly so a wall that
        // merely touches the shared corner is not treated as crossing.
        let diagonalWallBlocked = false;
        if (walls.edges) {
          const centerA = { x: curr.x + 0.5, y: curr.y + 0.5 };
          const centerB = { x: nx + 0.5, y: ny + 0.5 };
          for (const edge of walls.edges) {
            if (edge.type === 'door_open') continue;
            const seg = wallEdgeToSegment(edge);
            const sx = seg.p2.x - seg.p1.x;
            const sy = seg.p2.y - seg.p1.y;
            const len = Math.hypot(sx, sy) || 1;
            const shrink = 0.02 / len;
            const a = { x: seg.p1.x + sx * shrink, y: seg.p1.y + sy * shrink };
            const b = { x: seg.p2.x - sx * shrink, y: seg.p2.y - sy * shrink };
            if (lineSegmentsIntersect(centerA, centerB, a, b, 0.0001)) {
              diagonalWallBlocked = true;
              break;
            }
          }
        }
        if (diagonalWallBlocked) continue;

        // Compiled free wall segments (MapWallsData.segments) can run diagonally
        // themselves, so a diagonal step can cross one directly even when both
        // orthogonal legs (block1/block2 above) are clear. isStepBlockedByWall's
        // segment check (1b) tests the centre-to-centre line against `segments`
        // and already respects one-way walls, so reuse it for the diagonal itself.
        const diagonalSegmentBlock = isStepBlockedByWall(curr, nextPos, walls);
        if (diagonalSegmentBlock.blocked) continue;
      }

      parentMap.set(nKey, curr);
      queue.push(nextPos);
    }
  }

  if (!reachedTarget) {
    // Find closest visited position to target
    let closestPos: Position = from;
    let minDistance = Infinity;

    for (const key of parentMap.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      const d = calculateDistance({ x: kx, y: ky }, to);
      if (d < minDistance) {
        minDistance = d;
        closestPos = { x: kx, y: ky };
      }
    }
    targetEndPos = closestPos;
  }

  // Reconstruct path
  const path: Position[] = [];
  let curr: Position | null = targetEndPos;
  while (curr !== null) {
    path.unshift(curr);
    curr = parentMap.get(`${curr.x},${curr.y}`) || null;
  }

  // Exclude start position
  if (path.length > 0 && path[0].x === from.x && path[0].y === from.y) {
    path.shift();
  }

  return path;
}

/**
 * Calculates a new position moving from 'from' towards 'to' by up to 'feet'.
 * Prevents ending movement on an occupied cell (such as the target's square).
 * When walls are provided, uses BFS pathfinding around walls and obstacles.
 */
export function calculateMoveTowards(
  from: Position,
  to: Position,
  feet: number,
  occupied?: Set<string>,
  walls?: MapWallsData,
  mapSize?: MapSize
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

  // If walls are provided, use BFS pathfinder around walls
  const wallPath = findPathAroundWalls(from, to, walls, mapSize);

  let path: Position[];
  let maxStep: number;

  if (wallPath !== null) {
    // Walls present: never fall back to a straight line through them.
    maxStep = Math.min(wallPath.length, requestedCells);
    path = wallPath.slice(0, maxStep);
  } else {
    maxStep = Math.min(totalCells, requestedCells);
    path = [];
    for (let i = 1; i <= maxStep; i++) {
      const x = from.x + Math.round((i * dx) / totalCells);
      const y = from.y + Math.round((i * dy) / totalCells);
      path.push({ x, y });
    }
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

