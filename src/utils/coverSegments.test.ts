import { describe, expect, it } from 'vitest';
import { calculateCover, isStepBlockedByWall } from './coverCalculation';
import type { MapWallsData } from '../types';
import type { WallSegment } from '../shared/spatial/types.ts';

function seg(id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<WallSegment> = {}): WallSegment {
  return {
    id, a: { x: ax, y: ay }, b: { x: bx, y: by }, kind: 'wall', blocksMovement: true, blocksSight: 'full',
    cover: 'total', provenance: { source: 'ddb-meta', confidence: 0.9 }, ...extra,
  };
}

const wallsWith = (...segments: WallSegment[]): MapWallsData => ({ edges: [], segments });

describe('compiled wall segments in the legacy cover and movement helpers', () => {
  it('blocks cover and steps across a solid segment', () => {
    const walls = wallsWith(seg('w', 3, 0, 3, 6, { name: 'Tavern wall' }));
    expect(calculateCover({ x: 1, y: 2 }, { x: 5, y: 2 }, walls).type).toBe('total');
    const step = isStepBlockedByWall({ x: 2, y: 2 }, { x: 3, y: 2 }, walls);
    expect(step.blocked).toBe(true);
    expect(step.wallName).toBe('Tavern wall');
  });

  it('ignores open doors, invisible walls, and untrusted segments', () => {
    const walls = wallsWith(
      seg('open', 3, 0, 3, 2, { kind: 'door', door: { state: 'open' } }),
      seg('inv', 3, 2, 3, 4, { kind: 'invisible' }),
      seg('weak', 3, 4, 3, 6, { provenance: { source: 'ddb-meta', confidence: 0.3 } }),
    );
    for (const y of [0, 2, 4]) {
      expect(isStepBlockedByWall({ x: 2, y }, { x: 3, y }, walls).blocked).toBe(false);
    }
    expect(calculateCover({ x: 1, y: 3 }, { x: 5, y: 3 }, walls).type).toBe('none');
  });

  it('gives half cover for low walls and honours one-way segments', () => {
    const low = wallsWith(seg('low', 3, 0, 3, 6, { kind: 'low_wall', cover: 'half' }));
    expect(calculateCover({ x: 1, y: 2 }, { x: 5, y: 2 }, low).type).toBe('half');
    const oneWay = wallsWith(seg('ow', 3, 0, 3, 6, { oneWay: 'left' }));
    const a = isStepBlockedByWall({ x: 2, y: 2 }, { x: 4, y: 2 }, oneWay).blocked;
    const b = isStepBlockedByWall({ x: 4, y: 2 }, { x: 2, y: 2 }, oneWay).blocked;
    expect(a).not.toBe(b);
  });
});
