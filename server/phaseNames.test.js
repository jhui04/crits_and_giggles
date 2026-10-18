import { describe, it, expect } from 'vitest';
import { cleanPhaseName, findPhaseNameConflicts, phaseCountFor, normalizePhaseNames, phaseLabel, MAX_PHASE_NAME_LENGTH } from './phaseNames.js';

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
  it('drops later duplicates (case-insensitive) so stored names are unique', () => {
    expect(normalizePhaseNames({ 1: 'Beach', 2: 'BEACH', 3: 'Boss' })).toEqual({ 1: 'Beach', 3: 'Boss' });
    expect(normalizePhaseNames({ 2: 'Same', 1: ' same ' })).toEqual({ 1: 'same' });
    expect(normalizePhaseNames({ 2: 'x', 3: 'x', 4: 'x' })).toEqual({ 2: 'x' });
  });
  it('rejects names equal to another unnamed phase default; own default is fine', () => {
    expect(findPhaseNameConflicts({ 1: 'Phase 2' })[0]).toMatchObject({ phase: 1, conflictsWith: 2, kind: 'default' });
    expect(normalizePhaseNames({ 1: 'Phase 2' })).toBeNull();
    expect(normalizePhaseNames({ 2: 'phase 2' })).toEqual({ 2: 'phase 2' });
    expect(normalizePhaseNames({ 1: 'Phase 2', 2: 'Boss' })).toEqual({ 1: 'Phase 2', 2: 'Boss' });
  });
  it('counts phases from units', () => {
    expect(phaseCountFor([{ phase: 7 }, { phase: 2 }])).toBe(7);
    expect(phaseCountFor(undefined)).toBe(5);
  });
});
