import { describe, it, expect } from 'vitest';
import { cleanPhaseName, findPhaseNameConflicts, normalizePhaseNames, phaseLabel, MAX_PHASE_NAME_LENGTH } from './phaseNames';

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

  it('flags case-insensitive duplicate names, later phase loses', () => {
    expect(findPhaseNameConflicts({ '1': 'Beach', '3': 'BEACH' })).toEqual([
      { phase: 3, name: 'BEACH', conflictsWith: 1, kind: 'name' },
    ]);
    expect(normalizePhaseNames({ '1': 'Beach', '2': ' beach  ' })).toEqual({ '1': 'Beach' });
    expect(normalizePhaseNames({ '1': 'Beach', '2': 'Boss' })).toEqual({ '1': 'Beach', '2': 'Boss' });
  });

  it('rejects a name equal to another unnamed phase default, but allows its own default', () => {
    expect(findPhaseNameConflicts({ '1': 'phase 2' })).toEqual([
      { phase: 1, name: 'phase 2', conflictsWith: 2, kind: 'default' },
    ]);
    expect(normalizePhaseNames({ '1': 'Phase 2' })).toBeUndefined();
    expect(normalizePhaseNames({ '2': 'Phase 2' })).toEqual({ '2': 'Phase 2' });
    // Phase 2 is named, so its default label is no longer in use.
    expect(normalizePhaseNames({ '1': 'Phase 2', '2': 'Boss' })).toEqual({ '1': 'Phase 2', '2': 'Boss' });
  });

  it('only reserves defaults of phases that exist', () => {
    expect(normalizePhaseNames({ '1': 'Phase 9' }, 5)).toEqual({ '1': 'Phase 9' });
    expect(normalizePhaseNames({ '1': 'Phase 9' }, 9)).toBeUndefined();
  });
});
