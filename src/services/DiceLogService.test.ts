import { describe, it, expect, beforeEach } from 'vitest';
import { diceLogService } from './DiceLogService';

describe('DiceLogService', () => {
  beforeEach(() => {
    diceLogService.clear();
  });

  it('records a dice roll with metadata', () => {
    const entry = diceLogService.logRoll({
      source: 'Goblin Archer',
      purpose: 'Shortbow (Attack)',
      formula: '1d20+4',
      rolls: [18],
      modifier: 4,
      total: 22,
      critStatus: 'normal'
    });

    expect(entry.source).toBe('Goblin Archer');
    expect(entry.purpose).toBe('Shortbow (Attack)');
    expect(entry.total).toBe(22);
    expect(entry.formula).toBe('1d20+4');

    const all = diceLogService.getEntries();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);
  });

  it('detects critical hits and fumbles and supports clearing the log', () => {
    diceLogService.logRoll({
      source: 'Paladin',
      purpose: 'Greatsword (Attack)',
      formula: '1d20+5',
      rolls: [20],
      modifier: 5,
      total: 25,
      critStatus: 'crit',
      details: 'Critical Hit!'
    });

    diceLogService.logRoll({
      source: 'Wizard',
      purpose: 'Concentration Check',
      formula: '1d20',
      rolls: [1],
      modifier: 0,
      total: 1,
      critStatus: 'fumble'
    });

    const entries = diceLogService.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].critStatus).toBe('fumble'); // Most recent first
    expect(entries[1].critStatus).toBe('crit');

    diceLogService.clear();
    expect(diceLogService.getEntries()).toHaveLength(0);
  });
});
