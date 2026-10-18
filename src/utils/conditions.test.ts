import { describe, it, expect } from 'vitest';
import {
  SRD_CONDITIONS,
  normalizeConditions,
  addCondition,
  removeCondition,
  tickConditionsAtEndOfTurn,
  formatConditions,
  formatConditionNames,
} from './conditions';

describe('SRD_CONDITIONS', () => {
  it('contains the 15 SRD conditions plus Concentrating', () => {
    expect(SRD_CONDITIONS).toHaveLength(16);
    expect(SRD_CONDITIONS).toContain('Poisoned');
    expect(SRD_CONDITIONS).toContain('Prone');
    expect(SRD_CONDITIONS).toContain('Concentrating');
  });
});

describe('normalizeConditions', () => {
  it('returns [] for undefined/null/non-array', () => {
    expect(normalizeConditions(undefined)).toEqual([]);
    expect(normalizeConditions(null)).toEqual([]);
    expect(normalizeConditions('Poisoned')).toEqual([]);
  });

  it('accepts legacy string arrays', () => {
    expect(normalizeConditions(['Poisoned', 'Prone'])).toEqual([
      { name: 'Poisoned' },
      { name: 'Prone' },
    ]);
  });

  it('accepts structured ActiveCondition arrays', () => {
    expect(normalizeConditions([{ name: 'Poisoned', roundsRemaining: 2 }, { name: 'Prone' }])).toEqual([
      { name: 'Poisoned', roundsRemaining: 2 },
      { name: 'Prone', roundsRemaining: undefined },
    ]);
  });

  it('drops malformed entries and trims blank names', () => {
    expect(normalizeConditions([{ notName: 'x' }, '', '  ', { name: '  Prone  ' }, 42, null])).toEqual([
      { name: 'Prone', roundsRemaining: undefined },
    ]);
  });

  it('ignores a non-finite roundsRemaining', () => {
    expect(normalizeConditions([{ name: 'Poisoned', roundsRemaining: NaN }])).toEqual([
      { name: 'Poisoned', roundsRemaining: undefined },
    ]);
  });
});

describe('addCondition', () => {
  it('adds a new condition', () => {
    expect(addCondition(undefined, 'Poisoned', 2)).toEqual([{ name: 'Poisoned', roundsRemaining: 2 }]);
  });

  it('replaces an existing condition of the same name (case-insensitive), using the new call\'s casing', () => {
    const start = [{ name: 'Poisoned', roundsRemaining: 2 }, { name: 'Prone' }];
    expect(addCondition(start, 'poisoned', 5)).toEqual([{ name: 'Prone' }, { name: 'poisoned', roundsRemaining: 5 }]);
  });

  it('does not mutate the input array', () => {
    const start = [{ name: 'Prone' }];
    addCondition(start, 'Poisoned');
    expect(start).toEqual([{ name: 'Prone' }]);
  });

  it('ignores a blank name', () => {
    expect(addCondition([{ name: 'Prone' }], '   ')).toEqual([{ name: 'Prone' }]);
  });
});

describe('removeCondition', () => {
  it('removes by name case-insensitively', () => {
    const start = [{ name: 'Poisoned' }, { name: 'Prone' }];
    expect(removeCondition(start, 'prone')).toEqual([{ name: 'Poisoned' }]);
  });

  it('is a no-op if the name is absent', () => {
    const start = [{ name: 'Poisoned' }];
    expect(removeCondition(start, 'Prone')).toEqual([{ name: 'Poisoned' }]);
  });

  it('handles undefined input', () => {
    expect(removeCondition(undefined, 'Prone')).toEqual([]);
  });
});

describe('tickConditionsAtEndOfTurn', () => {
  it('decrements timed conditions and leaves indefinite ones untouched', () => {
    const unit = { conditions: [{ name: 'Poisoned', roundsRemaining: 2 }, { name: 'Prone' }] };
    const { unit: next, expired } = tickConditionsAtEndOfTurn(unit);
    expect(expired).toEqual([]);
    expect(next.conditions).toEqual([{ name: 'Poisoned', roundsRemaining: 1 }, { name: 'Prone' }]);
  });

  it('removes a condition that reaches 0 and reports it as expired', () => {
    const unit = { conditions: [{ name: 'Poisoned', roundsRemaining: 1 }, { name: 'Prone' }] };
    const { unit: next, expired } = tickConditionsAtEndOfTurn(unit);
    expect(expired).toEqual(['Poisoned']);
    expect(next.conditions).toEqual([{ name: 'Prone' }]);
  });

  it('handles a unit with no conditions', () => {
    const unit = { conditions: undefined };
    const { unit: next, expired } = tickConditionsAtEndOfTurn(unit);
    expect(expired).toEqual([]);
    expect(next.conditions).toEqual([]);
  });

  it('normalizes legacy string conditions before ticking (treated as indefinite)', () => {
    const unit = { conditions: ['Prone'] as unknown as { name: string }[] };
    const { unit: next, expired } = tickConditionsAtEndOfTurn(unit);
    expect(expired).toEqual([]);
    expect(next.conditions).toEqual([{ name: 'Prone' }]);
  });

  it('preserves other unit fields', () => {
    const unit = { name: 'Goblin 2', conditions: [{ name: 'Poisoned', roundsRemaining: 1 }] };
    const { unit: next } = tickConditionsAtEndOfTurn(unit);
    expect(next.name).toBe('Goblin 2');
  });
});

describe('formatConditions', () => {
  it('returns an empty string for no conditions', () => {
    expect(formatConditions(undefined)).toBe('');
    expect(formatConditions([])).toBe('');
  });

  it('formats a mix of timed and indefinite conditions', () => {
    expect(formatConditions([{ name: 'Poisoned', roundsRemaining: 2 }, { name: 'Prone' }])).toBe(
      'Poisoned (2 rounds), Prone'
    );
  });

  it('uses singular "round" for 1', () => {
    expect(formatConditions([{ name: 'Poisoned', roundsRemaining: 1 }])).toBe('Poisoned (1 round)');
  });

  it('accepts legacy string arrays', () => {
    expect(formatConditions(['Prone', 'Grappled'])).toBe('Prone, Grappled');
  });
});

describe('formatConditionNames', () => {
  it('returns an array of formatted strings', () => {
    expect(formatConditionNames([{ name: 'Poisoned', roundsRemaining: 2 }, { name: 'Prone' }])).toEqual([
      'Poisoned (2 rounds)',
      'Prone',
    ]);
  });

  it('returns [] for no conditions', () => {
    expect(formatConditionNames(undefined)).toEqual([]);
  });
});
