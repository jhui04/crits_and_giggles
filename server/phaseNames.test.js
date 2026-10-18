import { describe, it, expect } from 'vitest';
import { cleanPhaseName, normalizePhaseNames, phaseLabel, MAX_PHASE_NAME_LENGTH } from './phaseNames.js';

describe('server phaseNames', () => {
  it('cleans and caps names', () => {
    expect(cleanPhaseName('  Beach   Fight ')).toBe('Beach Fight');
    expect(cleanPhaseName('y'.repeat(200))).toHaveLength(MAX_PHASE_NAME_LENGTH);
  });
  it('normalizes untrusted input', () => {
    expect(normalizePhaseNames({ '2': 'Reinforcements', a: 'b', '3': '  ' })).toEqual({ '2': 'Reinforcements' });
    expect(normalizePhaseNames('nope')).toBeNull();
    expect(normalizePhaseNames({})).toBeNull();
  });
  it('labels with default fallback', () => {
    expect(phaseLabel(null, 4)).toBe('Phase 4');
    expect(phaseLabel({ 4: 'Boss' }, 4)).toBe('Boss');
  });
});
