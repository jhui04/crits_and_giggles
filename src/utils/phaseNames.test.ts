import { describe, it, expect } from 'vitest';
import { cleanPhaseName, normalizePhaseNames, phaseLabel, MAX_PHASE_NAME_LENGTH } from './phaseNames';

describe('phaseNames', () => {
  it('falls back to "Phase N" for missing, blank and whitespace names', () => {
    expect(phaseLabel(undefined, 2)).toBe('Phase 2');
    expect(phaseLabel({}, 1)).toBe('Phase 1');
    expect(phaseLabel({ '1': '   ' }, 1)).toBe('Phase 1');
  });

  it('uses the custom name by phase number', () => {
    expect(phaseLabel({ '1': 'Beach Fight' }, 1)).toBe('Beach Fight');
    expect(phaseLabel({ '1': 'Beach Fight' }, 2)).toBe('Phase 2');
  });

  it('trims, collapses whitespace and caps length', () => {
    expect(cleanPhaseName('  Beach   Fight  ')).toBe('Beach Fight');
    expect(cleanPhaseName('x'.repeat(100))).toHaveLength(MAX_PHASE_NAME_LENGTH);
    expect(cleanPhaseName(42)).toBe('');
  });

  it('normalizes maps, dropping blanks and invalid keys', () => {
    expect(normalizePhaseNames({ '1': ' A ', '2': '', abc: 'x', '0': 'y' })).toEqual({ '1': 'A' });
    expect(normalizePhaseNames({ '1': '' })).toBeUndefined();
    expect(normalizePhaseNames(null)).toBeUndefined();
    expect(normalizePhaseNames(['a'])).toBeUndefined();
  });
});
