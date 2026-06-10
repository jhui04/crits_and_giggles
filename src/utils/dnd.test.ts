import { describe, it, expect } from 'vitest';
import { getSaveModifier } from './dnd';
import type { Monster } from '../types';

describe('getSaveModifier', () => {
  const mockMonster = {
    stats: {
      STR: { score: 18, modifier: 4, save: 7 },
      DEX: { score: 10, modifier: 0 },
      CON: { score: 14, modifier: 2, save: 2 },
    }
  } as unknown as Monster;

  it('should return the explicit save value if provided', () => {
    expect(getSaveModifier(mockMonster, 'STR')).toBe(7);
  });

  it('should fallback to the modifier if save is missing', () => {
    expect(getSaveModifier(mockMonster, 'DEX')).toBe(0);
  });

  it('should return the explicit save value even if it equals the modifier', () => {
    expect(getSaveModifier(mockMonster, 'CON')).toBe(2);
  });

  it('should return 0 if the stat is missing', () => {
    // @ts-expect-error - Testing missing stat fallback
    expect(getSaveModifier(mockMonster, 'INT')).toBe(0);
  });
});
