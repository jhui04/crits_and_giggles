import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateDistance,
  calculateDirection,
  columnIndexToLabel,
  coordinateToLabel,
  autoDeployUnits,
  getCreatureSpeed,
  calculateMoveTowards,
  findPathAroundWalls
} from './mapUtils';
// columnLabelToIndex, labelToCoordinate, resolveRegionName, and
// calculateAdjacencies are no longer duplicated client-side (nothing here
// imported them); this coverage now targets the server module that
// actually runs in production. See R-2 in out_of_scope.md.
import {
  columnLabelToIndex,
  labelToCoordinate,
  resolveRegionName,
  calculateAdjacencies,
} from '../../server/assistant/gridUtils.js';
import type { EncounterUnit, MapRegion, MapSize, Position, MapWallsData } from '../types';
import type { WallSegment } from '../shared/spatial/types.ts';

function seg(id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<WallSegment> = {}): WallSegment {
  return {
    id, a: { x: ax, y: ay }, b: { x: bx, y: by }, kind: 'wall', blocksMovement: true, blocksSight: 'full',
    cover: 'total', provenance: { source: 'ddb-meta', confidence: 0.9 }, ...extra,
  };
}

describe('mapUtils', () => {
  describe('calculateDistance', () => {
    it('returns 0 for identical positions', () => {
      expect(calculateDistance({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(0);
    });

    it('calculates orthogonal distance correctly', () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(20);
      expect(calculateDistance({ x: 0, y: 0 }, { x: 0, y: 3 })).toBe(15);
    });

    it('uses Chebyshev distance for diagonals (diagonals are 5 ft each in 5e)', () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(15);
      expect(calculateDistance({ x: 1, y: 1 }, { x: 4, y: 2 })).toBe(15); // dx=3, dy=1 -> max(3,1)*5 = 15
    });

    it('handles negative direction calculations correctly', () => {
      expect(calculateDistance({ x: 5, y: 5 }, { x: 2, y: 1 })).toBe(20); // dx=-3, dy=-4 -> max(3,4)*5 = 20
    });
  });

  describe('calculateDirection', () => {
    const origin = { x: 5, y: 5 };

    it('returns Self for same position', () => {
      expect(calculateDirection(origin, { x: 5, y: 5 })).toBe('Self');
    });

    it('calculates cardinal directions with screen coordinate Y (North is up/-Y, South is down/+Y)', () => {
      expect(calculateDirection(origin, { x: 5, y: 2 })).toBe('North');
      expect(calculateDirection(origin, { x: 5, y: 8 })).toBe('South');
      expect(calculateDirection(origin, { x: 8, y: 5 })).toBe('East');
      expect(calculateDirection(origin, { x: 2, y: 5 })).toBe('West');
    });

    it('calculates intercardinal directions correctly', () => {
      expect(calculateDirection(origin, { x: 8, y: 2 })).toBe('North-East');
      expect(calculateDirection(origin, { x: 2, y: 2 })).toBe('North-West');
      expect(calculateDirection(origin, { x: 8, y: 8 })).toBe('South-East');
      expect(calculateDirection(origin, { x: 2, y: 8 })).toBe('South-West');
    });
  });

  describe('columnIndexToLabel and coordinateToLabel', () => {
    it('converts single letter columns correctly', () => {
      expect(columnIndexToLabel(0)).toBe('A');
      expect(columnIndexToLabel(2)).toBe('C');
      expect(columnIndexToLabel(25)).toBe('Z');
    });

    it('converts multi-letter columns correctly without crashing or symbols', () => {
      expect(columnIndexToLabel(26)).toBe('AA');
      expect(columnIndexToLabel(27)).toBe('AB');
      expect(columnIndexToLabel(51)).toBe('AZ');
      expect(columnIndexToLabel(52)).toBe('BA');
    });

    it('formats coordinates to friendly 1-based labels', () => {
      expect(coordinateToLabel({ x: 0, y: 0 })).toBe('A1');
      expect(coordinateToLabel({ x: 2, y: 4 })).toBe('C5');
      expect(coordinateToLabel({ x: 26, y: 9 })).toBe('AA10');
    });
  });

  describe('autoDeployUnits', () => {
    const mapSize: MapSize = { width: 10, height: 10 };

    it('preserves units that already have valid positions', () => {
      const units: EncounterUnit[] = [
        {
          instanceId: 'u1',
          name: 'Goblin',
          dexMod: 1,
          isPlayer: false,
          position: { x: 3, y: 3 }
        }
      ];

      const deployed = autoDeployUnits(units, mapSize);
      expect(deployed[0].position).toEqual({ x: 3, y: 3 });
    });

    it('deploys monsters along North and players along South without collision', () => {
      const units: EncounterUnit[] = [
        { instanceId: 'm1', name: 'Goblin 1', dexMod: 1, isPlayer: false },
        { instanceId: 'm2', name: 'Goblin 2', dexMod: 1, isPlayer: false },
        { instanceId: 'p1', name: 'Grog', dexMod: 2, isPlayer: true },
        { instanceId: 'p2', name: 'Vex', dexMod: 4, isPlayer: true }
      ];

      const deployed = autoDeployUnits(units, mapSize);

      // Monsters should be near row 1 (North)
      expect(deployed[0].position?.y).toBe(1);
      expect(deployed[1].position?.y).toBe(1);
      expect(deployed[0].position?.x).not.toEqual(deployed[1].position?.x);

      // Players should be near row 8 (South)
      expect(deployed[2].position?.y).toBe(8);
      expect(deployed[3].position?.y).toBe(8);
      expect(deployed[2].position?.x).not.toEqual(deployed[3].position?.x);

      // Verify all positions are unique
      const coords = deployed.map(u => `${u.position?.x},${u.position?.y}`);
      expect(new Set(coords).size).toBe(4);
    });

    it('gracefully handles small or densely occupied maps without infinite loops', () => {
      const units: EncounterUnit[] = [
        { instanceId: 'u1', name: 'Goblin 1', isPlayer: false, dexMod: 2 },
        { instanceId: 'u2', name: 'Goblin 2', isPlayer: false, dexMod: 2 },
        { instanceId: 'u3', name: 'Fighter', isPlayer: true, dexMod: 1 },
      ];
      // Small 2x2 map
      const deployed = autoDeployUnits(units, { width: 2, height: 2 });
      expect(deployed.length).toBe(3);
      deployed.forEach(u => {
        expect(u.position).toBeDefined();
        expect(u.position!.x).toBeGreaterThanOrEqual(0);
        expect(u.position!.x).toBeLessThan(2);
        expect(u.position!.y).toBeGreaterThanOrEqual(0);
        expect(u.position!.y).toBeLessThan(2);
      });
    });
  });

  describe('getCreatureSpeed', () => {
    it('returns monster walk speed if present', () => {
      const unit = {
        name: 'Goblin',
        fullData: { attributes: { speeds: { walk: 40 } } }
      } as unknown as EncounterUnit;
      expect(getCreatureSpeed(unit)).toBe(40);
    });

    it('defaults to 30 ft if speed is not specified', () => {
      const unit = { name: 'Player' } as EncounterUnit;
      expect(getCreatureSpeed(unit)).toBe(30);
    });
  });

  describe('calculateMoveTowards', () => {
    const from: Position = { x: 1, y: 1 };
    const target: Position = { x: 1, y: 5 }; // 4 cells away (20 ft)

    it('moves partially towards target without entering target cell', () => {
      // 10 ft move (2 cells) from (1,1) towards (1,5)
      const res = calculateMoveTowards(from, target, 10);
      expect(res.newPos).toEqual({ x: 1, y: 3 });
      expect(res.movedFeet).toBe(10);
      expect(res.adjacentToTarget).toBe(false);
    });

    it('stops adjacent to target if requested distance reaches target cell and target is occupied', () => {
      const occupied = new Set<string>(['1,5']); // target is at (1,5)
      // Moving 20 ft (reaches target)
      const res = calculateMoveTowards(from, target, 20, occupied);
      expect(res.newPos).toEqual({ x: 1, y: 4 }); // stops at 1,4 (15 ft)
      expect(res.movedFeet).toBe(15);
      expect(res.stoppedEarly).toBe(true);
      expect(res.adjacentToTarget).toBe(true);
    });

    it('handles diagonal movement towards target', () => {
      const diagonalTarget: Position = { x: 4, y: 4 }; // 3 cells diagonal (15 ft)
      const res = calculateMoveTowards(from, diagonalTarget, 10); // 2 cells diagonal
      expect(res.newPos).toEqual({ x: 3, y: 3 });
      expect(res.movedFeet).toBe(10);
    });

    it('navigates around a wall barrier when walls are provided', () => {
      // Wall between y=1 and y=2 at x=2
      const walls = {
        edges: [
          { id: 'w1', c1: [2, 1] as [number, number], c2: [2, 2] as [number, number], type: 'full' as const, name: 'Stone Wall' }
        ]
      };
      const mapSize: MapSize = { width: 10, height: 10 };

      // From (2, 1) towards (2, 3). Direct South crosses the wall edge between (2,1) and (2,2).
      // With walls, 5 ft movement (1 step) cannot step directly to (2,2).
      const res = calculateMoveTowards({ x: 2, y: 1 }, { x: 2, y: 3 }, 5, undefined, walls, mapSize);
      expect(res.movedFeet).toBe(5);
      expect(res.newPos).not.toEqual({ x: 2, y: 2 });
      expect(res.newPos.x).not.toBe(2); // Routed laterally around x=2
    });
  });

  describe('findPathAroundWalls', () => {
    const mapSize: MapSize = { width: 10, height: 10 };

    it('returns null when walls data is empty or undefined', () => {
      expect(findPathAroundWalls({ x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
      expect(findPathAroundWalls({ x: 0, y: 0 }, { x: 2, y: 2 }, { edges: [] })).toBeNull();
    });

    it('routes around a wall edge', () => {
      // Horizontal wall between y=1 and y=2 at column 2
      const walls = {
        edges: [
          { id: 'w1', c1: [2, 1] as [number, number], c2: [2, 2] as [number, number], type: 'full' as const }
        ]
      };

      const path = findPathAroundWalls({ x: 2, y: 1 }, { x: 2, y: 3 }, walls, mapSize);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(2);
      // First step should not be (2, 2) because crossing directly South from (2, 1) to (2, 2) is blocked by the wall
      expect(path![0]).not.toEqual({ x: 2, y: 2 });
      // The destination must be reached
      expect(path![path!.length - 1]).toEqual({ x: 2, y: 3 });
    });

    it('allows passing through open doors but blocks closed doors', () => {
      const closedDoorWalls = {
        edges: [
          { id: 'd1', c1: [2, 1] as [number, number], c2: [2, 2] as [number, number], type: 'door_closed' as const }
        ]
      };
      const openDoorWalls = {
        edges: [
          { id: 'd2', c1: [2, 1] as [number, number], c2: [2, 2] as [number, number], type: 'door_open' as const }
        ]
      };

      const closedPath = findPathAroundWalls({ x: 2, y: 1 }, { x: 2, y: 3 }, closedDoorWalls, mapSize);
      expect(closedPath).not.toBeNull();
      // Closed door forces path around
      expect(closedPath![0]).not.toEqual({ x: 2, y: 2 });

      const openPath = findPathAroundWalls({ x: 2, y: 1 }, { x: 2, y: 3 }, openDoorWalls, mapSize);
      expect(openPath).not.toBeNull();
      // Open door allows direct step through
      expect(openPath![0]).toEqual({ x: 2, y: 2 });
    });

    it('does not cut diagonally past a wall corner', () => {
      // Vertical wall between (1,1) and (2,1): blocks east step from (1,1).
      const walls = {
        edges: [
          { id: 'w', c1: [1, 1] as [number, number], c2: [2, 1] as [number, number], type: 'full' as const }
        ]
      };
      const path = findPathAroundWalls({ x: 1, y: 1 }, { x: 2, y: 2 }, walls, mapSize);
      expect(path).not.toBeNull();
      // Diagonal (1,1)->(2,2) squeezes past the wall corner and must be disallowed.
      expect(path![0]).not.toEqual({ x: 2, y: 2 });
      expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
      expect(path!.length).toBeGreaterThan(1);
    });

    it('calculateMoveTowards does not move through walls when target is unreachable', () => {
      // Fully enclose (0,0) in a 3x3 map corner.
      const walls = {
        edges: [
          { id: 'a', c1: [0, 0] as [number, number], c2: [1, 0] as [number, number], type: 'full' as const },
          { id: 'b', c1: [0, 0] as [number, number], c2: [0, 1] as [number, number], type: 'full' as const }
        ]
      };
      const res = calculateMoveTowards({ x: 0, y: 0 }, { x: 2, y: 2 }, 30, undefined, walls, { width: 3, height: 3 });
      expect(res.newPos).toEqual({ x: 0, y: 0 });
      expect(res.movedFeet).toBe(0);
    });

    it('routes around solid obstacle cells', () => {
      const walls = {
        obstacleCells: {
          '2,2': { type: 'full' as const, name: 'Pillar' }
        }
      };

      const path = findPathAroundWalls({ x: 2, y: 1 }, { x: 2, y: 3 }, walls, mapSize);
      expect(path).not.toBeNull();
      // Cannot step on (2,2)
      expect(path!.some(p => p.x === 2 && p.y === 2)).toBe(false);
      expect(path![path!.length - 1]).toEqual({ x: 2, y: 3 });
    });

    it('multimodal check: routes around Palma Flora Manor Stone Fence from (22, 1) to (22, 4)', () => {
      const cachePath = path.resolve(process.cwd(), 'public/data/map_grids.json');
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const palmaGrid = cacheData['/maps/5.1-palma-flora-player.png'];
      const palmaWalls = palmaGrid.walls;
      const palmaMapSize: MapSize = { width: palmaGrid.columns, height: palmaGrid.rows };

      const pathResult = findPathAroundWalls({ x: 22, y: 1 }, { x: 22, y: 4 }, palmaWalls, palmaMapSize);
      expect(pathResult).not.toBeNull();
      // Directly going through (22, 2) -> (22, 3) crosses Manor Stone Fence.
      // Therefore, the path must NOT cross [22, 2] -> [22, 3].
      const crossedFenceDirectly = pathResult!.some((p, i) => {
        if (i === 0) return false;
        const prev = pathResult![i - 1];
        return (prev.x === 22 && prev.y === 2 && p.x === 22 && p.y === 3);
      });
      expect(crossedFenceDirectly).toBe(false);
      // Destination should be reached
      expect(pathResult![pathResult!.length - 1]).toEqual({ x: 22, y: 4 });

      // Moving towards (22, 4) from (22, 1) by 10 ft:
      const moveRes = calculateMoveTowards({ x: 22, y: 1 }, { x: 22, y: 4 }, 10, new Set(['22,4']), palmaWalls, palmaMapSize);
      expect(moveRes.movedFeet).toBe(10);
      // It should not end up at (22, 3) (which is blocked by the fence)
      expect(moveRes.newPos).not.toEqual({ x: 22, y: 3 });
    });

    it('routes around a compiled wall segment (no edges) blocking the straight line', () => {
      // Vertical segment wall at x=3, only spanning rows y=0..4 (leaves a gap below y=4).
      const walls: MapWallsData = { edges: [], segments: [seg('wall', 3, 0, 3, 4)] };

      const path = findPathAroundWalls({ x: 1, y: 2 }, { x: 5, y: 2 }, walls, mapSize);
      expect(path).not.toBeNull();
      expect(path![path!.length - 1]).toEqual({ x: 5, y: 2 });

      // Straight line distance is 4 cells; a detour around the segment must be longer.
      expect(path!.length).toBeGreaterThan(4);

      // Must never step directly from (2,2) to (3,2) - the segment blocks that row.
      const fullPath = [{ x: 1, y: 2 }, ...path!];
      const crossedDirectly = fullPath.some((p, i) => {
        if (i === 0) return false;
        const prev = fullPath[i - 1];
        return prev.x === 2 && prev.y === 2 && p.x === 3 && p.y === 2;
      });
      expect(crossedDirectly).toBe(false);
    });

    it('calculateMoveTowards never passes through or ends on the far side of a segment wall that fully separates two areas', () => {
      // Segment spans the full map height at x=3, with no edges at all - only `segments`.
      const walls: MapWallsData = { edges: [], segments: [seg('wall', 3, 0, 3, 10)] };

      const res = calculateMoveTowards({ x: 1, y: 2 }, { x: 5, y: 2 }, 100, undefined, walls, mapSize);
      // The wall fully separates x<=2 from x>=3; the mover can never cross it.
      expect(res.newPos.x).toBeLessThan(3);
    });

    it('blocks a diagonal step when a diagonal wall segment crosses it directly (both orthogonal legs clear)', () => {
      // This diagonal segment crosses the centre-to-centre line from (0,0) to (1,1)
      // at (1,1) without crossing either orthogonal leg - (0,0)->(1,0) or (0,0)->(0,1).
      const walls: MapWallsData = { edges: [], segments: [seg('diag', 1.3, 0.7, 0.7, 1.3)] };

      const path = findPathAroundWalls({ x: 0, y: 0 }, { x: 1, y: 1 }, walls, mapSize);
      expect(path).not.toBeNull();
      // The direct diagonal step must be blocked even though both legs are individually clear.
      expect(path![0]).not.toEqual({ x: 1, y: 1 });
      expect(path![path!.length - 1]).toEqual({ x: 1, y: 1 });
    });
  });

  describe('columnLabelToIndex and labelToCoordinate', () => {
    it('converts single-letter column labels to 0-based index', () => {
      expect(columnLabelToIndex('A')).toBe(0);
      expect(columnLabelToIndex('C')).toBe(2);
      expect(columnLabelToIndex('M')).toBe(12);
      expect(columnLabelToIndex('Z')).toBe(25);
    });

    it('converts multi-letter column labels to 0-based index', () => {
      expect(columnLabelToIndex('AA')).toBe(26);
      expect(columnLabelToIndex('AB')).toBe(27);
      expect(columnLabelToIndex('AZ')).toBe(51);
      expect(columnLabelToIndex('BA')).toBe(52);
    });

    it('handles lowercase column labels case-insensitively', () => {
      expect(columnLabelToIndex('a')).toBe(0);
      expect(columnLabelToIndex('m')).toBe(12);
      expect(columnLabelToIndex('aa')).toBe(26);
    });

    it('returns -1 for invalid column labels', () => {
      expect(columnLabelToIndex('')).toBe(-1);
      expect(columnLabelToIndex('123')).toBe(-1);
      expect(columnLabelToIndex('A1')).toBe(-1);
      expect(columnLabelToIndex(null as unknown as string)).toBe(-1);
    });

    it('parses standard coordinate strings into { x, y }', () => {
      expect(labelToCoordinate('A1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('M9')).toEqual({ x: 12, y: 8 });
      expect(labelToCoordinate('C5')).toEqual({ x: 2, y: 4 });
      expect(labelToCoordinate('AA10')).toEqual({ x: 26, y: 9 });
    });

    it('handles lowercase, spaced, and hyphenated coordinate labels', () => {
      expect(labelToCoordinate('a1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('m9')).toEqual({ x: 12, y: 8 });
      expect(labelToCoordinate('A-1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('M 9')).toEqual({ x: 12, y: 8 });
    });

    it('parses comma-separated coordinate strings ("x,y")', () => {
      expect(labelToCoordinate('0,0')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('12,8')).toEqual({ x: 12, y: 8 });
      expect(labelToCoordinate('12, 8')).toEqual({ x: 12, y: 8 });
    });

    it('throws descriptive error on invalid coordinate labels', () => {
      expect(() => labelToCoordinate('')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('invalid')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('A0')).toThrow(/row number must be >= 1/);
      expect(() => labelToCoordinate(null as unknown as string)).toThrow(/non-empty string/);
    });

    it('guarantees bidirectional round-trip with coordinateToLabel', () => {
      const testCoords: Position[] = [
        { x: 0, y: 0 },
        { x: 12, y: 8 },
        { x: 26, y: 9 },
        { x: 51, y: 20 },
      ];
      for (const pos of testCoords) {
        const label = coordinateToLabel(pos);
        const parsed = labelToCoordinate(label);
        expect(parsed).toEqual(pos);
      }
    });
  });

  describe('resolveRegionName', () => {
    const mockRegions: MapRegion[] = [
      {
        id: 'P1',
        name: 'South Shore',
        cells: ['0,0', '0,1', '1,0', '1,1'],
      },
      {
        id: 'P5',
        name: 'Northern Bridge',
        bounds: { minCol: 17, maxCol: 17, minRow: 0, maxRow: 2 },
        cells: ['17,0', '17,1', '17,2'],
      },
      {
        id: 'P7',
        name: 'Walled Manor',
        bounds: { minCol: 20, maxCol: 25, minRow: 10, maxRow: 15 },
        cells: [],
      },
    ];

    it('resolves region name from exact cell match in region.cells', () => {
      expect(resolveRegionName({ x: 0, y: 1 }, mockRegions)).toBe('South Shore');
      expect(resolveRegionName({ x: 17, y: 2 }, mockRegions)).toBe('Northern Bridge');
    });

    it('resolves region name from bounding box fallback when cells are empty', () => {
      expect(resolveRegionName({ x: 22, y: 12 }, mockRegions)).toBe('Walled Manor');
    });

    it('returns undefined when coordinate is outside all regions', () => {
      expect(resolveRegionName({ x: 5, y: 5 }, mockRegions)).toBeUndefined();
      expect(resolveRegionName({ x: 10, y: 10 }, undefined)).toBeUndefined();
      expect(resolveRegionName({ x: 10, y: 10 }, [])).toBeUndefined();
    });
  });

  describe('calculateAdjacencies', () => {
    const playerMover: EncounterUnit = {
      instanceId: 'p-grog',
      name: 'Grog Strongjaw',
      dexMod: 2,
      isPlayer: true,
      position: { x: 5, y: 5 },
    };

    const combatants: EncounterUnit[] = [
      playerMover,
      // Ally: Vex (isPlayer: true) at (5, 6) -> 5 ft away (orthogonal)
      {
        instanceId: 'p-vex',
        name: 'Vex',
        dexMod: 4,
        isPlayer: true,
        position: { x: 5, y: 6 },
      },
      // Enemy: Goblin (isPlayer: false) at (6, 6) -> 5 ft away (diagonal)
      {
        instanceId: 'm-goblin',
        name: 'Goblin 1',
        dexMod: 2,
        isPlayer: false,
        position: { x: 6, y: 6 },
      },
      // Neutral NPC: Merchant at (4, 5) -> 5 ft away, faction: 'neutral'
      {
        instanceId: 'n-merchant',
        name: 'Merchant Aldous',
        dexMod: 0,
        isPlayer: false,
        faction: 'neutral',
        position: { x: 4, y: 5 },
      },
      // Distant enemy at (10, 10) -> 25 ft away
      {
        instanceId: 'm-boss',
        name: 'Hobgoblin Warlord',
        dexMod: 1,
        isPlayer: false,
        position: { x: 10, y: 10 },
      },
    ];

    it('accurately categorizes adjacent units at origin (Chebyshev <= 5 ft)', () => {
      const origin = { x: 5, y: 5 };
      const adj = calculateAdjacencies(origin, playerMover, combatants);

      expect(adj.allies).toEqual(['Vex']);
      expect(adj.enemies).toEqual(['Goblin 1']);
      expect(adj.neutral).toEqual(['Merchant Aldous']);
      // The moving unit itself must NOT be included in any adjacency
      expect(adj.allies).not.toContain('Grog Strongjaw');
      // Distant unit at 25 ft must NOT be included
      expect(adj.enemies).not.toContain('Hobgoblin Warlord');
    });

    it('accurately categorizes adjacent units at a destination coordinate', () => {
      // Destination next to Goblin and Hobgoblin Warlord
      const dest = { x: 6, y: 5 }; // adjacent to Goblin (6,6) and Grog (5,5)
      const adj = calculateAdjacencies(dest, playerMover, combatants);

      expect(adj.enemies).toContain('Goblin 1');
      expect(adj.neutral).not.toContain('Merchant Aldous'); // (4,5) is 10 ft from (6,5)
    });

    it('reverses ally and enemy perspectives when monster is the mover', () => {
      const monsterMover: EncounterUnit = {
        instanceId: 'm-goblin',
        name: 'Goblin 1',
        dexMod: 2,
        isPlayer: false,
        position: { x: 6, y: 6 },
      };

      // Near Goblin: Grog (5,5 - player), Vex (5,6 - player)
      const adj = calculateAdjacencies({ x: 6, y: 6 }, monsterMover, combatants);

      // From Goblin's perspective: players are enemies
      expect(adj.enemies).toContain('Grog Strongjaw');
      expect(adj.enemies).toContain('Vex');
      expect(adj.allies).not.toContain('Grog Strongjaw');
    });

    it('returns empty lists when no combatants are adjacent', () => {
      const emptyCoord = { x: 20, y: 20 };
      const adj = calculateAdjacencies(emptyCoord, playerMover, combatants);

      expect(adj.allies).toEqual([]);
      expect(adj.enemies).toEqual([]);
      expect(adj.neutral).toEqual([]);
    });
  });
});

