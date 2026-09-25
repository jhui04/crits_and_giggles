import type { Position, MapWallsData, WallEdge, CoverResult, WallType } from '../types';
import type { WallSegment } from '../shared/spatial/types.ts';
import { segmentsIntersect, sideOf } from '../shared/spatial/geometry.ts';

interface Point2D {
  x: number;
  y: number;
}

interface Segment2D {
  p1: Point2D;
  p2: Point2D;
}

/**
 * Converts a WallEdge between two adjacent cells into a 2D line segment in grid coordinates.
 */
export function wallEdgeToSegment(edge: WallEdge): Segment2D {
  const [x1, y1] = edge.c1;
  const [x2, y2] = edge.c2;

  // Horizontal adjacency: wall is vertical edge
  if (x2 === x1 + 1 && y2 === y1) {
    return {
      p1: { x: x1 + 1, y: y1 },
      p2: { x: x1 + 1, y: y1 + 1 }
    };
  }
  if (x1 === x2 + 1 && y2 === y1) {
    return {
      p1: { x: x2 + 1, y: y2 },
      p2: { x: x2 + 1, y: y2 + 1 }
    };
  }

  // Vertical adjacency: wall is horizontal edge
  if (x2 === x1 && y2 === y1 + 1) {
    return {
      p1: { x: x1, y: y1 + 1 },
      p2: { x: x1 + 1, y: y1 + 1 }
    };
  }
  if (x2 === x1 && y1 === y2 + 1) {
    return {
      p1: { x: x2, y: y2 + 1 },
      p2: { x: x2 + 1, y: y2 + 1 }
    };
  }

  // Fallback for non-strictly adjacent or diagonal definitions
  return {
    p1: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
    p2: { x: (x1 + x2) / 2 + 0.5, y: (y1 + y2) / 2 + 0.5 }
  };
}

/**
 * Tests if ray segment PQ intersects wall segment AB.
 * The implementation lives in src/shared/spatial so the server can use it too.
 */
export const lineSegmentsIntersect = segmentsIntersect;

/** Compiled-map segments the rules should honour: trusted, visible, and not an open door. */
function isRulesSegment(seg: WallSegment): boolean {
  return seg.kind !== 'invisible' && seg.provenance.confidence >= 0.5 && seg.door?.state !== 'open';
}

/**
 * Tests if a ray PQ passes through the interior of an obstacle cell.
 */
export function rayIntersectsObstacleCell(
  p: Point2D,
  q: Point2D,
  cellX: number,
  cellY: number
): boolean {
  const d1A = { x: cellX + 0.05, y: cellY + 0.05 };
  const d1B = { x: cellX + 0.95, y: cellY + 0.95 };
  const d2A = { x: cellX + 0.05, y: cellY + 0.95 };
  const d2B = { x: cellX + 0.95, y: cellY + 0.05 };

  return (
    lineSegmentsIntersect(p, q, d1A, d1B) ||
    lineSegmentsIntersect(p, q, d2A, d2B)
  );
}

/**
 * Gets the 4 corners of a 5ft grid cell slightly inset to avoid corner singularities.
 */
function getCellCorners(pos: Position): Point2D[] {
  return [
    { x: pos.x + 0.1, y: pos.y + 0.1 },  // Top-Left
    { x: pos.x + 0.9, y: pos.y + 0.1 },  // Top-Right
    { x: pos.x + 0.1, y: pos.y + 0.9 },  // Bottom-Left
    { x: pos.x + 0.9, y: pos.y + 0.9 }   // Bottom-Right
  ];
}

interface RayBlockInfo {
  blocked: boolean;
  blockType: WallType | 'none';
  blockerName?: string;
}

/**
 * Evaluates whether a single ray from attacker corner to target corner is blocked,
 * and by what severity.
 */
function testRay(
  start: Point2D,
  end: Point2D,
  attackerPos: Position,
  targetPos: Position,
  walls: MapWallsData
): RayBlockInfo {
  let highestBlock: WallType | 'none' = 'none';
  let blockerName: string | undefined;

  // Check wall edges
  if (walls.edges) {
    for (const edge of walls.edges) {
      if (edge.type === 'door_open') continue;

      const seg = wallEdgeToSegment(edge);
      if (lineSegmentsIntersect(start, end, seg.p1, seg.p2)) {
        if (edge.type === 'full' || edge.type === 'door_closed') {
          return {
            blocked: true,
            blockType: edge.type,
            blockerName: edge.name || (edge.type === 'door_closed' ? 'Closed Door' : 'Solid Wall')
          };
        }
        if (edge.type === 'three_quarters') {
          highestBlock = 'three_quarters';
          blockerName = edge.name || 'Heavy Cover';
        } else if (edge.type === 'half' && highestBlock === 'none') {
          highestBlock = 'half';
          blockerName = edge.name || 'Low Wall';
        }
      }
    }
  }

  // Check compiled free-form wall segments
  if (walls.segments) {
    for (const seg of walls.segments) {
      if (!isRulesSegment(seg) || !lineSegmentsIntersect(start, end, seg.a, seg.b)) continue;
      const name = seg.name || seg.kind.replace(/_/g, ' ');
      if (seg.cover === 'total') return { blocked: true, blockType: 'full', blockerName: name };
      if (seg.cover === 'three_quarters') {
        highestBlock = 'three_quarters';
        blockerName = name;
      } else if (highestBlock === 'none') {
        highestBlock = 'half';
        blockerName = name;
      }
    }
  }

  // Check interior obstacle cells
  if (walls.obstacleCells) {
    for (const [, obs] of Object.entries(walls.obstacleCells)) {
      if (obs.x === attackerPos.x && obs.y === attackerPos.y) continue;
      if (obs.x === targetPos.x && obs.y === targetPos.y) continue;

      if (rayIntersectsObstacleCell(start, end, obs.x, obs.y)) {
        if (obs.type === 'full') {
          return {
            blocked: true,
            blockType: 'full',
            blockerName: obs.name || 'Solid Obstacle'
          };
        }
        if (obs.type === 'three_quarters') {
          highestBlock = 'three_quarters';
          blockerName = obs.name || 'Heavy Obstacle';
        } else if (obs.type === 'half' && highestBlock === 'none') {
          highestBlock = 'half';
          blockerName = obs.name || 'Obstacle';
        }
      }
    }
  }

  return {
    blocked: highestBlock !== 'none',
    blockType: highestBlock,
    blockerName
  };
}

/**
 * Calculates cover according to official D&D 5e Rules As Written:
 * 1. Attacker chooses the corner of their space that provides the most favorable path.
 * 2. Trace rays from that corner to all 4 corners of target's space.
 * 3. Count blocked lines:
 *    - 0 lines blocked: No cover
 *    - 1-2 lines blocked: Half Cover (+2 AC, +2 Dex save)
 *    - 3-4 lines blocked: Three-Quarters Cover (+5 AC, +5 Dex save)
 *    - All lines blocked by solid obstructions: Total Cover (target cannot be targeted)
 */
export function calculateCover(
  attackerPos: Position,
  targetPos: Position,
  walls?: MapWallsData
): CoverResult {
  if (!walls || ((!walls.edges || walls.edges.length === 0) && (!walls.segments || walls.segments.length === 0) && (!walls.obstacleCells || Object.keys(walls.obstacleCells).length === 0))) {
    return {
      type: 'none',
      acBonus: 0,
      dexSaveBonus: 0,
      description: 'No Cover',
      blockers: []
    };
  }

  if (attackerPos.x === targetPos.x && attackerPos.y === targetPos.y) {
    return {
      type: 'none',
      acBonus: 0,
      dexSaveBonus: 0,
      description: 'No Cover (Same Space)',
      blockers: []
    };
  }

  // Check if attacker and target are immediately adjacent and separated directly by a wall edge
  if (walls.edges) {
    const ax = attackerPos.x;
    const ay = attackerPos.y;
    const tx = targetPos.x;
    const ty = targetPos.y;

    for (const edge of walls.edges) {
      const isDirectBetween =
        (edge.c1[0] === ax && edge.c1[1] === ay && edge.c2[0] === tx && edge.c2[1] === ty) ||
        (edge.c2[0] === ax && edge.c2[1] === ay && edge.c1[0] === tx && edge.c1[1] === ty);

      if (isDirectBetween) {
        if (edge.type === 'door_open') {
          return { type: 'none', acBonus: 0, dexSaveBonus: 0, description: 'No Cover (Open Door)', blockers: [] };
        }
        if (edge.type === 'full' || edge.type === 'door_closed') {
          const name = edge.name || (edge.type === 'door_closed' ? 'Closed Door' : 'Solid Wall');
          return {
            type: 'total',
            acBonus: 0,
            dexSaveBonus: 0,
            description: `Total Cover behind ${name} (Line of sight blocked)`,
            blockers: [name]
          };
        }
        if (edge.type === 'three_quarters') {
          const name = edge.name || 'Heavy Cover';
          return {
            type: 'three_quarters',
            acBonus: 5,
            dexSaveBonus: 5,
            description: `Three-Quarters Cover behind ${name} (+5 AC)`,
            blockers: [name]
          };
        }
        if (edge.type === 'half') {
          const name = edge.name || 'Low Wall';
          return {
            type: 'half',
            acBonus: 2,
            dexSaveBonus: 2,
            description: `Half Cover behind ${name} (+2 AC)`,
            blockers: [name]
          };
        }
      }
    }
  }

  const attackerCorners = getCellCorners(attackerPos);
  const targetCorners = getCellCorners(targetPos);

  let bestCornerBlockedCount = Infinity;
  let bestCornerBlockers: string[] = [];
  let bestCornerSolidCount = 0;
  let bestCornerThreeQuartersCount = 0;

  // Attacker evaluates all 4 corners and chooses the one with the clearest line
  for (const aCorner of attackerCorners) {
    let blockedCount = 0;
    let solidCount = 0;
    let threeQuartersCount = 0;
    const blockersSet = new Set<string>();

    for (const tCorner of targetCorners) {
      const result = testRay(aCorner, tCorner, attackerPos, targetPos, walls);
      if (result.blocked) {
        blockedCount++;
        if (result.blockType === 'full' || result.blockType === 'door_closed') {
          solidCount++;
        } else if (result.blockType === 'three_quarters') {
          threeQuartersCount++;
        }
        if (result.blockerName) {
          blockersSet.add(result.blockerName);
        }
      }
    }

    // Is this corner better than previous corners?
    if (blockedCount < bestCornerBlockedCount) {
      bestCornerBlockedCount = blockedCount;
      bestCornerSolidCount = solidCount;
      bestCornerThreeQuartersCount = threeQuartersCount;
      bestCornerBlockers = Array.from(blockersSet);
    }
  }

  const blockersDesc = bestCornerBlockers.length > 0 ? ` behind ${bestCornerBlockers.join(', ')}` : '';

  // All 4 lines blocked by solid walls/doors: Total Cover
  if (bestCornerSolidCount === 4) {
    return {
      type: 'total',
      acBonus: 0,
      dexSaveBonus: 0,
      description: `Total Cover${blockersDesc} (Line of sight blocked)`,
      blockers: bestCornerBlockers
    };
  }

  const hasThreeQuarters = bestCornerThreeQuartersCount > 0;
  const hasSolid = bestCornerSolidCount > 0;

  // 3 lines blocked by solid wall, or 3+ lines blocked with three-quarters obstacle: Three-Quarters Cover
  if (
    bestCornerSolidCount >= 3 ||
    (bestCornerBlockedCount >= 3 && (hasThreeQuarters || hasSolid)) ||
    bestCornerThreeQuartersCount >= 2
  ) {
    return {
      type: 'three_quarters',
      acBonus: 5,
      dexSaveBonus: 5,
      description: `Three-Quarters Cover${blockersDesc} (+5 AC)`,
      blockers: bestCornerBlockers
    };
  }

  // 1 or more lines blocked: Half Cover
  if (bestCornerBlockedCount >= 1) {
    return {
      type: 'half',
      acBonus: 2,
      dexSaveBonus: 2,
      description: `Half Cover${blockersDesc} (+2 AC)`,
      blockers: bestCornerBlockers
    };
  }

  return {
    type: 'none',
    acBonus: 0,
    dexSaveBonus: 0,
    description: 'No Cover',
    blockers: []
  };
}

export interface StepBlockResult {
  blocked: boolean;
  wallType?: WallType;
  wallName?: string;
  reason?: string;
}

/**
 * Checks if physical movement between two adjacent cells is blocked by a wall or obstacle.
 * Returns blocked: true if blocked by full wall, closed door, half wall/fence, three-quarters wall,
 * or solid obstacle cell.
 */
export function isStepBlockedByWall(
  from: Position,
  to: Position,
  walls?: MapWallsData
): StepBlockResult {
  if (!walls) return { blocked: false };

  // 1. Direct wall edge check
  if (walls.edges) {
    const ax = from.x;
    const ay = from.y;
    const tx = to.x;
    const ty = to.y;

    for (const edge of walls.edges) {
      if (!edge.c1 || !edge.c2) continue;
      const isDirectBetween =
        (edge.c1[0] === ax && edge.c1[1] === ay && edge.c2[0] === tx && edge.c2[1] === ty) ||
        (edge.c2[0] === ax && edge.c2[1] === ay && edge.c1[0] === tx && edge.c1[1] === ty);

      if (isDirectBetween) {
        if (edge.type === 'door_open') {
          return { blocked: false };
        }
        if (edge.type === 'full' || edge.type === 'door_closed' || edge.type === 'half' || edge.type === 'three_quarters') {
          const name = edge.name || (edge.type === 'door_closed' ? 'Closed Door' : 'Wall');
          return {
            blocked: true,
            wallType: edge.type,
            wallName: name,
            reason: `Blocked by ${name}`
          };
        }
      }
    }
  }

  // 1b. Compiled wall segments crossing the line between the two cell centres
  if (walls.segments) {
    const a = { x: from.x + 0.5, y: from.y + 0.5 };
    const b = { x: to.x + 0.5, y: to.y + 0.5 };
    for (const seg of walls.segments) {
      if (!seg.blocksMovement || !isRulesSegment(seg) || !lineSegmentsIntersect(a, b, seg.a, seg.b)) continue;
      if (seg.oneWay) {
        // A one-way wall only stops creatures approaching from its marked side.
        const s = sideOf(seg.a, seg.b, a);
        if (!(seg.oneWay === 'left' ? s < 0 : s > 0)) continue;
      }
      const name = seg.name || seg.kind.replace(/_/g, ' ');
      return {
        blocked: true,
        wallType: seg.cover === 'total' ? 'full' : seg.cover,
        wallName: name,
        reason: `Blocked by ${name}`
      };
    }
  }

  // 2. Obstacle cell check on destination
  if (walls.obstacleCells) {
    const key = `${to.x},${to.y}`;
    const obs = walls.obstacleCells[key];
    if (obs && (obs.type === 'full' || obs.type === 'three_quarters')) {
      const name = obs.name || 'Solid Obstacle';
      return {
        blocked: true,
        wallType: obs.type,
        wallName: name,
        reason: `Blocked by ${name}`
      };
    }
  }

  return { blocked: false };
}

