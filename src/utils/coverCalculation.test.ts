import { describe, it, expect } from 'vitest';
import { calculateCover, wallEdgeToSegment, lineSegmentsIntersect } from './coverCalculation';
import type { MapWallsData, WallEdge } from '../types';
import fs from 'fs';
import path from 'path';

describe('Cover Calculation & Raycasting Engine (D&D 5e RAW)', () => {
  describe('Geometric Segment Conversion & Intersection', () => {
    it('converts vertical and horizontal wall edges to correct line segments', () => {
      // Horizontal adjacency: wall between (2, 3) and (3, 3) is a vertical segment along x=3 from y=3 to y=4
      const verticalEdge: WallEdge = {
        id: 'w1',
        c1: [2, 3],
        c2: [3, 3],
        type: 'half'
      };
      const segV = wallEdgeToSegment(verticalEdge);
      expect(segV.p1).toEqual({ x: 3, y: 3 });
      expect(segV.p2).toEqual({ x: 3, y: 4 });

      // Vertical adjacency: wall between (2, 3) and (2, 4) is a horizontal segment along y=4 from x=2 to x=3
      const horizontalEdge: WallEdge = {
        id: 'w2',
        c1: [2, 3],
        c2: [2, 4],
        type: 'full'
      };
      const segH = wallEdgeToSegment(horizontalEdge);
      expect(segH.p1).toEqual({ x: 2, y: 4 });
      expect(segH.p2).toEqual({ x: 3, y: 4 });
    });

    it('detects ray intersection through a wall segment', () => {
      const p = { x: 1.5, y: 3.5 };
      const q = { x: 4.5, y: 3.5 };
      const a = { x: 3, y: 2 };
      const b = { x: 3, y: 5 };

      expect(lineSegmentsIntersect(p, q, a, b)).toBe(true);
    });

    it('does not intersect when ray does not cross wall', () => {
      const p = { x: 1.5, y: 1.5 };
      const q = { x: 2.5, y: 1.5 };
      const a = { x: 3, y: 2 };
      const b = { x: 3, y: 5 };

      expect(lineSegmentsIntersect(p, q, a, b)).toBe(false);
    });
  });

  describe('Cover Rules-As-Written Evaluation', () => {
    it('returns No Cover when there are no obstacles between combatants', () => {
      const walls: MapWallsData = {
        edges: [],
        obstacleCells: {}
      };

      const result = calculateCover({ x: 0, y: 0 }, { x: 5, y: 5 }, walls);
      expect(result.type).toBe('none');
      expect(result.acBonus).toBe(0);
      expect(result.dexSaveBonus).toBe(0);
      expect(result.description).toBe('No Cover');
    });

    it('returns Half Cover (+2 AC) when rays cross a low wall or fence', () => {
      // Wall between column 2 and 3
      const walls: MapWallsData = {
        edges: [
          {
            id: 'fence-1',
            c1: [2, 1],
            c2: [3, 1],
            type: 'half',
            name: 'Low Stone Fence'
          },
          {
            id: 'fence-2',
            c1: [2, 2],
            c2: [3, 2],
            type: 'half',
            name: 'Low Stone Fence'
          }
        ]
      };

      // Attacker at (1, 1), target at (4, 1) across the low fence
      const result = calculateCover({ x: 1, y: 1 }, { x: 4, y: 1 }, walls);
      expect(result.type).toBe('half');
      expect(result.acBonus).toBe(2);
      expect(result.dexSaveBonus).toBe(2);
      expect(result.description).toContain('Half Cover behind Low Stone Fence (+2 AC)');
    });

    it('returns Three-Quarters Cover (+5 AC) when rays cross heavy obstacle or 3-4 lines blocked', () => {
      const walls: MapWallsData = {
        edges: [],
        obstacleCells: {
          '3,3': {
            x: 3,
            y: 3,
            type: 'three_quarters',
            name: 'Heavy Iron Portcullis'
          }
        }
      };

      // Attacker at (1, 3), target at (5, 3) with portcullis in the path
      const result = calculateCover({ x: 1, y: 3 }, { x: 5, y: 3 }, walls);
      expect(result.type).toBe('three_quarters');
      expect(result.acBonus).toBe(5);
      expect(result.dexSaveBonus).toBe(5);
      expect(result.description).toContain('Three-Quarters Cover');
      expect(result.description).toContain('+5 AC');
    });

    it('returns Total Cover (Line of sight blocked) when all rays are blocked by solid wall', () => {
      // Continuous solid wall across rows 0 to 5 along col 3
      const walls: MapWallsData = {
        edges: [
          { id: 'w0', c1: [2, 0], c2: [3, 0], type: 'full', name: 'Castle Wall' },
          { id: 'w1', c1: [2, 1], c2: [3, 1], type: 'full', name: 'Castle Wall' },
          { id: 'w2', c1: [2, 2], c2: [3, 2], type: 'full', name: 'Castle Wall' },
          { id: 'w3', c1: [2, 3], c2: [3, 3], type: 'full', name: 'Castle Wall' },
          { id: 'w4', c1: [2, 4], c2: [3, 4], type: 'full', name: 'Castle Wall' },
          { id: 'w5', c1: [2, 5], c2: [3, 5], type: 'full', name: 'Castle Wall' }
        ]
      };

      const result = calculateCover({ x: 1, y: 2 }, { x: 5, y: 2 }, walls);
      expect(result.type).toBe('total');
      expect(result.acBonus).toBe(0);
      expect(result.description).toContain('Total Cover');
      expect(result.description).toContain('Line of sight blocked');
    });

    it('treats open doors as unobstructed and closed doors as solid cover', () => {
      const closedDoorWalls: MapWallsData = {
        edges: [
          {
            id: 'd1',
            c1: [2, 2],
            c2: [3, 2],
            type: 'door_closed',
            name: 'Heavy Oak Door'
          }
        ]
      };

      const closedResult = calculateCover({ x: 2, y: 2 }, { x: 3, y: 2 }, closedDoorWalls);
      expect(closedResult.type).toBe('total');
      expect(closedResult.description).toContain('Total Cover');

      const openDoorWalls: MapWallsData = {
        edges: [
          {
            id: 'd1',
            c1: [2, 2],
            c2: [3, 2],
            type: 'door_open',
            name: 'Heavy Oak Door'
          }
        ]
      };

      const openResult = calculateCover({ x: 2, y: 2 }, { x: 3, y: 2 }, openDoorWalls);
      expect(openResult.type).toBe('none');
      expect(openResult.acBonus).toBe(0);
    });
  });

  describe('Multimodal Map Verification against Palma Flora (5.1-palma-flora-player.png)', () => {
    // Load the parsed map grid cache containing generated walls
    const cachePath = path.resolve(process.cwd(), 'public/data/map_grids.json');
    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const palmaGrid = cacheData['/maps/5.1-palma-flora-player.png'];
    const walls: MapWallsData = palmaGrid.walls;

    it('verifies Palma Flora grid metadata matches image dimensions and cell pitch', () => {
      expect(palmaGrid.imageWidth).toBe(2550);
      expect(palmaGrid.imageHeight).toBe(1650);
      expect(palmaGrid.cellPitch).toBe(74);
      expect(palmaGrid.columns).toBe(33);
      expect(palmaGrid.rows).toBe(21);
      expect(walls).toBeDefined();
      expect(walls.edges.length).toBeGreaterThanOrEqual(40);
    });

    it('multimodal check: Walled Manor (P7) stone fence provides Half Cover (+2 AC) against outside attackers', () => {
      // Visual ground truth on 5.1-palma-flora-player.png:
      // P7 garden is bounded by stone fence on North (row 3), East (col 23), South (row 6), West (col 20).
      // Defender inside garden courtyard at (22, 4).
      // Attacker outside north of the compound at (22, 1) in Lucidian Ocean approach.
      const result = calculateCover({ x: 22, y: 1 }, { x: 22, y: 4 }, walls);
      expect(result.type).toBe('half');
      expect(result.acBonus).toBe(2);
      expect(result.description).toContain('Manor Stone Fence');
      expect(result.description).toContain('+2 AC');
    });

    it('multimodal check: Manor House solid walls provide Total Cover (Line of sight blocked)', () => {
      // Visual ground truth on 5.1-palma-flora-player.png:
      // Manor house is a solid L-shaped building with slate/blue roof at (20,5), (20,6), (21,5), (21,6).
      // Attacker at (19, 5) attempting to target defender on the other side at (23, 5).
      const result = calculateCover({ x: 19, y: 5 }, { x: 23, y: 5 }, walls);
      expect(result.type).toBe('total');
      expect(result.description).toContain('Total Cover');
      expect(result.description).toContain('Line of sight blocked');
    });

    it('multimodal check: Statue of Kord in Public Square (P10) provides cover against line-of-fire', () => {
      // Visual ground truth on 5.1-palma-flora-player.png:
      // The massive statue of Kord sits on a central pedestal at (17, 8) in the public plaza.
      // Attacker at (17, 10) firing north toward defender at (17, 6) crosses the statue.
      const result = calculateCover({ x: 17, y: 10 }, { x: 17, y: 6 }, walls);
      expect(result.type).toBe('three_quarters');
      expect(result.acBonus).toBe(5);
      expect(result.description).toContain('Statue of Kord');
      expect(result.description).toContain('+5 AC');
    });

    it('multimodal check: Northern Bridge (P5) wooden railings provide Half Cover across the channel', () => {
      // Visual ground truth on 5.1-palma-flora-player.png:
      // P5 is a wooden bridge at col 17, rows 0..2 flanked by wooden railings on East/West.
      // Unit at (17, 1) targeted by an archer across the water channel from (15, 1).
      const result = calculateCover({ x: 15, y: 1 }, { x: 17, y: 1 }, walls);
      expect(result.type).toBe('half');
      expect(result.acBonus).toBe(2);
      expect(result.description).toContain('Bridge Railing');
      expect(result.description).toContain('+2 AC');
    });

    it('multimodal check: Open sandy beach at South Shore Point (P1) has unobstructed No Cover', () => {
      // Visual ground truth on 5.1-palma-flora-player.png:
      // P1 is the open sandy southern point of the island with no structural walls.
      // Attacker at (15, 15), defender at (18, 16).
      const result = calculateCover({ x: 15, y: 15 }, { x: 18, y: 16 }, walls);
      expect(result.type).toBe('none');
      expect(result.acBonus).toBe(0);
      expect(result.description).toBe('No Cover');
    });
  });
});
