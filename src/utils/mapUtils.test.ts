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
import type { EncounterUnit, MapSize, Position } from '../types';

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
  });
});

